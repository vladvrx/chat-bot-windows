import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractFile, getRawHeader } from "@electron/asar";
import {
  cachedRuntimeForPlatform,
  macosUpstreamAsarSha256,
  sourceAppDir,
  upstreamVersion,
  windowsUpstreamAsarSha256,
} from "./config.mjs";
import { capture, run } from "./process.mjs";
import { SYSTEM_TOOLS } from "./system-tools.mjs";

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export function runtimePlatform(appPath) {
  if (path.extname(appPath).toLowerCase() === ".app") return "darwin";
  return "win32";
}

export function runtimeResourcesPath(appPath) {
  return runtimePlatform(appPath) === "darwin"
    ? path.join(appPath, "Contents", "Resources")
    : path.join(appPath, "resources");
}

export function runtimeExecutablePath(appPath) {
  return runtimePlatform(appPath) === "darwin"
    ? path.join(appPath, "Contents", "MacOS", "Grok Bot")
    : path.join(appPath, "Grok Bot.exe");
}

function expectedAsarSha256(platform) {
  return platform === "win32" ? windowsUpstreamAsarSha256 : macosUpstreamAsarSha256;
}

async function sha256File(target) {
  return createHash("sha256").update(await readFile(target)).digest("hex");
}

function archivePackageVersion(archive) {
  const parsed = JSON.parse(extractFile(archive, "package.json").toString("utf8"));
  return parsed.version;
}

export async function validateRuntimeApp(appPath, { platform = runtimePlatform(appPath) } = {}) {
  const resolved = path.resolve(appPath);
  const actualPlatform = runtimePlatform(resolved);
  if (actualPlatform !== platform) throw new Error(`Expected a ${platform} Grok Bot runtime at ${resolved}.`);
  const resources = runtimeResourcesPath(resolved);
  const archive = path.join(resources, "app.asar");
  const executable = runtimeExecutablePath(resolved);
  const unpacked = path.join(resources, "app.asar.unpacked");
  if (!(await stat(executable)).isFile() || !(await stat(unpacked)).isDirectory() || !(await stat(archive)).isFile()) {
    throw new Error(`Incomplete Grok Bot ${platform} runtime at ${resolved}`);
  }
  const digest = await sha256File(archive);
  const expected = expectedAsarSha256(platform);
  if (digest !== expected) throw new Error(`Grok Bot ${platform} app.asar checksum mismatch: expected ${expected}, got ${digest}`);
  const version = platform === "darwin"
    ? await capture(SYSTEM_TOOLS.plutil, ["-extract", "CFBundleShortVersionString", "raw", path.join(resolved, "Contents", "Info.plist")])
    : archivePackageVersion(archive);
  if (version !== upstreamVersion) throw new Error(`Expected Grok Bot ${upstreamVersion}, got ${version} at ${resolved}`);
  return resolved;
}

export async function resolveRuntimeApp() {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "win32") throw new Error(`Grok Bot packaging does not support ${platform}.`);
  const configured = process.env.GROK_BOT_018_APP?.trim();
  if (configured) {
    return await validateRuntimeApp(path.resolve(configured), { platform });
  }
  const cachedRuntime = cachedRuntimeForPlatform(platform);
  if (await exists(cachedRuntime)) {
    return await validateRuntimeApp(cachedRuntime, { platform });
  }
  throw new Error("Missing 0.18.0 runtime. Run `npm run bootstrap` first.");
}

export async function cacheRuntimeFromApp(source) {
  const platform = process.platform;
  const validated = await validateRuntimeApp(path.resolve(source), { platform });
  const cachedRuntime = cachedRuntimeForPlatform(platform);
  const runtimeDir = path.dirname(cachedRuntime);
  await mkdir(runtimeDir, { recursive: true });
  await rm(cachedRuntime, { recursive: true, force: true });
  if (platform === "darwin") await run(SYSTEM_TOOLS.ditto, [validated, cachedRuntime]);
  else await cp(validated, cachedRuntime, { recursive: true, dereference: false, preserveTimestamps: true });
  return await validateRuntimeApp(cachedRuntime, { platform });
}

function collectArchiveFiles(files, segments = []) {
  const found = [];
  for (const [name, entry] of Object.entries(files)) {
    const next = [...segments, name];
    if (entry.files != null) found.push(...collectArchiveFiles(entry.files, next));
    else if (typeof entry.size === "number") found.push(next);
  }
  return found;
}

export async function hydrateSourcePayloadFromAsar(archive, {
  destination = sourceAppDir,
  expectedSha256 = expectedAsarSha256(process.platform),
} = {}) {
  const bytes = await readFile(archive);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Upstream app.asar checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }

  const temporary = await mkdtemp(path.join(tmpdir(), "grok-bot-018-hydrate-"));
  try {
    const files = collectArchiveFiles(getRawHeader(archive).header.files)
      .filter(segments => segments[0] === "dist" && (
        segments[1] !== "deps"
        || segments.join("/") === "dist/deps/runtime-deps-manifest.json"
        || segments.at(-1)?.endsWith(".node") === true
      ));
    for (const segments of files) {
      const target = path.join(temporary, ...segments);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, extractFile(archive, path.join(...segments)));
    }
    for (const required of [
      "dist/electron-main/main.cjs",
      "dist/host/host-main.cjs",
      "dist/renderer/index.html",
    ]) {
      if (!(await stat(path.join(temporary, required))).isFile()) {
        throw new Error(`Upstream app.asar is missing ${required}`);
      }
    }
    await mkdir(destination, { recursive: true });
    await rm(path.join(destination, "dist"), { recursive: true, force: true });
    await cp(path.join(temporary, "dist"), path.join(destination, "dist"), {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { archive, sha256: actualSha256, destination: path.join(destination, "dist") };
}

export async function hydrateSourcePayloadFromRuntime(runtimeApp, options = {}) {
  const validated = await validateRuntimeApp(runtimeApp, { platform: process.platform });
  const archive = path.join(runtimeResourcesPath(validated), "app.asar");
  return hydrateSourcePayloadFromAsar(archive, options);
}

export async function copyTree(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, dereference: false, preserveTimestamps: true });
}
