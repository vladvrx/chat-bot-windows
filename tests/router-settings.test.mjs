import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routerSourcePath = path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/router.ts");

async function loadRouterModule() {
  const source = await readFile(routerSourcePath, "utf8");
  const { code: output } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("router provider preference defaults to Cursor and round-trips every provider", async () => {
  const router = await loadRouterModule();
  assert.deepEqual(router.ROUTER_PROVIDERS.map(({ id }) => id), ["cursor", "claude-code", "codex", "openrouter"]);
  assert.equal(router.parseRouterProviderPreference(null), "cursor");
  assert.equal(router.parseRouterProviderPreference("not-json"), "cursor");
  assert.equal(router.parseRouterProviderPreference(JSON.stringify({ schemaVersion: 1, provider: "unknown" })), "cursor");

  let stored = null;
  const persistence = {
    async read(key) {
      assert.equal(key, router.ROUTER_PROVIDER_PERSISTENCE_KEY);
      return stored;
    },
    async write(key, value) {
      assert.equal(key, router.ROUTER_PROVIDER_PERSISTENCE_KEY);
      stored = value;
    }
  };
  for (const provider of router.ROUTER_PROVIDERS) {
    await router.saveRouterProvider(persistence, provider.id);
    assert.equal(await router.loadRouterProvider(persistence), provider.id);
  }
});

test("settings registry exposes Router with the native settings icon contract", async () => {
  const source = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/view.tsx"), "utf8");
  assert.match(source, /\{ id: "router", label: "Router", icon: "git-branch" \}/);
});

test("Router settings read and update the trusted backend provider", async () => {
  const source = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/desktop-surface.tsx"), "utf8");
  assert.match(source, /bridge\.agent\.getInferenceRouter\(\)/);
  assert.match(source, /bridge\.agent\.setInferenceRouter\(provider\)/);
  assert.doesNotMatch(source, /saveRouterProvider\(/);
});

test("local Codex chat and per-bot model choice are wired through the trusted desktop RPC", async () => {
  const [renderer, workspace, preload, edge, rpc, provider] = await Promise.all([
    readFile(path.join(repoRoot, "frontend/src/production/ProductionRenderer.tsx"), "utf8"),
    readFile(path.join(repoRoot, "frontend/src/production/LocalCodexWorkspace.tsx"), "utf8"),
    readFile(path.join(repoRoot, "source/electron-preload/preload.ts"), "utf8"),
    readFile(path.join(repoRoot, "source/electron-main/main-edge.ts"), "utf8"),
    readFile(path.join(repoRoot, "source/shared/rpc/main.ts"), "utf8"),
    readFile(path.join(repoRoot, "source/host/extensions/inference/provider-session.ts"), "utf8"),
  ]);
  assert.match(renderer, /<LocalCodexWorkspace bridge=\{bridge\}/);
  assert.match(workspace, /ConversationSidebar/);
  assert.match(workspace, /OnboardingCharacter/);
  assert.match(workspace, /runLocalInferenceText\(/);
  assert.match(workspace, /LocalCodexModelSelector/);
  assert.match(workspace, /modelId: activeAgent\.modelId, reasoningEffort: activeAgent\.reasoningEffort/);
  assert.match(preload, /getLocalInferenceModel: \(\) => edge\("getLocalInferenceModel"\)/);
  assert.match(preload, /runLocalInferenceText: \(messages:/);
  assert.match(preload, /\{ messages, model \}/);
  assert.match(edge, /getLocalInferenceModel: \(\) => getConfiguredCodexModelSelection\(\)/);
  assert.match(edge, /runLocalInferenceText: async \(raw\)/);
  assert.match(edge, /\{ codexModel \}/);
  assert.match(rpc, /getLocalInferenceModel: \{ args: "none" \}/);
  assert.match(rpc, /runLocalInferenceText: \{ args: "object" \}/);
  assert.match(provider, /selection\?\.modelId \?\? configured\.modelId/);
  assert.match(provider, /options\?\.codexModel/);
});
