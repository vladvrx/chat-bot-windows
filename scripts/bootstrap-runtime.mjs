import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import sevenZipBin from "7zip-bin";
import {
  archivedDmg,
  archivedWindowsInstaller,
  cachedDmg,
  cachedRuntimeForPlatform,
  cachedWindowsInstaller,
  dmgSha256,
  dmgUrl,
  windowsInstallerSha256,
  windowsInstallerUrl,
} from "./lib/config.mjs";
import { capture, run } from "./lib/process.mjs";
import { cacheRuntimeFromApp, hydrateSourcePayloadFromRuntime, validateRuntimeApp } from "./lib/runtime.mjs";
import { SYSTEM_TOOLS } from "./lib/system-tools.mjs";

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function sha256(target) {
  if (process.platform === "win32") {
    const output = await capture("certutil.exe", ["-hashfile", target, "SHA256"]);
    const digest = output.match(/\b[0-9a-f]{64}\b/i)?.[0];
    if (digest == null) throw new Error(`certutil did not return a SHA-256 for ${target}.`);
    return digest.toLowerCase();
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}

async function prepareReleaseArtifact({ cached, archived, expectedSha256, url, label }) {
  await mkdir(path.dirname(cached), { recursive: true });
  if (await exists(cached)) {
    const digest = await sha256(cached);
    if (digest === expectedSha256) return cached;
    await rm(cached, { force: true });
  }

  if (await exists(archived)) {
    const archivedDigest = await sha256(archived);
    if (archivedDigest !== expectedSha256) {
      throw new Error(`Archived ${label} checksum mismatch: expected ${expectedSha256}, got ${archivedDigest}. Run git lfs pull before bootstrapping.`);
    }
    console.log(`Using archived release ${archived}`);
    await copyFile(archived, cached);
    return cached;
  }

  console.log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || response.body == null) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const partial = `${cached}.partial`;
  await rm(partial, { force: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { mode: 0o600 }));
  const digest = await sha256(partial);
  if (digest !== expectedSha256) {
    await rm(partial, { force: true });
    throw new Error(`${label} checksum mismatch: expected ${expectedSha256}, got ${digest}`);
  }
  await rename(partial, cached);
  return cached;
}

async function extractMacRuntime() {
  const mountRoot = await mkdtemp(path.join(tmpdir(), "grok-bot-018-mount-"));
  let attached = false;
  try {
    await run(SYSTEM_TOOLS.hdiutil, ["attach", "-readonly", "-nobrowse", "-mountpoint", mountRoot, cachedDmg]);
    attached = true;
    await cacheRuntimeFromApp(path.join(mountRoot, "Grok Bot.app"));
  } finally {
    if (attached) await run(SYSTEM_TOOLS.hdiutil, ["detach", mountRoot]);
    await rm(mountRoot, { recursive: true, force: true });
  }
}

async function extractWindowsRuntime() {
  const extractionRoot = await mkdtemp(path.join(tmpdir(), "grok-bot-018-windows-"));
  const runtimeRoot = path.join(extractionRoot, "runtime");
  try {
    await mkdir(runtimeRoot, { recursive: true });
    // The bundled standalone 7za locates the embedded app-64.7z payload and
    // extracts its application tree directly without executing the installer.
    await run(sevenZipBin.path7za, ["x", "-y", `-o${runtimeRoot}`, cachedWindowsInstaller]);
    await cacheRuntimeFromApp(runtimeRoot);
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

if (process.platform !== "darwin" && process.platform !== "win32") {
  throw new Error(`Grok Bot 0.18 bootstrap does not support ${process.platform}.`);
}

const configuredApp = process.env.GROK_BOT_018_APP?.trim();
const cachedRuntime = cachedRuntimeForPlatform();
let runtimeApp;
if (configuredApp) {
  runtimeApp = await cacheRuntimeFromApp(configuredApp);
} else if (await exists(cachedRuntime)) {
  runtimeApp = await validateRuntimeApp(cachedRuntime, { platform: process.platform });
} else {
  if (process.platform === "darwin") {
    await prepareReleaseArtifact({ cached: cachedDmg, archived: archivedDmg, expectedSha256: dmgSha256, url: dmgUrl, label: "DMG" });
    await extractMacRuntime();
  } else {
    await prepareReleaseArtifact({ cached: cachedWindowsInstaller, archived: archivedWindowsInstaller, expectedSha256: windowsInstallerSha256, url: windowsInstallerUrl, label: "Windows installer" });
    await extractWindowsRuntime();
  }
  runtimeApp = await validateRuntimeApp(cachedRuntime, { platform: process.platform });
}

const hydrated = await hydrateSourcePayloadFromRuntime(runtimeApp);

console.log(`Runtime ready: ${cachedRuntime}`);
console.log(`Checksum-pinned source payload ready: ${hydrated.destination} (${hydrated.sha256})`);
console.log("The checksum-pinned app supplies only the Electron shell, ABI-matched native dependencies, and explicitly documented build fallbacks.");
