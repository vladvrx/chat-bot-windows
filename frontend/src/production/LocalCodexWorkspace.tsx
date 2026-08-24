import { useEffect, useMemo, useRef, useState } from "react";
import type { CodexReasoningEffort, DesktopBridge, LocalInferenceModelSelection } from "../recovered/contracts/desktop-bridge";
import { ConversationComposer } from "../recovered/features/conversation/workspace/composer";
import { ConversationAgentHeader } from "../recovered/features/conversation/workspace/chat-header";
import { ConversationSidebar, type SidebarAgent } from "../recovered/features/conversation/workspace/sidebar";
import { ConversationTranscript } from "../recovered/features/conversation/workspace/transcript";
import type { ComposerDraft, TranscriptMessage } from "../recovered/features/conversation/workspace/model";
import { AgentAvatar } from "../recovered/features/conversation/workspace/agent-avatar";
import { AVATAR_COLORS, AVATAR_SHAPES } from "../recovered/features/agent-info/avatar-editor/model";
import { OnboardingCharacter } from "../recovered/features/onboarding/signed-in/character";
import { OverlayDialog } from "../recovered/ui/overlay-primitives";
import { SandButton, SandIcon, SandIconButton } from "../recovered/ui/sand-kit-primitives";
import "./local-codex-workspace.css";

const STORE_KEY = "sand.local-codex.workspace.v2";
const EMPTY_DRAFT: ComposerDraft = { prompt: "", attachments: [] };
const FALLBACK_MODEL: LocalInferenceModelSelection & { readonly reasoningEffort: CodexReasoningEffort } = { modelId: "gpt-5.6-sol", reasoningEffort: "medium" };
const CODEX_MODELS = [
  { id: "gpt-5.6-sol", label: "5.6 Sol" },
  { id: "gpt-5.6-terra", label: "5.6 Terra" },
  { id: "gpt-5.6-luna", label: "5.6 Luna" },
  { id: "gpt-5.5", label: "5.5" },
  { id: "gpt-5.4", label: "5.4" },
] as const;
const REASONING_EFFORTS: readonly { readonly id: CodexReasoningEffort; readonly label: string }[] = [
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
];

function normalizeModelSelection(value: LocalInferenceModelSelection | null | undefined): LocalInferenceModelSelection & { readonly reasoningEffort: CodexReasoningEffort } {
  const modelId = value?.modelId.trim();
  return {
    modelId: modelId == null || modelId.length === 0 ? FALLBACK_MODEL.modelId : modelId,
    reasoningEffort: value?.reasoningEffort ?? FALLBACK_MODEL.reasoningEffort,
  };
}

function modelLabel(modelId: string): string {
  const known = CODEX_MODELS.find((model) => model.id === modelId);
  if (known != null) return known.label;
  return modelId.replace(/^gpt-/i, "").replace(/(^|[-_])([a-z])/g, (_match, separator: string, letter: string) => `${separator === "-" || separator === "_" ? " " : separator}${letter.toUpperCase()}`);
}

interface LocalCodexMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestampMs: number;
}

interface LocalCodexAgent {
  readonly id: string;
  readonly name: string;
  readonly avatarColor: string;
  readonly avatarShape: string;
  readonly instructions: string;
  readonly modelId: string;
  readonly reasoningEffort: CodexReasoningEffort;
  readonly messages: readonly LocalCodexMessage[];
  readonly updatedAt: number;
  readonly isPinned: boolean;
}

interface LocalCodexStore {
  readonly version: 2;
  readonly activeAgentId: string;
  readonly agents: readonly LocalCodexAgent[];
}

