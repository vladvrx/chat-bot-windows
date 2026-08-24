import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { extractFile, listPackage } from "@electron/asar";

import {
  reconstructedName,
  windowsUpstreamAsarSha256,
  windowsUpstreamShellSha256,
} from "./config.mjs";
import { inspectPeCertificate } from "./windows-pe.mjs";
import { capture } from "./process.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function fileSha256(target) {
  return sha256(await readFile(target));
}

async function walkFiles(root, current = root) {
  const found = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) found.push(...await walkFiles(root, target));
    else if (entry.isFile()) found.push(path.relative(root, target).split(path.sep).join("/"));
  }
  return found.sort();
}

async function windowsVersionInfo(executable) {
  const literal = executable.replaceAll("'", "''");
  const command = `$v=(Get-Item -LiteralPath '${literal}').VersionInfo; @{ProductName=$v.ProductName;FileDescription=$v.FileDescription;OriginalFilename=$v.OriginalFilename}|ConvertTo-Json -Compress`;
  return JSON.parse(await capture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]));
}

export async function verifyOfficialWindowsReference({ runtimeRoot }) {
  if (typeof runtimeRoot !== "string" || runtimeRoot.length === 0) throw new TypeError("An explicit Windows runtime root is required.");
  const executable = path.join(runtimeRoot, "Grok Bot.exe");
  const archive = path.join(runtimeRoot, "resources", "app.asar");
  const shellHash = await fileSha256(executable);
  const asarHash = await fileSha256(archive);
  if (shellHash !== windowsUpstreamShellSha256) throw new Error(`Official Windows shell checksum mismatch: ${shellHash}`);
  if (asarHash !== windowsUpstreamAsarSha256) throw new Error(`Official Windows ASAR checksum mismatch: ${asarHash}`);
  const certificate = inspectPeCertificate(await readFile(executable));
  if (certificate.size === 0) throw new Error("Official Windows shell has no Authenticode certificate payload.");
  return { executable, archive, shellHash, asarHash, certificateSize: certificate.size };
}

export async function verifyReconstructedWindowsPackage({ packageRoot, executableName = `${reconstructedName}.exe` }) {
  if (typeof packageRoot !== "string" || packageRoot.length === 0) throw new TypeError("An explicit Windows package root is required.");
  const executable = path.join(packageRoot, executableName);
  const archive = path.join(packageRoot, "resources", "app.asar");
  const unpacked = `${archive}.unpacked`;
  if (!(await stat(executable)).isFile() || !(await stat(archive)).isFile() || !(await stat(unpacked)).isDirectory()) {
    throw new Error(`Incomplete reconstructed Windows package at ${packageRoot}`);
  }
  await access(path.join(unpacked, "dist", "deps"));
  await access(path.join(unpacked, "dist", "native"));
  await access(path.join(unpacked, "dist", "node-deps", "tree-sitter", "prebuilds", "win32-x64", "tree-sitter.node"));
  await access(path.join(unpacked, "dist", "node-deps", "tree-sitter-bash", "prebuilds", "win32-x64", "tree-sitter-bash.node"));
  const certificate = inspectPeCertificate(await readFile(executable));
  if (certificate.size !== 0) throw new Error("Reconstructed Windows executable still carries an Authenticode certificate payload.");
  const versionInfo = await windowsVersionInfo(executable);
  if (versionInfo.ProductName !== reconstructedName || versionInfo.FileDescription !== reconstructedName || versionInfo.OriginalFilename !== executableName) {
    throw new Error(`Reconstructed Windows executable has the wrong version identity: ${JSON.stringify(versionInfo)}`);
  }
  const packaged = JSON.parse(extractFile(archive, "package.json").toString("utf8"));
  if (packaged.productName !== reconstructedName || packaged.version !== "0.18.0") throw new Error("Reconstructed Windows package has the wrong application identity.");
  const entries = new Set(listPackage(archive).map(raw => raw.replace(/^[/\\]/, "").split(path.sep).join("/")));
  for (const required of [
    "dist/electron-main/main.cjs",
    "dist/host/host-main.cjs",
    "dist/electron-preload/preload.cjs",
    "dist/node-agent-coordinator/main.cjs",
    "dist/renderer/index.html",
    "dist/reconstruction-build.json",
    "dist/runtime-composition-audit.json",
    "dist/renderer-router-extension.json",
  ]) if (!entries.has(required)) throw new Error(`Packaged Windows ASAR is missing ${required}.`);
  const files = await walkFiles(packageRoot);
  if (files.some(file => file === "Grok Bot.exe")) throw new Error("The reconstructed package retained the official executable name.");
  return {
    packageRoot,
    executable,
    archive,
    unpacked,
    fileCount: files.length,
    archiveEntryCount: entries.size,
    executableSha256: await fileSha256(executable),
    archiveSha256: await fileSha256(archive),
  };
}
