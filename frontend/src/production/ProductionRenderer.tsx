import { lazy, Suspense, useEffect, useState } from "react";
import type { CoordinatorPortBridge, DesktopBridge } from "../recovered/contracts/desktop-bridge";
import { LocalCodexWorkspace } from "./LocalCodexWorkspace";

const FullProductionRenderer = lazy(async () => {
  const module = await import("./FullProductionRenderer");
  return { default: module.FullProductionRenderer };
});

export interface ProductionRendererProps {
  bridge: DesktopBridge;
  coordinatorPort: CoordinatorPortBridge;
}

type ProductionRendererMode = "detecting" | "local-codex" | "full";

function StartingRenderer() {
  return <div aria-label="Starting Grok Bot" className="sand-shell" role="status" />;
}

export function ProductionRenderer(props: ProductionRendererProps) {
  const [mode, setMode] = useState<ProductionRendererMode>("detecting");

  useEffect(() => {
    let active = true;
    void props.bridge.agent.getInferenceRouter().then((router) => {
      if (!active) return;
      setMode(router.provider === "codex" && router.local.codex.authenticated ? "local-codex" : "full");
    }, () => {
      if (active) setMode("full");
    });
    return () => { active = false; };
  }, [props.bridge]);

  if (mode === "local-codex") return <LocalCodexWorkspace bridge={props.bridge} />;
  if (mode === "full") return <Suspense fallback={<StartingRenderer />}><FullProductionRenderer {...props} /></Suspense>;
  return <StartingRenderer />;
}
