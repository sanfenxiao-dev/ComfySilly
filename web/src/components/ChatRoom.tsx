import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  ArrowLeft,
  ArrowDown,
  Send,
  Plus,
  Trash2,
  History,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Square,
  GitBranch,
  Pencil,
  Copy,
  Check,
  RotateCcw,
  Download,
  ShieldCheck,
  Search,
  PanelLeftClose,
  PanelLeft,
  FileText,
} from 'lucide-react';
import type { CharacterCardData, ChatSession, ChatMessage } from './CharacterShelf';
import type { AppSettings } from './SettingsModal';
import { personaOf, preferencesOf } from '../types/settings';
import { Avatar } from './Avatar';
import { ConfirmDialog, Dialog } from './Dialog';
import { MessageContent } from './MessageContent';
import { InteractiveFrame } from './InteractiveFrame';
import { useCardRuntime } from '../runtime/useCardRuntime';
import {
  getHelperScripts,
  applyDisplayRules,
  splitMessageParts,
} from '../utils/messagePresentation';
import type { DisplayRule } from '../utils/messagePresentation';
import { extractRegexRulesFromPreset } from '../utils/presetImporter';
import type { SillyPresetJson } from '../utils/presetImporter';
import { compilePrompt, generationBudget } from '../utils/promptCompiler';
import { cardTrustKey, readCardTrust, writeCardTrust } from '../utils/cardTrust';
import type { PromptBook, PromptCompilation } from '../utils/promptCompiler';
import { generateChat, cancelGeneration } from '../utils/generation';
import {
  addVariant,
  chooseVariant,
  variantsOf,
  forkSession,
  checkpointSession,
  sessionMarkdown,
} from '../utils/chatHistory';
interface ChatRoomProps {
  character: CharacterCardData;
  settings?: AppSettings;
  preset?: SillyPresetJson;
  presetName?: string;
  presetKey?: string;
  presets?: Array<{ name: string; path: string }>;
  onSelectPreset?: (name: string, path: string) => Promise<void | boolean>;
  worldbooks?: PromptBook[];
  onOpenSettings?: () => void;
  initialSessionId?: string;
  onBackToShelf: () => void;
  onUpdateCharacterSessions: (updated: CharacterCardData) => void | Promise<void>;
  onPatchCharacter?: (patch: Partial<CharacterCardData>) => void | Promise<void>;
  onOpenLorebookModal: () => void;
}
const now = () => new Date().toISOString();
function makeSession(
  character: CharacterCardData,
  title: string,
  opening = character.first_mes || '新的相遇，新的故事。',
): ChatSession {
  return {
    id: crypto.randomUUID(),
    title,
    updatedAt: now(),
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        name: character.name,
        content: opening,
        timestamp: now(),
      },
    ],
  };
}
export function ChatRoom({
  character,
  settings,
  preset,
  presetName = '默认预设',
  presetKey = presetName,
  presets = [],
  onSelectPreset,
  worldbooks,
  onOpenSettings,
  initialSessionId,
  onBackToShelf,
  onUpdateCharacterSessions,
  onPatchCharacter,
  onOpenLorebookModal,
}: ChatRoomProps) {
  const persona = personaOf(settings),
    prefs = preferencesOf(settings);
  const provider = settings?.providers.find((p) => p.id === settings.activeProviderId);
  const rules = useMemo<DisplayRule[]>(
    () => [
      ...extractRegexRulesFromPreset(preset || {}),
      ...(Array.isArray(character.extensions?.regex_scripts)
        ? character.extensions.regex_scripts
        : []),
    ],
    [character.extensions, preset],
  );
  const helperScripts = useMemo(
    () =>
      getHelperScripts({
        tavern_helper: character.extensions?.tavern_helper,
        TavernHelper_scripts: character.extensions?.TavernHelper_scripts,
      }),
    [character.extensions?.tavern_helper, character.extensions?.TavernHelper_scripts],
  );
  const greetings = useMemo<string[]>(
    () =>
      Array.isArray(character.extensions?.alternate_greetings)
        ? character.extensions.alternate_greetings.filter(
            (g: unknown): g is string => typeof g === 'string',
          )
        : [],
    [character.extensions],
  );
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    character.sessions?.length ? character.sessions : [makeSession(character, '初始开局')],
  );
  const [activeId, setActiveId] = useState(
    () =>
      sessions.find((s) => s.id === initialSessionId)?.id ??
      sessions.find((s) => s.id === character.activeSessionId)?.id ??
      sessions[0].id,
  );
  const sessionsRef = useRef(sessions);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const current = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const [visibleCount, setVisibleCount] = useState(80);
  const olderAnchor = useRef<{ height: number; top: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [input, setInput] = useState('');
  const trustPayload = useMemo(
    () =>
      JSON.stringify({
        id: character.id,
        first_mes: character.first_mes,
        extensions: {
          alternate_greetings: character.extensions?.alternate_greetings,
          regex_scripts: character.extensions?.regex_scripts,
          tavern_helper: character.extensions?.tavern_helper,
          TavernHelper_scripts: character.extensions?.TavernHelper_scripts,
        },
      }),
    [
      character.id,
      character.first_mes,
      character.extensions?.alternate_greetings,
      character.extensions?.regex_scripts,
      character.extensions?.tavern_helper,
      character.extensions?.TavernHelper_scripts,
    ],
  );
  const [trust, setTrust] = useState({ source: '', key: '', enabled: false });
  const trusted = trust.source === trustPayload && trust.enabled;
  useEffect(() => {
    let cancelled = false;
    void cardTrustKey(JSON.parse(trustPayload))
      .then((key) => {
        if (!cancelled)
          setTrust({ source: trustPayload, key, enabled: readCardTrust(key, character.id) });
      })
      .catch((error) => {
        if (!cancelled) setNotice(`无法读取卡片信任记录：${String(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [trustPayload, character.id]);
  const [switchingPreset, setSwitchingPreset] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState({ contextWindow: 32768, maxOutputTokens: 4096 });
  const [budgetOverrides, setBudgetOverrides] = useState<
    Record<string, { contextWindow: number; maxOutputTokens: number }>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem('comfysilly:generation-budgets') || '{}') || {};
    } catch {
      return {};
    }
  });
  const budgetOverride = budgetOverrides[presetKey];
  const effectivePreset = useMemo(
    () =>
      budgetOverride
        ? {
            ...preset,
            openai_max_context: budgetOverride.contextWindow,
            openai_max_tokens: budgetOverride.maxOutputTokens,
          }
        : preset,
    [preset, budgetOverride],
  );
  const budget = generationBudget(effectivePreset);
  const [scriptButtons, setScriptButtons] = useState<Array<{ name: string; visible?: boolean }>>(
    [],
  );
  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState('');
  const generation = useRef<{ id: string; sessionId: string; partial: string } | null>(null);
  const [lastPrompt, setLastPrompt] = useState<PromptCompilation | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [greetingOpen, setGreetingOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleting, setDeleting] = useState<ChatSession | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [copied, setCopied] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const autoScrollPausedUntil = useRef(0);
  const [below, setBelow] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const pendingWrites = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (generation.current) void cancelGeneration(generation.current.id).catch(() => {});
    };
  }, []);
  const syncSessions = (next: ChatSession[], selected = activeRef.current) => {
    const snapshots = next.map((s) => (s.id === selected ? checkpointSession(s) : s));
    sessionsRef.current = snapshots;
    activeRef.current = selected;
    setSessions(snapshots);
    setActiveId(selected);
    pendingWrites.current++;
    setSaving(true);
    const updated = { ...character, sessions: snapshots, activeSessionId: selected };
    const write = saveQueue.current.catch(() => {}).then(() => onUpdateCharacterSessions(updated));
    saveQueue.current = write;
    void write
      .then(
        () => {
          if (mounted.current) setSaveError(false);
        },
        (error) => {
          if (mounted.current) {
            setSaveError(true);
            setNotice(`保存失败，记录仍在内存中。请重试保存，暂勿关闭窗口：${String(error)}`);
          }
        },
      )
      .finally(() => {
        pendingWrites.current--;
        if (mounted.current) setSaving(pendingWrites.current > 0);
      });
    return write;
  };
  const initialize = useRef(false);
  useEffect(() => {
    if (initialize.current) return;
    initialize.current = true;
    if (!character.sessions?.length || character.activeSessionId !== activeId)
      void syncSessions(sessions, activeId).catch(() => {});
  }, []);
  useLayoutEffect(() => {
    const anchor = olderAnchor.current,
      el = viewport.current;
    if (anchor && el) {
      el.scrollTop = anchor.top + el.scrollHeight - anchor.height;
      olderAnchor.current = null;
    }
  }, [visibleCount]);
  const scrollDown = (smooth = true, automatic = false) => {
    if (automatic && (!nearBottom.current || Date.now() < autoScrollPausedUntil.current)) return;
    const el = viewport.current;
    if (el)
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth && prefs.motion === 'full' ? 'smooth' : 'instant',
      });
    nearBottom.current = true;
    setBelow(false);
  };
  useEffect(() => {
    if (prefs.autoScroll && nearBottom.current) {
      const id = requestAnimationFrame(() => scrollDown(false, true));
      return () => cancelAnimationFrame(id);
    }
  }, [current.messages, streamText, prefs.autoScroll]);
  useEffect(() => {
    nearBottom.current = true;
    setEditing(null);
    setVisibleCount(80);
    setBelow(false);
    const id = requestAnimationFrame(() => scrollDown(false));
    return () => cancelAnimationFrame(id);
  }, [current.id]);
  useEffect(() => {
    const el = viewport.current?.firstElementChild;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      if (prefs.autoScroll && nearBottom.current) scrollDown(false, true);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [current.id, prefs.autoScroll]);
  const compile = (history: ChatSession['messages'], sessionId = current.id) =>
    compilePrompt({
      character,
      preset: effectivePreset,
      history,
      worldbooks,
      userName: persona.name,
      personaDescription: persona.description,
      variables: sessionsRef.current.find((s) => s.id === sessionId)?.runtimeVariables?.chat,
      overflowPolicy: 'trim-history',
    });
  const updateSession = (session: ChatSession) =>
    syncSessions(
      sessionsRef.current.map((s) => (s.id === session.id ? session : s)),
      session.id,
    );
  const report = (action: () => void | Promise<unknown>) => {
    try {
      const result = action();
      if (result && typeof result === 'object' && 'catch' in result)
        void result.catch((e) => setNotice(String(e)));
    } catch (e) {
      setNotice(String(e));
    }
  };
  const runGeneration = async (
    sessionId: string,
    history: ChatSession['messages'],
    replaceId?: string,
  ) => {
    if (generation.current) return;
    if (!provider?.model) {
      setNotice('消息已保存。请先在设置中配置并保存 AI 提供商和模型。');
      return;
    }
    const state = { id: crypto.randomUUID(), sessionId, partial: '' };
    generation.current = state;
    setGenerating(true);
    setStreamText('');
    setNotice('正在编译提示词并连接模型…');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let applied = false;
    const finish = async (text: string) => {
      if (!text.trim() || applied) return;
      applied = true;
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return;
      const messages = replaceId
        ? session.messages.map((m) =>
            m.id === replaceId ? addVariant(m, text, 'generated', session.runtimeVariables) : m,
          )
        : [
            ...session.messages,
            {
              id: crypto.randomUUID(),
              role: 'assistant' as const,
              name: character.name,
              content: text,
              timestamp: now(),
            },
          ];
      if (replaceId)
        pendingUiEvent.current = {
          sessionId,
          name: 'message_swiped',
          index: messages.findIndex((m) => m.id === replaceId),
        };
      await updateSession({ ...session, messages, updatedAt: now() });
    };
    try {
      const compiled = compile(history, sessionId);
      setLastPrompt(compiled);
      const historyWarning = compiled.warnings.find((w) => w.startsWith('本次请求省略'));
      setNotice(
        `正在请求 ${provider.model} · 约 ${compiled.estimatedTokens} tokens（字符估算）${compiled.warnings.length ? ` · ${compiled.warnings.length} 项兼容性提示` : ''}${historyWarning ? ` · ${historyWarning}` : ''}`,
      );
      const result = await generateChat(
        {
          providerId: provider.id,
          requestId: state.id,
          messages: compiled.messages,
          maxTokens: compiled.budget.maxOutputTokens,
          temperature: preset?.temperature,
          topP: preset?.top_p,
        },
        (delta) => {
          state.partial += delta;
          if (!timer)
            timer = setTimeout(() => {
              if (mounted.current) setStreamText(state.partial);
              timer = undefined;
            }, 50);
        },
      );
      await finish(result.text);
      setNotice(
        `回复完成 · ${provider.model}${result.usage ? ` · 用量 ${JSON.stringify(result.usage)}` : ''}${historyWarning ? ` · ${historyWarning}` : ''}`,
      );
      return result.text;
    } catch (error) {
      await finish(state.partial).catch(() => {});
      setNotice(
        `${String(error)}${state.partial ? '；已保留收到的部分回复。' : '；原消息已保留，可重试。'}`,
      );
    } finally {
      if (timer) clearTimeout(timer);
      generation.current = null;
      if (mounted.current) {
        setGenerating(false);
        setStreamText('');
      }
    }
  };
  const bridge = useCardRuntime({
    character,
    session: current,
    sessions,
    userName: persona.name,
    presetKey,
    persist: syncSessions,
    updateCharacter:
      onPatchCharacter ?? ((patch) => onUpdateCharacterSessions({ ...character, ...patch })),
    generate: async (id, messages) => {
      const text = await runGeneration(id, messages);
      if (text === undefined) throw new Error('模型生成未完成，请查看聊天提示或 AI 配置');
      return text;
    },
    setInput,
    notice: setNotice,
    buttons: setScriptButtons,
  });
  bridge.onInteraction = () => {
    autoScrollPausedUntil.current = Date.now() + 2000;
  };
  const pendingUiEvent = useRef<{ sessionId: string; name: string; index: number } | null>(null);
  useEffect(() => {
    const event = pendingUiEvent.current;
    if (!event || event.sessionId !== current.id) return;
    pendingUiEvent.current = null;
    if (trusted) void bridge.emit(event.name, [event.index]);
  }, [bridge, current.id, current.messages, trusted]);
  const previous = useRef({ session: current.id, count: current.messages.length });
  useEffect(() => {
    if (
      trusted &&
      previous.current.session === current.id &&
      current.messages.length > previous.current.count
    ) {
      const i = current.messages.length - 1;
      void bridge.emit(
        current.messages[i].role === 'assistant' ? 'message_received' : 'message_sent',
        [i],
      );
    }
    previous.current = { session: current.id, count: current.messages.length };
  }, [bridge, trusted, current.id, current.messages]);
  useEffect(() => {
    if (trusted) void bridge.emit(generating ? 'generation_started' : 'generation_ended', []);
  }, [bridge, trusted, generating]);
  const send = () => {
    if (!input.trim() || generation.current) return;
    autoScrollPausedUntil.current = 0;
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: now(),
      name: persona.name,
      avatar: persona.avatar,
      personaId: persona.id,
    };
    const history = [...current.messages, message];
    report(() => updateSession({ ...current, messages: history, updatedAt: now() }));
    setInput('');
    nearBottom.current = true;
    void runGeneration(current.id, history);
  };
  const createSession = (opening?: string, title?: string) => {
    if (generation.current) return;
    const s = makeSession(character, title ?? `新对话 #${sessions.length + 1}`, opening);
    report(() => syncSessions([s, ...sessionsRef.current], s.id));
    setSidebar(false);
    setGreetingOpen(false);
  };
  const fork = (index: number) => {
    if (generation.current) return;
    const s = forkSession(current, index);
    report(() => syncSessions([s, ...sessionsRef.current], s.id));
    setNotice(
      '已创建独立分支，原对话保持不变。旧记录若无该节点的变量快照，新分支不会继承后续变量。',
    );
  };
  const regenerate = (index: number) => {
    if (generation.current) return;
    let s = current;
    const target = s.messages[index];
    if (target.role !== 'assistant') return;
    if (index < s.messages.length - 1) s = forkSession(s, index);
    else s = structuredClone(s);
    // Capture the outgoing version before restoring the pre-reply runtime state.
    const versions = variantsOf(s.messages[index]);
    const selected = s.messages[index].selectedVariant ?? 0;
    versions[selected] = {
      ...versions[selected],
      runtimeVariables: structuredClone(s.runtimeVariables ?? {}),
    };
    s.messages[index] = { ...s.messages[index], variants: versions, selectedVariant: selected };
    s.runtimeVariables = structuredClone(
      index > 0 ? (s.runtimeCheckpoints?.[s.messages[index - 1].id] ?? {}) : {},
    );
    report(() =>
      s.id === current.id ? updateSession(s) : syncSessions([s, ...sessionsRef.current], s.id),
    );
    setEditing(null);
    nearBottom.current = true;
    void runGeneration(s.id, s.messages.slice(0, index), target.id);
  };
  const saveEdit = (regenerateAfter = false) => {
    if (!editing || generation.current) return;
    const index = current.messages.findIndex((m) => m.id === editing.id);
    if (index < 0 || !editing.text.trim()) return;
    const s =
      index < current.messages.length - 1 ? forkSession(current, index) : structuredClone(current);
    s.messages[index] = addVariant(s.messages[index], editing.text, 'edited', s.runtimeVariables);
    s.updatedAt = now();
    report(() =>
      s.id === current.id ? updateSession(s) : syncSessions([s, ...sessionsRef.current], s.id),
    );
    setEditing(null);
    setNotice(
      s.id === current.id
        ? '修改已保存，原文可通过版本切换找回。'
        : '历史修改已保存为新分支，原对话保持不变。',
    );
    pendingUiEvent.current = { sessionId: s.id, name: 'message_edited', index };
    if (regenerateAfter) {
      if (s.messages[index].role === 'assistant')
        void runGeneration(s.id, s.messages.slice(0, index), s.messages[index].id);
      else void runGeneration(s.id, s.messages);
    }
  };
  const selectVersion = (index: number, version: number) => {
    if (generation.current) return;
    const s =
      index < current.messages.length - 1 ? forkSession(current, index) : structuredClone(current);
    const outgoing = variantsOf(s.messages[index]);
    const old = s.messages[index].selectedVariant ?? 0;
    outgoing[old] = {
      ...outgoing[old],
      runtimeVariables: structuredClone(s.runtimeVariables ?? {}),
    };
    const msg = chooseVariant({ ...s.messages[index], variants: outgoing }, version);
    s.messages[index] = msg;
    const selected = msg.variants![version];
    s.runtimeVariables = structuredClone(
      selected.runtimeVariables ??
        (index > 0 ? (s.runtimeCheckpoints?.[s.messages[index - 1].id] ?? {}) : {}),
    );
    s.updatedAt = now();
    report(() =>
      s.id === current.id ? updateSession(s) : syncSessions([s, ...sessionsRef.current], s.id),
    );
    pendingUiEvent.current = { sessionId: s.id, name: 'message_swiped', index };
  };
  const copyMessage = async (m: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopied(m.id);
      setTimeout(() => setCopied(''), 1800);
    } catch (error) {
      setNotice(`复制失败：${String(error)}`);
    }
  };
  const exportSession = async (format: 'json' | 'md') => {
    const content =
      format === 'md'
        ? sessionMarkdown(current, character.name, persona.name)
        : JSON.stringify(
            {
              format: 'comfysilly-chat',
              version: 1,
              characterName: character.name,
              session: current,
            },
            null,
            2,
          );
    const fileName =
      `${character.name}-${current.title}`.replace(/[<>:"/\\|?*]/g, '_') + '.' + format;
    try {
      if (isTauri()) {
        const path = await invoke<string | null>('export_chat_file', { fileName, content });
        if (path) setNotice(`已导出：${path}`);
      } else {
        const blob = new Blob([content], {
          type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      setExportOpen(false);
    } catch (error) {
      setNotice(`导出失败：${String(error)}`);
    }
  };
  const isFrontend = useMemo(
    () =>
      helperScripts.length > 0 ||
      current.messages.some(
        (m, index) =>
          m.role === 'assistant' &&
          splitMessageParts(
            applyDisplayRules(m.content, rules, m.role, current.messages.length - index - 1).text,
          ).some((part) => part.kind === 'html'),
      ),
    [helperScripts, current.messages, rules],
  );
  return (
    <section className={`chat-room layout-${prefs.chatLayout} route-enter`}>
      <header className="chat-header">
        <div className="chat-heading">
          <button className="icon-button" aria-label="返回角色详情" onClick={onBackToShelf}>
            <ArrowLeft size={19} />
          </button>
          <Avatar src={character.avatar_b64} name={character.name} />
          <div>
            <h1>{character.name}</h1>
            <button
              className="session-title"
              onClick={() => setSidebar((v) => !v)}
              disabled={generating}
              aria-expanded={sidebar}
            >
              {current.title}
              <ChevronDown size={12} />
            </button>
          </div>
        </div>
        <div className="chat-header-actions">
          <label className="chat-preset-picker">
            <span>当前预设</span>
            <select
              aria-label="当前对话预设"
              value={presetKey}
              disabled={generating || switchingPreset || !onSelectPreset}
              onChange={async (e) => {
                const item = presets.find((p) => p.path === e.target.value);
                if (!item || !onSelectPreset) return;
                setSwitchingPreset(true);
                try {
                  const switched = await onSelectPreset(item.name, item.path);
                  if (switched === false) throw new Error('未能读取所选预设，当前预设保持不变');
                  setNotice(`已切换预设：${item.name}，下一次生成使用新预设。`);
                } catch (error) {
                  setNotice(`切换预设失败：${String(error)}`);
                } finally {
                  setSwitchingPreset(false);
                }
              }}
            >
              {!presets.some((p) => p.path === presetKey) && (
                <option value={presetKey}>{presetName}</option>
              )}
              {presets.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-quiet" onClick={onOpenLorebookModal}>
            <BookOpen size={15} />
            <span>角色世界书</span>
          </button>
          {greetings.length > 0 && (
            <button
              className="button button-quiet"
              disabled={generating}
              onClick={() => setGreetingOpen(true)}
            >
              开场剧情 ({greetings.length})
            </button>
          )}
          <button
            className={`icon-button ${sidebar ? 'is-active' : ''}`}
            disabled={generating}
            title="历史与分支"
            aria-label="历史与分支"
            onClick={() => setSidebar((v) => !v)}
          >
            <History size={18} />
          </button>
          <button className="button" disabled={generating} onClick={() => createSession()}>
            <Plus size={15} />
            新对话
          </button>
        </div>
      </header>
      {isFrontend && (
        <div className={`runtime-banner ${trusted ? 'is-trusted' : ''}`}>
          <ShieldCheck size={15} />
          <button
            disabled={trust.source !== trustPayload}
            onClick={() => {
              const enabled = !trusted;
              try {
                writeCardTrust(trust.key, enabled, character.id);
                setTrust({ ...trust, enabled });
              } catch (error) {
                setNotice(`信任记录保存失败，未改变权限：${String(error)}`);
              }
            }}
          >
            {trusted ? '已启用交互 · 点击停用' : '信任此卡并启用交互前端'}
          </button>
          <span>
            {trusted
              ? `${helperScripts.length} 个后台脚本 · 已记住此卡信任 · 不支持的接口与加载错误会直接报告`
              : '信任后会记住此卡；脚本或开场更新需重新确认。代码可读取对话、联网及请求模型，无法访问密钥和桌面文件。'}
          </span>
        </div>
      )}
      {trusted && scriptButtons.length > 0 && (
        <div className="script-actions">
          {scriptButtons
            .filter((b) => b.visible !== false)
            .map((b) => (
              <button
                key={b.name}
                className="button"
                onClick={() => void bridge.emit(`button:${b.name}`, [])}
              >
                {b.name}
              </button>
            ))}
        </div>
      )}
      {trusted && helperScripts.length > 0 && (
        <InteractiveFrame
          html=""
          bridge={bridge}
          messageId={0}
          background
          scripts={helperScripts}
        />
      )}
      <div className="chat-workspace">
        <aside
          className={`session-sidebar ${sidebar ? 'is-open' : ''}`}
          aria-hidden={!sidebar}
          inert={!sidebar}
        >
          <div className="session-sidebar-inner">
            <div className="session-sidebar-heading">
              <div>
                <span className="eyebrow">YOUR TIMELINES</span>
                <h2>历史与分支</h2>
              </div>
              <button
                className="icon-button"
                aria-label="收起历史"
                onClick={() => setSidebar(false)}
              >
                <PanelLeftClose size={17} />
              </button>
            </div>
            <label className="search-field">
              <Search size={14} />
              <input
                aria-label="搜索对话"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder="搜索对话…"
              />
            </label>
            <div className="session-list">
              {sessions
                .filter((s) => s.title.toLowerCase().includes(sessionSearch.toLowerCase()))
                .map((s) => (
                  <div
                    key={s.id}
                    className={`session-item ${s.id === current.id ? 'is-active' : ''}`}
                  >
                    <button
                      className="session-select"
                      disabled={generating}
                      onClick={() => {
                        report(() => syncSessions(sessionsRef.current, s.id));
                      }}
                    >
                      <span>
                        {s.parentSessionId ? <GitBranch size={14} /> : <MessageIcon />}
                        {s.title}
                      </span>
                      <small>
                        {s.messages.length} 条消息 · {s.parentSessionId ? '独立分支' : '主线'}
                      </small>
                    </button>
                    <div className="session-item-actions">
                      <button
                        className="icon-button"
                        title="重命名对话"
                        disabled={generating}
                        onClick={() => setRenaming({ id: s.id, title: s.title })}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        className="icon-button danger"
                        title="删除此对话分支"
                        disabled={generating || sessions.length < 2}
                        onClick={() => setDeleting(s)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
            <p className="session-help">
              每条消息都能作为分支起点。历史编辑与重生成不会覆盖原来的故事。
            </p>
          </div>
        </aside>
        <div className="chat-main">
          <div
            className="chat-scroll"
            ref={viewport}
            onScroll={() => {
              const el = viewport.current!;
              nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              setBelow(!nearBottom.current);
            }}
          >
            <div className="chat-reader">
              <div className="conversation-beginning">
                <span>故事的这一页</span>
                <small>
                  {current.parentSessionId ? '从另一种可能继续' : '写下你的下一句，让故事继续'}
                </small>
              </div>
              {current.messages.length > visibleCount && (
                <div className="load-earlier">
                  <button
                    onClick={() => {
                      const el = viewport.current;
                      if (el) olderAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
                      setVisibleCount((n) => n + 40);
                    }}
                  >
                    加载更早的消息 · 还有 {current.messages.length - visibleCount} 条
                  </button>
                </div>
              )}
              {current.messages.slice(-visibleCount).map((m, visibleIndex) => {
                const index = Math.max(0, current.messages.length - visibleCount) + visibleIndex;
                const user = m.role === 'user',
                  variants = m.variants?.length ? m.variants : [m],
                  selected = m.selectedVariant ?? 0;
                const name = m.name || (user ? persona.name : character.name);
                return (
                  <article
                    key={m.id}
                    data-message-id={m.id}
                    className={`chat-message ${user ? 'from-user' : 'from-assistant'} ${editing?.id === m.id ? 'is-editing' : ''}`}
                  >
                    <Avatar src={user ? m.avatar : character.avatar_b64} name={name} />
                    <div className="message-main">
                      <div className="message-heading">
                        <span>{name}</span>
                        {m.role === 'system' && <span className="badge">系统</span>}
                        {prefs.showTimestamps && (
                          <time dateTime={m.timestamp}>
                            {Number.isNaN(Date.parse(m.timestamp))
                              ? m.timestamp
                              : new Date(m.timestamp).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                          </time>
                        )}
                        <span className="message-number">{String(index + 1).padStart(2, '0')}</span>
                      </div>
                      {editing?.id === m.id ? (
                        <div className="message-editor">
                          <textarea
                            aria-label="编辑消息内容"
                            value={editing.text}
                            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                            rows={Math.min(18, Math.max(5, editing.text.split('\n').length))}
                          />
                          <p>
                            {index < current.messages.length - 1
                              ? '这是一条历史消息：保存会创建新分支，原对话不会改变。'
                              : '原文将保留为另一版本，可以随时切换回来。'}
                          </p>
                          <div>
                            <button
                              className="button button-quiet"
                              onClick={() => setEditing(null)}
                            >
                              取消
                            </button>
                            <button
                              className="button"
                              disabled={!editing.text.trim()}
                              onClick={() => saveEdit()}
                            >
                              保存修改
                            </button>
                            <button
                              className="button button-primary"
                              disabled={!editing.text.trim() || !provider?.model}
                              onClick={() => saveEdit(true)}
                            >
                              保存并重新生成
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="message-body">
                          <MessageContent
                            content={m.content}
                            role={m.role}
                            rules={rules}
                            bridge={trusted ? bridge : undefined}
                            messageId={index}
                            depth={current.messages.length - index - 1}
                          />
                        </div>
                      )}
                      <div className="message-footer">
                        {variants.length > 1 && (
                          <div className="variant-switcher">
                            <button
                              className="icon-button"
                              aria-label={`消息 ${index + 1} 上一版本`}
                              disabled={generating || selected === 0}
                              onClick={() => selectVersion(index, selected - 1)}
                            >
                              <ChevronLeft size={14} />
                            </button>
                            <span>
                              {selected + 1} / {variants.length}
                            </span>
                            <button
                              className="icon-button"
                              aria-label={`消息 ${index + 1} 下一版本`}
                              disabled={generating || selected === variants.length - 1}
                              onClick={() => selectVersion(index, selected + 1)}
                            >
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        )}
                        <div className="message-actions">
                          <button
                            className="icon-button"
                            title="复制原文"
                            aria-label={`复制消息 ${index + 1}`}
                            onClick={() => void copyMessage(m)}
                          >
                            {copied === m.id ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                          <button
                            className="icon-button"
                            title="编辑消息"
                            aria-label={`编辑消息 ${index + 1}`}
                            disabled={generating}
                            onClick={() => setEditing({ id: m.id, text: m.content })}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-button"
                            title="从这里创建分支"
                            aria-label={`从消息 ${index + 1} 创建分支`}
                            disabled={generating}
                            onClick={() => fork(index)}
                          >
                            <GitBranch size={14} />
                          </button>
                          {m.role === 'assistant' && (
                            <button
                              className="icon-button"
                              title={
                                index < current.messages.length - 1
                                  ? '在新分支重新生成'
                                  : '重新生成 · 保留当前版本'
                              }
                              aria-label={`重新生成消息 ${index + 1}`}
                              disabled={generating}
                              onClick={() => regenerate(index)}
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
              {generating && (
                <article className="chat-message from-assistant is-streaming" aria-live="polite">
                  <Avatar src={character.avatar_b64} name={character.name} />
                  <div className="message-main">
                    <div className="message-heading">
                      <span>{character.name}</span>
                      <small>正在续写</small>
                    </div>
                    <div className="stream-body">
                      {streamText || (
                        <span className="typing-dots">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              )}
              <div className="reader-end" />
            </div>
          </div>
          {below && (
            <button className="back-to-bottom" onClick={() => scrollDown()}>
              <ArrowDown size={15} />
              回到底部
            </button>
          )}
          <div className="chat-compose">
            <div className="compose-inner">
              <div className="chat-status" role="status">
                <span className={`status-dot ${saveError ? 'is-error' : ''}`} />
                <span>
                  {notice ||
                    (provider
                      ? `当前模型：${provider.model} · ${provider.name}`
                      : '尚未配置模型，请打开 AI 设置。')}
                </span>
                <small>{saving ? '保存中…' : saveError ? '未保存' : '已保存'}</small>
              </div>
              <div className="compose-box">
                <textarea
                  aria-label="对话输入"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      !e.nativeEvent.isComposing &&
                      e.keyCode !== 229 &&
                      ((prefs.sendKey === 'enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) ||
                        (prefs.sendKey === 'ctrl-enter' && (e.ctrlKey || e.metaKey)))
                    ) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={2}
                  placeholder={`回复 ${character.name}…`}
                />
                {generating ? (
                  <button
                    className="send-button is-stop"
                    aria-label="停止生成"
                    onClick={() => {
                      if (generation.current)
                        void cancelGeneration(generation.current.id).catch((e) =>
                          setNotice(String(e)),
                        );
                    }}
                  >
                    <Square size={17} />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    disabled={!input.trim()}
                    aria-label="发送消息"
                    onClick={send}
                  >
                    <Send size={18} />
                  </button>
                )}
              </div>
              <div className="compose-tools">
                <button onClick={onOpenSettings}>AI 设置</button>
                <button
                  className={budget.warnings.length ? 'retry-button' : ''}
                  onClick={() => {
                    setBudgetDraft({
                      contextWindow: budget.contextWindow,
                      maxOutputTokens: budget.maxOutputTokens,
                    });
                    setBudgetOpen(true);
                  }}
                >
                  生成参数{budget.warnings.length ? ' · 已修正冲突' : ''}
                </button>
                <button
                  onClick={() => {
                    try {
                      setLastPrompt(compile(current.messages));
                      setShowPrompt(true);
                    } catch (e) {
                      setNotice(String(e));
                    }
                  }}
                >
                  <FileText size={12} />
                  查看实际提示词
                </button>
                {!generating && current.messages.at(-1)?.role === 'user' && (
                  <button
                    className="retry-button"
                    onClick={() => void runGeneration(current.id, current.messages)}
                  >
                    <RotateCcw size={12} />
                    重试生成
                  </button>
                )}
                {saveError && (
                  <button onClick={() => report(() => syncSessions(sessionsRef.current))}>
                    重试保存
                  </button>
                )}
                <span className="compose-spacer" />
                <button onClick={() => setExportOpen(true)}>
                  <Download size={12} />
                  导出
                </button>
                <small>
                  {prefs.sendKey === 'enter'
                    ? 'Enter 发送 · Shift + Enter 换行'
                    : 'Ctrl / ⌘ + Enter 发送'}
                </small>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Dialog
        open={budgetOpen}
        onClose={() => setBudgetOpen(false)}
        title="当前预设的生成参数"
        className="budget-dialog"
      >
        <p>
          预设：{presetName}
          。这里的覆盖会保存到本机，不改写导入的原始预设。上下文请按模型实际能力填写，不会自动识别模型上限。
        </p>
        {budget.warnings.map((w) => (
          <p key={w} role="status">
            {w}
          </p>
        ))}
        <label>
          上下文窗口（输入＋回复 tokens）
          <input
            aria-label="上下文窗口"
            type="number"
            min={1024}
            max={2000000}
            value={budgetDraft.contextWindow}
            onChange={(e) =>
              setBudgetDraft({ ...budgetDraft, contextWindow: Number(e.target.value) })
            }
          />
        </label>
        <label>
          最大回复 tokens
          <input
            aria-label="最大回复 tokens"
            type="number"
            min={1}
            max={131072}
            value={budgetDraft.maxOutputTokens}
            onChange={(e) =>
              setBudgetDraft({ ...budgetDraft, maxOutputTokens: Number(e.target.value) })
            }
          />
        </label>
        <p>
          输入预算：{Math.max(0, budgetDraft.contextWindow - budgetDraft.maxOutputTokens)}{' '}
          tokens。按字符估算；超预算时仅在本次请求中省略较早历史，并在提示词预览中说明。完整记录、预设提示词和最新一轮对话会保留。
        </p>
        <div className="dialog-actions">
          <button
            className="button"
            onClick={() => {
              try {
                const next = { ...budgetOverrides };
                delete next[presetKey];
                localStorage.setItem('comfysilly:generation-budgets', JSON.stringify(next));
                setBudgetOverrides(next);
                setBudgetOpen(false);
              } catch (error) {
                setNotice(String(error));
              }
            }}
          >
            恢复预设值
          </button>
          <button
            className="button button-primary"
            disabled={
              generating ||
              !Number.isInteger(budgetDraft.contextWindow) ||
              budgetDraft.contextWindow < 1024 ||
              budgetDraft.contextWindow > 2000000 ||
              !Number.isInteger(budgetDraft.maxOutputTokens) ||
              budgetDraft.maxOutputTokens < 1 ||
              budgetDraft.maxOutputTokens > 131072 ||
              budgetDraft.maxOutputTokens >= budgetDraft.contextWindow
            }
            onClick={() => {
              try {
                const next = { ...budgetOverrides, [presetKey]: budgetDraft };
                localStorage.setItem('comfysilly:generation-budgets', JSON.stringify(next));
                setBudgetOverrides(next);
                setBudgetOpen(false);
                setNotice('生成参数已保存，下一次请求生效。');
              } catch (error) {
                setNotice(String(error));
              }
            }}
          >
            保存生成参数
          </button>
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        title="删除这段对话？"
        description={`「${deleting?.title ?? ''}」会被永久删除。其他独立分支不会受影响。`}
        danger
        confirmText="删除对话"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const next = sessionsRef.current.filter((s) => s.id !== deleting.id);
          await syncSessions(next, deleting.id === activeId ? next[0].id : activeId);
        }}
      />
      <Dialog
        open={!!renaming}
        title="重命名对话"
        onClose={() => setRenaming(null)}
        className="confirm-dialog"
      >
        <label className="field">
          对话名称
          <input
            autoFocus
            className="text-input"
            value={renaming?.title ?? ''}
            maxLength={100}
            onChange={(e) => renaming && setRenaming({ ...renaming, title: e.target.value })}
          />
        </label>
        <footer className="dialog-footer">
          <button className="button" onClick={() => setRenaming(null)}>
            取消
          </button>
          <button
            className="button button-primary"
            disabled={!renaming?.title.trim()}
            onClick={() => {
              if (!renaming) return;
              report(async () => {
                await syncSessions(
                  sessionsRef.current.map((s) =>
                    s.id === renaming.id ? { ...s, title: renaming.title.trim() } : s,
                  ),
                );
                setRenaming(null);
              });
            }}
          >
            保存名称
          </button>
        </footer>
      </Dialog>
      <Dialog
        open={greetingOpen}
        title="选择开场剧情"
        description="选择后会创建独立新对话，已有故事会保留。"
        onClose={() => setGreetingOpen(false)}
      >
        <div className="greeting-list">
          {greetings.map((g, i) => (
            <button key={i} onClick={() => createSession(g, `开场剧情 ${i + 1}`)}>
              <span>开场 {i + 1}</span>
              <p>{g.replace(/<[^>]*>/g, '').slice(0, 260)}</p>
            </button>
          ))}
        </div>
      </Dialog>
      <Dialog
        open={exportOpen}
        title="导出当前对话"
        description="仅导出当前分支，不包含模型密钥。内容可能含个人信息和卡片变量，请妥善保存。"
        onClose={() => setExportOpen(false)}
        className="confirm-dialog"
      >
        <div className="export-options">
          <button className="button" onClick={() => void exportSession('md')}>
            <FileText size={18} />
            Markdown · 阅读与存档
          </button>
          <button className="button" onClick={() => void exportSession('json')}>
            <Download size={18} />
            JSON · 消息与运行时状态
          </button>
        </div>
      </Dialog>
      <Dialog
        open={showPrompt}
        title="实际提示词"
        description="这里只展示准备发送的内容，不包含连接密钥。token 数为字符估算，非计费用量。"
        onClose={() => setShowPrompt(false)}
        className="prompt-dialog"
      >
        <div className="prompt-content">
          <p>约 {lastPrompt?.estimatedTokens ?? 0} tokens</p>
          {lastPrompt?.warnings.map((w) => (
            <p className="inline-note" key={w}>
              {w}
            </p>
          ))}
          {lastPrompt?.messages.map((m, i) => (
            <section key={i}>
              <span className="badge">
                {i + 1} · {m.role}
              </span>
              <pre>{m.content}</pre>
            </section>
          ))}
        </div>
      </Dialog>
    </section>
  );
}
function MessageIcon() {
  return <PanelLeft size={14} />;
}
