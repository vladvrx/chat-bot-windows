import { useEffect, useMemo, useRef, useState } from "react";
import type { CodexReasoningEffort, DesktopBridge, LocalInferenceModelSelection } from "../recovered/contracts/desktop-bridge";
import { ConversationComposer } from "../recovered/features/conversation/workspace/composer";
import { ConversationAgentHeader } from "../recovered/features/conversation/workspace/chat-header";
import { ConversationSidebar, type SidebarAgent } from "../recovered/features/conversation/workspace/sidebar";
import type { ComposerDraft } from "../recovered/features/conversation/workspace/model";
import { AgentAvatar } from "../recovered/features/conversation/workspace/agent-avatar";
import { AVATAR_COLORS, AVATAR_SHAPES } from "../recovered/features/agent-info/avatar-editor/model";
import { OnboardingCharacter } from "../recovered/features/onboarding/signed-in/character";
import { flattenSuggestionDescription, selectOnboardingSuggestions, suggestionIdentities, type OnboardingSuggestion, type SuggestionIdentity } from "../recovered/features/onboarding/signed-in/suggestions";
import { OverlayDialog } from "../recovered/ui/overlay-primitives";
import { SandButton, SandIcon, SandIconButton } from "../recovered/ui/sand-kit-primitives";
import "../recovered/features/conversation/workspace/view.css";
import "./production.css";
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
const LOCAL_BOT_SUGGESTIONS = selectOnboardingSuggestions([], 10);
const LOCAL_BOT_SUGGESTION_IDENTITIES = suggestionIdentities(LOCAL_BOT_SUGGESTIONS);

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

