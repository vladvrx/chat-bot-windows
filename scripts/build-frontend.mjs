import path from "node:path";
import { spawnSync } from "node:child_process";

import { repoRoot } from "./lib/config.mjs";

const viteCli = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const config = path.join(repoRoot, "frontend", "vite.config.mjs");
const finalOutput = path.join(repoRoot, ".build", "frontend-shell");
const windowsOutput = path.join(process.env.LOCALAPPDATA ?? process.env.TEMP ?? repoRoot, "grok-bot-reconstructed", "frontend-shell");
const buildOutput = process.platform === "win32" ? windowsOutput : finalOutput;

const build = spawnSync(
  process.execPath,
  [viteCli, "build", "--configLoader", "native", "--config", config],
  {
    cwd: repoRoot,
    env: { ...process.env, GROK_FRONTEND_OUT_DIR: buildOutput },
    stdio: "inherit"
  }
);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

if (process.platform === "win32") {
  console.log(`Windows frontend build: ${buildOutput}`);
}
