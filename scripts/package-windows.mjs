import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { rcedit } from "rcedit";

import { buildFidelityReconstructedAsar } from "./clean-build.mjs";
import { packStagedAppWithIntegrity } from "./lib/asar-integrity.mjs";
import {
  fidelityStagedAppDir,
  outputDir,
  outputWindowsDir,
  outputWindowsExecutable,
  reconstructedName,
} from "./lib/config.mjs";
import { runtimeResourcesPath } from "./lib/runtime.mjs";
import { stripPeCertificate } from "./lib/windows-pe.mjs";
import {
  verifyOfficialWindowsReference,
  verifyReconstructedWindowsPackage,
} from "./lib/windows-package-verification.mjs";

if (process.platform !== "win32") throw new Error("The reconstructed Windows application can only be packaged on Windows.");

const { builtAsar: fidelityAsar, runtimeApp } = await buildFidelityReconstructedAsar({ productName: reconstructedName });
await verifyOfficialWindowsReference({ runtimeRoot: runtimeApp });

const frontendBuild = spawnSync(process.execPath, [path.join("scripts", "build-frontend.mjs")], { cwd: process.cwd(), stdio: "inherit" });
if (frontendBuild.error) throw frontendBuild.error;
if (frontendBuild.status !== 0) throw new Error(`Windows source renderer build failed with exit code ${frontendBuild.status ?? "unknown"}.`);
const frontendOutput = path.join(process.env.LOCALAPPDATA ?? process.env.TEMP ?? process.cwd(), "grok-bot-reconstructed", "frontend-shell");
const stagedRenderer = path.join(fidelityStagedAppDir, "dist", "renderer");
await rm(stagedRenderer, { recursive: true, force: true });
await cp(frontendOutput, stagedRenderer, { recursive: true, dereference: false, preserveTimestamps: true });
await writeFile(path.join(fidelityStagedAppDir, "dist", "windows-custom-renderer.json"), `${JSON.stringify({ schemaVersion: 1, renderer: "frontend-source", purpose: "customizable Codex workspace" }, null, 2)}\n`);
const builtAsar = path.join(path.dirname(fidelityAsar), "app-windows-custom.asar");
const builtAsarUnpacked = `${builtAsar}.unpacked`;
await rm(builtAsar, { force: true });
await rm(builtAsarUnpacked, { recursive: true, force: true });
await packStagedAppWithIntegrity({ stageRoot: fidelityStagedAppDir, archivePath: builtAsar, unpackedRoot: builtAsarUnpacked });

await mkdir(outputDir, { recursive: true });
await rm(outputWindowsDir, { recursive: true, force: true });
await cp(runtimeApp, outputWindowsDir, { recursive: true, dereference: false, preserveTimestamps: true });

const resources = runtimeResourcesPath(outputWindowsDir);
const packagedAsar = path.join(resources, "app.asar");
const packagedUnpacked = `${packagedAsar}.unpacked`;
await rm(packagedAsar, { force: true });
await rm(packagedUnpacked, { recursive: true, force: true });
await cp(builtAsar, packagedAsar);
await cp(builtAsarUnpacked, packagedUnpacked, { recursive: true, dereference: false, preserveTimestamps: true });

const officialExecutable = path.join(outputWindowsDir, "Grok Bot.exe");
await rename(officialExecutable, outputWindowsExecutable);
await writeFile(outputWindowsExecutable, stripPeCertificate(await readFile(outputWindowsExecutable)));
await rcedit(outputWindowsExecutable, {
  "file-version": "0.18.0.0",
  "product-version": "0.18.0.0",
  "requested-execution-level": "asInvoker",
  "version-string": {
    CompanyName: "Unofficial reconstruction",
    FileDescription: reconstructedName,
    InternalName: reconstructedName,
    LegalCopyright: "Unofficial research build",
    OriginalFilename: path.basename(outputWindowsExecutable),
    ProductName: reconstructedName,
  },
});

const verification = await verifyReconstructedWindowsPackage({ packageRoot: outputWindowsDir });
console.log(`Packaged Windows application: ${verification.executable}`);
console.log(`Windows package inventory: ${verification.fileCount} files, ${verification.archiveEntryCount} ASAR entries`);