function createId(prefix: string): string {
  const value = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function createAgent(name = "Codex", model: LocalInferenceModelSelection = FALLBACK_MODEL): LocalCodexAgent {
  const id = createId("bot");
  return {
    id,
    name,
    avatarColor: "green",
    avatarShape: "blob",
    instructions: "",
    ...normalizeModelSelection(model),
    messages: [],
    updatedAt: Date.now(),
    isPinned: false
  };
}

function defaultStore(model: LocalInferenceModelSelection = FALLBACK_MODEL): LocalCodexStore {
  const agent = createAgent("Codex", model);
  return { version: 2, activeAgentId: agent.id, agents: [agent] };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function parseStore(raw: string | null, defaultModel: LocalInferenceModelSelection = FALLBACK_MODEL): LocalCodexStore | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 2 || !Array.isArray(parsed.agents) || !isString(parsed.activeAgentId)) return null;
    const agents: LocalCodexAgent[] = [];
    for (const value of parsed.agents) {
      if (typeof value !== "object" || value == null) return null;
      const item = value as Record<string, unknown>;
      if (!isString(item.id) || !isString(item.name) || !isString(item.avatarColor) || !isString(item.avatarShape) || !Array.isArray(item.messages)) return null;
      const messages: LocalCodexMessage[] = [];
      for (const messageValue of item.messages) {
        if (typeof messageValue !== "object" || messageValue == null) return null;
        const message = messageValue as Record<string, unknown>;
        if (!isString(message.id) || (message.role !== "user" && message.role !== "assistant") || !isString(message.content) || typeof message.timestampMs !== "number") return null;
        messages.push({ id: message.id, role: message.role, content: message.content, timestampMs: message.timestampMs });
      }
      agents.push({
        id: item.id,
        name: item.name.trim() || "Untitled bot",
        avatarColor: item.avatarColor,
        avatarShape: item.avatarShape,
        instructions: isString(item.instructions) ? item.instructions : "",
        ...normalizeModelSelection({
          modelId: isString(item.modelId) ? item.modelId : defaultModel.modelId,
          reasoningEffort: REASONING_EFFORTS.some((effort) => effort.id === item.reasoningEffort) ? item.reasoningEffort as CodexReasoningEffort : defaultModel.reasoningEffort,
        }),
        messages,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
        isPinned: item.isPinned === true
      });
    }
    if (agents.length === 0) return null;
    const activeAgentId = agents.some((agent) => agent.id === parsed.activeAgentId) ? parsed.activeAgentId : agents[0].id;
    return { version: 2, activeAgentId, agents };
  } catch {
    return null;
  }
}

function projectTranscript(agent: LocalCodexAgent): TranscriptMessage[] {
  return agent.messages.map((message) => ({
    kind: "message",
    id: message.id,
    role: message.role,
    author: message.role === "user" ? "You" : agent.name,
    text: message.content,
    timestampMs: message.timestampMs,
    delivery: "sent"
  }));
}

function projectSidebarAgent(agent: LocalCodexAgent, running: boolean): SidebarAgent {
  const last = agent.messages.at(-1);
  return {
    id: agent.id,
    name: agent.name,
    updatedAt: agent.updatedAt,
    isPinned: agent.isPinned,
    isRunning: running,
    avatarColor: agent.avatarColor,
    avatarShape: agent.avatarShape,
    lastMessage: running ? "Working" : last?.content ?? "Start a conversation",
    lastMessageId: last?.id ?? null,
    lastMessagePreview: last?.content ?? null
  };
}

function instructionPrefix(agent: LocalCodexAgent) {
  const instructions = agent.instructions.trim();
  if (instructions.length === 0) return [];
  return [{
    role: "user" as const,
    content: `You are ${agent.name}. Follow these custom instructions for this conversation:\n${instructions}`
  }];
}

