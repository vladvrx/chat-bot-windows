import { spawnSync } from "node:child_process";
import path from "node:path";

import { outputWindowsExecutable } from "./lib/config.mjs";

if (process.platform !== "win32") throw new Error("The Windows native smoke check can only run on Windows.");

const resources = path.join(path.dirname(outputWindowsExecutable), "resources");
const dependencies = path.join(resources, "app.asar.unpacked", "dist", "deps");
const script = `
const path = require("node:path");
const Module = require("node:module");
process.env.NODE_PATH = ${JSON.stringify(dependencies)};
Module.Module._initPaths();
const root = path.join(process.resourcesPath, "app.asar", "dist", "deps");
const Parser = require(path.join(root, "tree-sitter"));
const Bash = require(path.join(root, "tree-sitter-bash"));
const whichLanguage = require(path.join(root, "whichlang-node"));
const treeChunk = require(path.join(root, "@anysphere", "tree-chunk-napi"));
const parser = new Parser();
parser.setLanguage(Bash);
console.log(JSON.stringify({
  electron: process.versions.electron,
  node: process.version,
  modules: process.versions.modules,
  parsedRoot: parser.parse("echo windows").rootNode.type,
  whichLanguage: typeof whichLanguage,
  treeChunk: typeof treeChunk,
}));
`;
const result = spawnSync(outputWindowsExecutable, ["-e", script], {
  encoding: "utf8",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_PATH: dependencies },
  timeout: 30_000,
  windowsHide: true,
});
if (result.error != null) throw result.error;
if (result.status !== 0) throw new Error(`Windows native smoke check failed with ${result.status}: ${result.stderr}`);
const report = JSON.parse(result.stdout.trim());
if (report.electron !== "42.1.0" || report.modules !== "146" || report.parsedRoot !== "program") {
  throw new Error(`Windows native runtime identity is wrong: ${JSON.stringify(report)}`);
}
console.log(`Windows native smoke check passed: ${JSON.stringify(report)}`);