function isIncludedUsageExhausted(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /(?:\b429\b|usage[_ -]?limit|rate[_ -]?limit|resource[_ -]?exhausted|insufficient[_ -]?quota|quota[_ -]?exceeded|out of (?:codex )?usage)/i.test(message);
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

interface NewBotDraft {
  readonly name: string;
  readonly avatarColor: string;
  readonly avatarShape: string;
  readonly instructions: string;
  readonly pickedTemplateId: string | null;
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

const EMPTY_LOCAL_AGENT: LocalCodexAgent = {
  id: "",
  name: "New Bot",
  avatarColor: "green",
  avatarShape: "blob",
  instructions: "",
  modelId: FALLBACK_MODEL.modelId,
  reasoningEffort: FALLBACK_MODEL.reasoningEffort,
  messages: [],
  updatedAt: 0,
  isPinned: false,
};

function newBotDraft(number: number): NewBotDraft {
  return {
    name: number <= 1 ? "Codex" : `Bot ${number}`,
    avatarColor: "green",
    avatarShape: "blob",
    instructions: "",
    pickedTemplateId: null,
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
    if (agents.length === 0) return { version: 2, activeAgentId: "", agents: [] };
    const activeAgentId = agents.some((agent) => agent.id === parsed.activeAgentId) ? parsed.activeAgentId : agents[0].id;
    return { version: 2, activeAgentId, agents };
  } catch {
    return null;
  }
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
    avatarStatic: !running,
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

function LocalCodexTranscript({ agent, running }: { readonly agent: LocalCodexAgent; readonly running: boolean }) {
  return <div aria-live="polite" aria-relevant="additions" className="local-codex-transcript" role="log">
    {agent.messages.map((message) => <article className={`local-codex-message local-codex-message--${message.role}`} key={message.id}>
      {message.role === "assistant" ? <AgentAvatar agentId={agent.id} color={agent.avatarColor} isStatic shape={agent.avatarShape} size="sm" state="idle" /> : null}
      <div className="local-codex-message__content">
        <div className="local-codex-message__bubble">{message.content}</div>
        <button aria-label="Copy message" className="local-codex-message__copy" onClick={() => void navigator.clipboard.writeText(message.content)} title={new Date(message.timestampMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} type="button"><SandIcon name="copy" size="xs" /></button>
      </div>
    </article>)}
    {running ? <article aria-label={`${agent.name} is thinking`} className="local-codex-message local-codex-message--assistant">
      <AgentAvatar agentId={agent.id} color={agent.avatarColor} shape={agent.avatarShape} size="sm" state="working" />
      <div className="local-codex-thinking" role="status"><span /><span /><span /></div>
    </article> : null}
  </div>;
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

function NewBotPage({ canCancel, draft, onCancel, onChange, onCreate }: {
  readonly canCancel: boolean;
  readonly draft: NewBotDraft;
  readonly onCancel: () => void;
  readonly onChange: (draft: NewBotDraft) => void;
  readonly onCreate: () => void;
}) {
  const pickSuggestion = (suggestion: OnboardingSuggestion, identity: SuggestionIdentity) => {
    onChange({
      name: suggestion.name,
      avatarColor: identity.color,
      avatarShape: identity.shape,
      instructions: flattenSuggestionDescription(suggestion.description),
      pickedTemplateId: suggestion.templateId,
    });
  };

  return <section className="local-codex-new-bot" aria-labelledby="local-codex-new-bot-title">
    <header className="local-codex-new-bot__header">
      <SandIconButton aria-label="Cancel new bot" disabled={!canCancel} icon="arrow-left" label="Back" onClick={onCancel} size="sm" />
      <h1 id="local-codex-new-bot-title">New Bot</h1>
    </header>
    <div className="local-codex-new-bot__body">
      <section className="local-codex-new-bot__editor" aria-label="Bot details">
        <div className="local-codex-new-bot__preview">
          <OnboardingCharacter color={draft.avatarColor} isFollowingPointer shape={draft.avatarShape} sizePx={96} sourceId="local-new-bot" state="happy" />
          <div>
            <h2>{draft.name.trim() || "New Bot"}</h2>
            <p>Give this bot a job, then change how the little guy looks.</p>
          </div>
        </div>

        <label className="local-codex-field">
          <span>Name</span>
          <input autoFocus maxLength={60} onChange={(event) => onChange({ ...draft, name: event.currentTarget.value, pickedTemplateId: null })} placeholder="New Bot" spellCheck={false} value={draft.name} />
        </label>

        <label className="local-codex-field">
          <span>Job</span>
          <textarea onChange={(event) => onChange({ ...draft, instructions: event.currentTarget.value, pickedTemplateId: null })} placeholder="What should this bot do?" rows={4} value={draft.instructions} />
        </label>

        <fieldset className="local-codex-choice-group">
          <legend>Character</legend>
          <div className="local-codex-shapes">
            {AVATAR_SHAPES.map((shape) => <button aria-label={`${shape} character shape`} aria-pressed={draft.avatarShape === shape} key={shape} onClick={() => onChange({ ...draft, avatarShape: shape })} title={shape} type="button">
              <OnboardingCharacter color={draft.avatarColor} paused shape={shape} sizePx={38} sourceId={`new-${shape}`} state="idle" />
            </button>)}
          </div>
        </fieldset>

        <fieldset className="local-codex-choice-group">
          <legend>Color</legend>
          <div className="local-codex-colors">
            {AVATAR_COLORS.map((color) => <button aria-label={`${color.label} character color`} aria-pressed={draft.avatarColor === color.id} key={color.id} onClick={() => onChange({ ...draft, avatarColor: color.id })} title={color.label} type="button">
              <span style={{ backgroundColor: color.value }} />
            </button>)}
          </div>
        </fieldset>

        <div className="local-codex-new-bot__create">
          <SandButton disabled={!canCancel} onClick={onCancel} variant="secondary">Cancel</SandButton>
          <SandButton disabled={draft.name.trim().length === 0} onClick={onCreate} sentiment="accent">Get started</SandButton>
        </div>
      </section>

      <section aria-label="Suggestions" className="local-codex-suggestions">
        <div className="local-codex-suggestions__heading">
          <div><h2>Suggestions</h2><p>Start with one of the jobs recovered from Grok Bot 0.18.</p></div>
          <span>{LOCAL_BOT_SUGGESTIONS.length} ideas</span>
        </div>
        <div className="local-codex-suggestions__grid">
          {LOCAL_BOT_SUGGESTIONS.map((suggestion, index) => {
            const identity = LOCAL_BOT_SUGGESTION_IDENTITIES[index] ?? { color: "orange", shape: "blob" };
            return <button aria-pressed={draft.pickedTemplateId === suggestion.templateId} className="local-codex-suggestion-card" key={suggestion.templateId} onClick={() => pickSuggestion(suggestion, identity)} style={{ animationDelay: `${index * 45}ms` }} type="button">
              <OnboardingCharacter color={identity.color} paused shape={identity.shape} sizePx={46} sourceId={`suggestion-${suggestion.templateId}`} state="idle" />
              <span><strong>{suggestion.name}</strong><small>{flattenSuggestionDescription(suggestion.description)}</small></span>
              {draft.pickedTemplateId === suggestion.templateId ? <SandIcon name="check" size="sm" /> : null}
            </button>;
          })}
        </div>
      </section>
    </div>
  </section>;
}

function BotCustomizer({ agent, onChange, onClearChat, onClose, onDelete, onDuplicate }: {
  readonly agent: LocalCodexAgent;
  readonly onChange: (patch: Partial<Pick<LocalCodexAgent, "name" | "avatarColor" | "avatarShape" | "instructions">>) => void;
  readonly onClearChat: () => void;
  readonly onClose: () => void;
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
}) {
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

      <section className="local-codex-bot-actions" aria-label="Bot actions">
        <span>Bot actions</span>
        <SandButton leadingIcon="copy" onClick={onDuplicate} variant="secondary">Duplicate bot</SandButton>
        <SandButton disabled={agent.messages.length === 0} leadingIcon="trash" onClick={onClearChat} variant="secondary">Clear chat</SandButton>
        <SandButton leadingIcon="trash" onClick={onDelete} sentiment="danger" variant="secondary">Delete bot</SandButton>
      </section>
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
  const [includedUsageExhausted, setIncludedUsageExhausted] = useState(false);
  const [paidCreditsOpen, setPaidCreditsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocalCodexAgent | null>(null);
  const [clearChatTarget, setClearChatTarget] = useState<LocalCodexAgent | null>(null);
  const [page, setPage] = useState<"chat" | "new-bot">("chat");
  const [newAgentDraft, setNewAgentDraft] = useState<NewBotDraft>(() => newBotDraft(2));
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

  const activeAgent = store.agents.find((agent) => agent.id === store.activeAgentId) ?? store.agents[0] ?? EMPTY_LOCAL_AGENT;
  const activeRunning = runningAgentIds.has(activeAgent.id);
  const draft = drafts[activeAgent.id] ?? EMPTY_DRAFT;
  const sidebarAgents = useMemo(() => store.agents.map((agent) => projectSidebarAgent(agent, runningAgentIds.has(agent.id))), [runningAgentIds, store.agents]);
  const pinnedAgentIds = useMemo(() => store.agents.filter((agent) => agent.isPinned).map((agent) => agent.id), [store.agents]);

  useEffect(() => {
    const transcriptElement = rootRef.current?.querySelector<HTMLElement>(".local-codex-transcript");
    if (transcriptElement == null) return;
    transcriptElement.scrollTop = transcriptElement.scrollHeight;
  }, [activeAgent.id, activeAgent.messages.length, activeRunning]);

  const updateAgent = (agentId: string, patch: Partial<LocalCodexAgent>) => {
    setStore((current) => ({
      ...current,
      agents: current.agents.map((agent) => agent.id === agentId ? { ...agent, ...patch, updatedAt: Date.now() } : agent)
    }));
  };

  const createNewAgent = () => {
    setNewAgentDraft(newBotDraft(store.agents.length + 1));
    setPage("new-bot");
    setCustomizerOpen(false);
    setConnectionInfoOpen(false);
    setNotice(null);
  };

  const createAgentFromDraft = () => {
    const name = newAgentDraft.name.trim();
    if (name.length === 0) return;
    const agent: LocalCodexAgent = {
      ...createAgent(name, machineDefaultModel),
      avatarColor: newAgentDraft.avatarColor,
      avatarShape: newAgentDraft.avatarShape,
      instructions: newAgentDraft.instructions.trim(),
    };
    setStore((current) => ({ ...current, activeAgentId: agent.id, agents: [agent, ...current.agents] }));
    setPage("chat");
    setCustomizerOpen(false);
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
    setPage("chat");
    setCustomizerOpen(true);
  };

  const clearAgentChat = (agentId: string) => {
    updateAgent(agentId, { messages: [] });
    setDrafts((current) => ({ ...current, [agentId]: EMPTY_DRAFT }));
    setClearChatTarget(null);
    setCustomizerOpen(false);
  };

  const deleteAgent = (agentId: string) => {
    const deletingLastAgent = store.agents.length === 1 && store.agents[0]?.id === agentId;
    setStore((current) => {
      const remaining = current.agents.filter((agent) => agent.id !== agentId);
      if (remaining.length > 0) return { ...current, activeAgentId: current.activeAgentId === agentId ? remaining[0].id : current.activeAgentId, agents: remaining };
      return { version: 2, activeAgentId: "", agents: [] };
    });
    setDeleteTarget(null);
    setCustomizerOpen(false);
    if (deletingLastAgent) {
      setNewAgentDraft(newBotDraft(1));
      setPage("new-bot");
    } else {
      setPage("chat");
    }
  };

  const send = async () => {
    const content = draft.prompt.trim();
    if (activeAgent.id.length === 0 || content.length === 0 || activeRunning) return;
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
      if (isIncludedUsageExhausted(reason)) {
        setIncludedUsageExhausted(true);
        setNotice("Included Codex usage is unavailable. Grok Bot stopped and did not switch to a paid API provider.");
      } else {
        setNotice(reason instanceof Error ? reason.message : String(reason));
      }
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
    setPage("chat");
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
            <span><strong>Codex</strong><small>Included usage only</small></span>
          </button>
        </div>
      </div>

      {page === "new-bot" ? <NewBotPage canCancel={store.agents.length > 0} draft={newAgentDraft} onCancel={() => setPage("chat")} onChange={setNewAgentDraft} onCreate={createAgentFromDraft} /> : <section className="local-codex-conversation">
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
              avatarStatic: !activeRunning,
              isSharedRoom: false,
              memberIds: []
            }}
            isComputerActive={activeRunning}
            isInfoOpen={connectionInfoOpen}
            onToggleInfo={() => setConnectionInfoOpen((open) => !open)}
            onToggleSettings={() => setCustomizerOpen((open) => !open)}
            trailing={<div className="local-codex-header-actions">
              <SandIconButton aria-label={`Delete ${activeAgent.name}`} icon="trash" label="Delete" onClick={() => setDeleteTarget(activeAgent)} sentiment="danger" size="sm" />
              <SandButton leadingIcon="edit" onClick={() => setCustomizerOpen((open) => !open)} size="sm" variant="secondary">Customize</SandButton>
            </div>}
          />
          {activeAgent.messages.length === 0 ? <div className="local-codex-empty">
            <OnboardingCharacter color={activeAgent.avatarColor} isFollowingPointer shape={activeAgent.avatarShape} sizePx={132} sourceId={`${activeAgent.id}-empty`} state="idle" />
            <h1>{activeAgent.name}</h1>
            <p>What should we work on?</p>
            <SandButton onClick={() => setCustomizerOpen(true)} size="sm" variant="secondary">Customize this bot</SandButton>
          </div> : <LocalCodexTranscript agent={activeAgent} running={activeRunning} />}
        </main>
        <div className="sand-chat-input-dock">
          <ConversationComposer
            acceptedSendGeneration={acceptedSendGeneration}
            disabled={activeRunning}
            draft={draft}
            editorMode="plain"
            leadingAccessory={<button aria-label="ChatGPT connection details" className="local-codex-trust-button" onClick={() => setConnectionInfoOpen((open) => !open)} title="Included Codex usage only" type="button"><SandIcon name="shield-check" size="sm" /></button>}
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
      </section>}
    </div>

    {customizerOpen ? <BotCustomizer
      agent={activeAgent}
      onChange={(patch) => updateAgent(activeAgent.id, patch)}
      onClearChat={() => setClearChatTarget(activeAgent)}
      onClose={() => setCustomizerOpen(false)}
      onDelete={() => setDeleteTarget(activeAgent)}
      onDuplicate={() => duplicateAgent(activeAgent.id)}
    /> : null}
    {connectionInfoOpen ? <div className="local-codex-connection-card" role="status">
      <AgentAvatar agentId={activeAgent.id} color={activeAgent.avatarColor} isStatic={!activeRunning} shape={activeAgent.avatarShape} size="lg" state={activeRunning ? "working" : "idle"} />
      <div><strong>Included Codex usage only</strong><span>This route is pinned to the ChatGPT login stored by Codex. Metered API providers are off.</span></div>
      <SandIconButton aria-label="Close connection details" icon="close" label="Close" onClick={() => setConnectionInfoOpen(false)} size="sm" />
    </div> : null}

    <OverlayDialog label="Included Codex usage unavailable" onClose={() => setIncludedUsageExhausted(false)} open={includedUsageExhausted} role="alertdialog">
      <div className="local-codex-delete-dialog">
        <h2>Included Codex usage is unavailable</h2>
        <p>Grok Bot stopped. It will not switch to OpenRouter, Claude, or another metered API provider.</p>
        <div><SandButton onClick={() => setIncludedUsageExhausted(false)} variant="secondary">Close</SandButton><SandButton onClick={() => { setIncludedUsageExhausted(false); setPaidCreditsOpen(true); }}>Paid credits...</SandButton></div>
      </div>
    </OverlayDialog>
    <OverlayDialog label="Paid credits" onClose={() => setPaidCreditsOpen(false)} open={paidCreditsOpen} role="dialog">
      <div className="local-codex-delete-dialog">
        <h2>Paid credits are separate</h2>
        <p>They are not enabled in Grok Bot. OpenAI does not document a client-side control that guarantees purchased Codex credits stay unused, so this app will not silently opt you in.</p>
        <div><SandButton onClick={() => setPaidCreditsOpen(false)}>Got it</SandButton></div>
      </div>
    </OverlayDialog>

    <OverlayDialog label="Delete bot" onClose={() => setDeleteTarget(null)} open={deleteTarget != null} role="alertdialog">
      <div className="local-codex-delete-dialog">
        <h2>Delete {deleteTarget?.name}?</h2>
        <p>This removes the bot and its local chat history.</p>
        <div><SandButton onClick={() => setDeleteTarget(null)} variant="secondary">Cancel</SandButton><SandButton onClick={() => deleteTarget == null ? undefined : deleteAgent(deleteTarget.id)} sentiment="danger">Delete</SandButton></div>
      </div>
    </OverlayDialog>
    <OverlayDialog label="Clear chat" onClose={() => setClearChatTarget(null)} open={clearChatTarget != null} role="alertdialog">
      <div className="local-codex-delete-dialog">
        <h2>Clear {clearChatTarget?.name}'s chat?</h2>
        <p>This removes every message but keeps the bot and its settings.</p>
        <div><SandButton onClick={() => setClearChatTarget(null)} variant="secondary">Cancel</SandButton><SandButton onClick={() => clearChatTarget == null ? undefined : clearAgentChat(clearChatTarget.id)} sentiment="danger">Clear chat</SandButton></div>
      </div>
    </OverlayDialog>
  </div>;
}