function LocalCodexModelSelector({ disabled, modelId, reasoningEffort, onChange }: {
  readonly disabled: boolean;
  readonly modelId: string;
  readonly reasoningEffort: CodexReasoningEffort;
  readonly onChange: (selection: { readonly modelId: string; readonly reasoningEffort: CodexReasoningEffort }) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const models = CODEX_MODELS.some((model) => model.id === modelId)
    ? CODEX_MODELS
    : [{ id: modelId, label: modelLabel(modelId) }, ...CODEX_MODELS];

  useEffect(() => {
    if (!open) return;
    const closeFromPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeFromPointer);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromPointer);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  const effortLabel = REASONING_EFFORTS.find((effort) => effort.id === reasoningEffort)?.label ?? reasoningEffort;
  return <div className="local-codex-model-selector" ref={rootRef}>
    <button aria-expanded={open} aria-haspopup="dialog" className="local-codex-model-trigger" disabled={disabled} onClick={() => setOpen((value) => !value)} type="button">
      <span>{modelLabel(modelId)} {effortLabel}</span>
      <SandIcon name="chevron-down-small" size="xs" />
    </button>
    {open ? <div aria-label="Codex model and reasoning" className="local-codex-model-menu" role="dialog">
      <section>
        <strong>Model</strong>
        <div role="listbox" aria-label="Model">
          {models.map((model) => <button aria-selected={model.id === modelId} key={model.id} onClick={() => onChange({ modelId: model.id, reasoningEffort })} role="option" type="button">
            <span>{model.label}</span>{model.id === modelId ? <SandIcon name="check" size="xs" /> : null}
          </button>)}
        </div>
      </section>
      <section>
        <strong>Reasoning</strong>
        <div className="local-codex-effort-options" role="listbox" aria-label="Reasoning effort">
          {REASONING_EFFORTS.map((effort) => <button aria-selected={effort.id === reasoningEffort} key={effort.id} onClick={() => onChange({ modelId, reasoningEffort: effort.id })} role="option" type="button">{effort.label}</button>)}
        </div>
      </section>
    </div> : null}
  </div>;
}

function BotCustomizer({ agent, onChange, onClose }: { agent: LocalCodexAgent; onChange(patch: Partial<Pick<LocalCodexAgent, "name" | "avatarColor" | "avatarShape" | "instructions">>): void; onClose(): void }) {
  return <aside aria-label="Customize bot" className="local-codex-customizer">
    <header className="local-codex-customizer__header">
      <div>
        <strong>Customize bot</strong>
        <small>Changes save automatically</small>
      </div>
      <SandIconButton aria-label="Close customizer" icon="close" label="Close" onClick={onClose} size="sm" />
    </header>
    <div className="local-codex-customizer__body">
      <div className="local-codex-character-preview">
        <OnboardingCharacter color={agent.avatarColor} isFollowingPointer shape={agent.avatarShape} sizePx={112} sourceId={agent.id} state="idle" />
        <span>{agent.name}</span>
      </div>

      <label className="local-codex-field">
        <span>Name</span>
        <input maxLength={60} onChange={(event) => onChange({ name: event.currentTarget.value })} spellCheck={false} value={agent.name} />
      </label>

      <fieldset className="local-codex-choice-group">
        <legend>Shape</legend>
        <div className="local-codex-shapes">
          {AVATAR_SHAPES.map((shape) => <button aria-label={`${shape} character shape`} aria-pressed={agent.avatarShape === shape} key={shape} onClick={() => onChange({ avatarShape: shape })} title={shape} type="button">
            <OnboardingCharacter color={agent.avatarColor} paused shape={shape} sizePx={38} sourceId={`${agent.id}-${shape}`} state="idle" />
          </button>)}
        </div>
      </fieldset>

      <fieldset className="local-codex-choice-group">
        <legend>Color</legend>
        <div className="local-codex-colors">
          {AVATAR_COLORS.map((color) => <button aria-label={`${color.label} character color`} aria-pressed={agent.avatarColor === color.id} key={color.id} onClick={() => onChange({ avatarColor: color.id })} title={color.label} type="button">
            <span style={{ backgroundColor: color.value }} />
          </button>)}
        </div>
      </fieldset>

      <label className="local-codex-field">
        <span>Custom instructions</span>
        <textarea onChange={(event) => onChange({ instructions: event.currentTarget.value })} placeholder="How should this bot behave?" rows={6} value={agent.instructions} />
        <small>These instructions are sent privately with each conversation.</small>
      </label>
    </div>
  </aside>;
}

export function LocalCodexWorkspace({ bridge }: { bridge: DesktopBridge }) {
  const [store, setStore] = useState<LocalCodexStore>(defaultStore);
  const [machineDefaultModel, setMachineDefaultModel] = useState(FALLBACK_MODEL);
  const [loaded, setLoaded] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft>>({});
  const [acceptedSendGeneration, setAcceptedSendGeneration] = useState(0);
  const [runningAgentIds, setRunningAgentIds] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [connectionInfoOpen, setConnectionInfoOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocalCodexAgent | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      bridge.agent.clientPersistence.read(STORE_KEY),
      bridge.agent.getLocalInferenceModel().catch(() => FALLBACK_MODEL),
    ]).then(([value, configuredModel]) => {
      if (!active) return;
      const model = normalizeModelSelection(configuredModel);
      setMachineDefaultModel(model);
      setStore(parseStore(value, model) ?? defaultStore(model));
      setLoaded(true);
    }).catch((reason) => {
      if (!active) return;
      setNotice(`Could not load saved chats: ${reason instanceof Error ? reason.message : String(reason)}`);
      setLoaded(true);
    });
    return () => { active = false; };
  }, [bridge]);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      void bridge.agent.clientPersistence.write(STORE_KEY, JSON.stringify(store)).catch((reason) => {
        setNotice(`Could not save changes: ${reason instanceof Error ? reason.message : String(reason)}`);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [bridge, loaded, store]);

  const activeAgent = store.agents.find((agent) => agent.id === store.activeAgentId) ?? store.agents[0];
  const activeRunning = runningAgentIds.has(activeAgent.id);
  const draft = drafts[activeAgent.id] ?? EMPTY_DRAFT;
  const transcript = useMemo(() => projectTranscript(activeAgent), [activeAgent]);
  const sidebarAgents = useMemo(() => store.agents.map((agent) => projectSidebarAgent(agent, runningAgentIds.has(agent.id))), [runningAgentIds, store.agents]);
  const pinnedAgentIds = useMemo(() => store.agents.filter((agent) => agent.isPinned).map((agent) => agent.id), [store.agents]);

  useEffect(() => {
    const transcriptElement = rootRef.current?.querySelector<HTMLElement>(".sand-virtual-transcript");
    if (transcriptElement == null) return;
    transcriptElement.scrollTop = transcriptElement.scrollHeight;
  }, [activeAgent.id, activeRunning, transcript.length]);

  const updateAgent = (agentId: string, patch: Partial<LocalCodexAgent>) => {
    setStore((current) => ({
      ...current,
      agents: current.agents.map((agent) => agent.id === agentId ? { ...agent, ...patch, updatedAt: Date.now() } : agent)
    }));
  };

  const createNewAgent = () => {
    const number = store.agents.length + 1;
    const agent = createAgent(number === 1 ? "Codex" : `Bot ${number}`, machineDefaultModel);
    setStore((current) => ({ ...current, activeAgentId: agent.id, agents: [agent, ...current.agents] }));
    setCustomizerOpen(true);
    setConnectionInfoOpen(false);
    setNotice(null);
  };

  const duplicateAgent = (agentId: string) => {
    const source = store.agents.find((agent) => agent.id === agentId);
    if (source == null) return;
    const duplicate: LocalCodexAgent = {
      ...source,
      id: createId("bot"),
      name: `${source.name} copy`,
      messages: [],
      isPinned: false,
      updatedAt: Date.now()
    };
    setStore((current) => ({ ...current, activeAgentId: duplicate.id, agents: [duplicate, ...current.agents] }));
    setCustomizerOpen(true);
  };

  const deleteAgent = (agentId: string) => {
    setStore((current) => {
      const remaining = current.agents.filter((agent) => agent.id !== agentId);
      if (remaining.length > 0) return { ...current, activeAgentId: current.activeAgentId === agentId ? remaining[0].id : current.activeAgentId, agents: remaining };
      const replacement = createAgent("Codex", machineDefaultModel);
      return { version: 2, activeAgentId: replacement.id, agents: [replacement] };
    });
    setDeleteTarget(null);
    setCustomizerOpen(false);
  };

  const send = async () => {
    const content = draft.prompt.trim();
    if (content.length === 0 || activeRunning) return;
    const agentId = activeAgent.id;
    const userMessage: LocalCodexMessage = { id: createId("message"), role: "user", content, timestampMs: Date.now() };
    const requestMessages = [...activeAgent.messages, userMessage];
    updateAgent(agentId, { messages: requestMessages });
    setDrafts((current) => ({ ...current, [agentId]: EMPTY_DRAFT }));
    setAcceptedSendGeneration((value) => value + 1);
    setRunningAgentIds((current) => new Set([...current, agentId]));
    setNotice(null);
    try {
      const result = await bridge.agent.runLocalInferenceText([
        ...instructionPrefix(activeAgent),
        ...requestMessages.map((message) => ({ role: message.role, content: message.content }))
      ], { modelId: activeAgent.modelId, reasoningEffort: activeAgent.reasoningEffort });
      const assistantMessage: LocalCodexMessage = { id: createId("message"), role: "assistant", content: result.text, timestampMs: Date.now() };
      setStore((current) => ({
        ...current,
        agents: current.agents.map((agent) => agent.id === agentId ? { ...agent, messages: [...agent.messages, assistantMessage], updatedAt: Date.now() } : agent)
      }));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunningAgentIds((current) => {
        const next = new Set(current);
        next.delete(agentId);
        return next;
      });
    }
  };

  const selectAgent = (agentId: string) => {
    setStore((current) => ({ ...current, activeAgentId: agentId }));
    setCustomizerOpen(false);
    setConnectionInfoOpen(false);
    setNotice(null);
  };

  return <div className="sand-shell local-codex-shell" data-runtime="electron" ref={rootRef}>
    <div className="local-codex-layout">
      <div className="local-codex-sidebar-column">
        <ConversationSidebar
          activeAgentId={activeAgent.id}
          agents={sidebarAgents}
          isHostReachable
          isPreviewEnabled={false}
          onDuplicateAgent={duplicateAgent}
          onNewChat={createNewAgent}
          onOpenAgent={selectAgent}
          onOpenProfile={(agentId) => { selectAgent(agentId); setCustomizerOpen(true); }}
          onRenameAgent={(agentId, name) => updateAgent(agentId, { name: name.trim() || "Untitled bot" })}
          onRequestDeleteAgent={(agent) => setDeleteTarget(store.agents.find((candidate) => candidate.id === agent.id) ?? null)}
          onTogglePin={(agentId, isPinned) => updateAgent(agentId, { isPinned })}
          pinnedAgentIds={pinnedAgentIds}
          sidebarLayout={{ expandedWidth: 280, isCollapsed: false }}
        />
        <div className="local-codex-sidebar-footer">
          <button className="local-codex-account" onClick={() => setConnectionInfoOpen((open) => !open)} type="button">
            <span><SandIcon name="check" size="sm" /></span>
            <span><strong>Codex</strong><small>ChatGPT connected</small></span>
          </button>
        </div>
      </div>

      <section className="local-codex-conversation">
        <main className="sand-chat-stage">
          <ConversationAgentHeader
            agent={{
              id: activeAgent.id,
              name: activeAgent.name,
              isRunning: activeRunning,
              isComposingMessage: false,
              awaitingUserResponse: null,
              currentActivity: activeRunning ? { kind: "thinking" } : null,
              avatarDataUrl: null,
              avatarShape: activeAgent.avatarShape,
              avatarColor: activeAgent.avatarColor,
              isSharedRoom: false,
              memberIds: []
            }}
            isComputerActive={activeRunning}
            isInfoOpen={connectionInfoOpen}
            onToggleInfo={() => setConnectionInfoOpen((open) => !open)}
            onToggleSettings={() => setCustomizerOpen((open) => !open)}
            trailing={<SandButton leadingIcon="edit" onClick={() => setCustomizerOpen((open) => !open)} size="sm" variant="secondary">Customize</SandButton>}
          />
          {transcript.length === 0 ? <div className="local-codex-empty">
            <OnboardingCharacter color={activeAgent.avatarColor} isFollowingPointer shape={activeAgent.avatarShape} sizePx={132} sourceId={`${activeAgent.id}-empty`} state="idle" />
            <h1>{activeAgent.name}</h1>
            <p>What should we work on?</p>
            <SandButton onClick={() => setCustomizerOpen(true)} size="sm" variant="secondary">Customize this bot</SandButton>
          </div> : <ConversationTranscript
            entries={transcript}
            isAgentRunning={activeRunning}
            onCopyMessage={(entry) => navigator.clipboard.writeText(entry.text)}
          />}
        </main>
        <div className="sand-chat-input-dock">
          <ConversationComposer
            acceptedSendGeneration={acceptedSendGeneration}
            disabled={activeRunning}
            draft={draft}
            leadingAccessory={<button aria-label="ChatGPT connection details" className="local-codex-trust-button" onClick={() => setConnectionInfoOpen((open) => !open)} title="ChatGPT connected" type="button"><SandIcon name="shield-check" size="sm" /></button>}
            centerControl={<LocalCodexModelSelector
              disabled={activeRunning}
              modelId={activeAgent.modelId}
              onChange={(selection) => updateAgent(activeAgent.id, selection)}
              reasoningEffort={activeAgent.reasoningEffort}
            />}
            notice={notice}
            onChange={(nextDraft) => setDrafts((current) => ({ ...current, [activeAgent.id]: nextDraft }))}
            onStageFiles={() => setNotice("Attachments are not available in the local Codex route yet.")}
            onSubmit={send}
            placeholder="Do anything"
            scopeKey={`local-codex:${activeAgent.id}`}
            sendButtonAppearance="chatgpt"
            transcribeAudio={(audio, mimeType, language) => bridge.transcribeAudio(audio, mimeType, language)}
          />
        </div>
      </section>
    </div>

    {customizerOpen ? <BotCustomizer agent={activeAgent} onChange={(patch) => updateAgent(activeAgent.id, patch)} onClose={() => setCustomizerOpen(false)} /> : null}
    {connectionInfoOpen ? <div className="local-codex-connection-card" role="status">
      <AgentAvatar agentId={activeAgent.id} color={activeAgent.avatarColor} shape={activeAgent.avatarShape} size="lg" state={activeRunning ? "working" : "idle"} />
      <div><strong>Codex is connected</strong><span>This app uses the ChatGPT login already stored by Codex.</span></div>
      <SandIconButton aria-label="Close connection details" icon="close" label="Close" onClick={() => setConnectionInfoOpen(false)} size="sm" />
    </div> : null}

    <OverlayDialog label="Delete bot" onClose={() => setDeleteTarget(null)} open={deleteTarget != null} role="alertdialog">
      <div className="local-codex-delete-dialog">
        <h2>Delete {deleteTarget?.name}?</h2>
        <p>This removes the bot and its local chat history.</p>
        <div><SandButton onClick={() => setDeleteTarget(null)} variant="secondary">Cancel</SandButton><SandButton onClick={() => deleteTarget == null ? undefined : deleteAgent(deleteTarget.id)} sentiment="danger">Delete</SandButton></div>
      </div>
    </OverlayDialog>
  </div>;
}
