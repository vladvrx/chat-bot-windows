import { outputWindowsDir } from "./lib/config.mjs";
import { verifyReconstructedWindowsPackage } from "./lib/windows-package-verification.mjs";

if (process.platform !== "win32") throw new Error("Windows package verification can only run on Windows.");

const verification = await verifyReconstructedWindowsPackage({ packageRoot: outputWindowsDir });
console.log(`Verified Windows application: ${verification.executable}`);
console.log(`Executable SHA-256: ${verification.executableSha256}`);
console.log(`ASAR SHA-256: ${verification.archiveSha256}`);
