import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { runtimePlatform, runtimeResourcesPath } from "../scripts/lib/runtime.mjs";
import { inspectPeCertificate, stripPeCertificate } from "../scripts/lib/windows-pe.mjs";
import { installWindowsProcessPipeGuards } from "../source/electron-main/windows-process-pipe-guard.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("Windows runtime paths use the portable Electron layout", () => {
  const root = path.join(repositoryRoot, ".cache", "runtime", "windows-x64", "Grok Bot");
  assert.equal(runtimePlatform(root), "win32");
  assert.equal(runtimeResourcesPath(root), path.join(root, "resources"));
});

test("PE certificate stripping removes only a final certificate payload", () => {
  const fixture = Buffer.alloc(512, 0x5a);
  fixture.writeUInt16LE(0x5a4d, 0);
  fixture.writeUInt32LE(64, 0x3c);
  fixture.writeUInt32LE(0x00004550, 64);
  fixture.writeUInt16LE(0x20b, 88);
  const directoryOffset = 88 + 112 + 4 * 8;
  fixture.writeUInt32LE(400, directoryOffset);
  fixture.writeUInt32LE(112, directoryOffset + 4);
  assert.deepEqual(inspectPeCertificate(fixture), {
    peOffset: 64,
    magic: 0x20b,
    directoryOffset,
    fileOffset: 400,
    size: 112,
    endOffset: 512,
  });
  const stripped = stripPeCertificate(fixture);
  assert.equal(stripped.length, 400);
  assert.equal(inspectPeCertificate(stripped).size, 0);
});

test("Windows packaging uses the pinned runtime and a separate executable identity", async () => {
  const [config, bootstrap, packager, verifier, packageJson] = await Promise.all([
    readFile(path.join(repositoryRoot, "scripts/lib/config.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts/bootstrap-runtime.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts/package-windows.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts/lib/windows-package-verification.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ]);
  assert.match(config, /windowsUpstreamAsarSha256 = "38e85c0e5042c0257db7925e1e55709d6d155d90d92fe26ad654127d509766e0"/);
  assert.match(config, /windowsUpstreamShellSha256 = "86719c9dcbfc580b7bc29ece62302401a7622ae577e2cff42b4c525db674f1ca"/);
  assert.match(bootstrap, /sevenZipBin\.path7za/);
  assert.match(packager, /buildFidelityReconstructedAsar/);
  assert.match(packager, /build-frontend\.mjs/);
  assert.match(packager, /windows-custom-renderer\.json/);
  assert.match(packager, /stripPeCertificate/);
  assert.match(packager, /await rcedit\(outputWindowsExecutable/);
  assert.match(verifier, /Reconstructed Windows executable still carries an Authenticode certificate payload/);
  assert.equal(JSON.parse(packageJson).scripts["package:windows"], "npm run check && node scripts/package-windows.mjs");
});

test("Windows GUI launches ignore only broken console pipes", () => {
  const listeners = [];
  const stream = { on(event, listener) { assert.equal(event, "error"); listeners.push(listener); } };
  installWindowsProcessPipeGuards("win32", [stream]);
  assert.equal(listeners.length, 1);
  assert.doesNotThrow(() => listeners[0](Object.assign(new Error("broken pipe"), { code: "EPIPE" })));
  assert.throws(() => listeners[0](Object.assign(new Error("disk failure"), { code: "EIO" })), /disk failure/);
});

test("Windows startup does not require macOS application-folder APIs", async () => {
  const provider = await readFile(path.join(repositoryRoot, "source/electron-main/production-binding-providers.ts"), "utf8");
  assert.match(provider, /if \(platform === "darwin"\) \{\s*requireFunction\(ports\?\.app\?\.isInApplicationsFolder/);
});

test("Windows Codex login accepts ACL-protected files without POSIX mode bits", async () => {
  const [providerSession, localRouter] = await Promise.all([
    readFile(path.join(repositoryRoot, "source/host/extensions/inference/provider-session.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "source/shared/node/inference-router-local.ts"), "utf8"),
  ]);
  const windowsAwareModeCheck = /process\.platform !== "win32" && \(stat\.mode & 0o077\) !== 0/;
  assert.match(providerSession, windowsAwareModeCheck);
  assert.match(localRouter, windowsAwareModeCheck);
});
