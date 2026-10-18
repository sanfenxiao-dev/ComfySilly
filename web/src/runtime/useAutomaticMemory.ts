import { useEffect, useRef, useState } from 'react';
import type { ChatSession } from '../components/CharacterShelf';
import type { AppSettings } from '../types/settings';
import { memoryOf } from '../types/settings';
import { cancelGeneration, generateChat } from '../utils/generation';
import {
  emptyMemoryContent,
  memoryExtractionMessages,
  nextMemoryBatch,
  parseMemoryResponse,
  prefixDigest,
  usableMemory,
} from '../utils/memory';

export interface MemoryStatus {
  sessionId: string;
  phase: 'idle' | 'queued' | 'running' | 'error';
  detail: string;
}
interface Options {
  characterId: string;
  session: ChatSession;
  settings?: AppSettings;
  generating: boolean;
  readSession: (id: string) => ChatSession | undefined;
  saveSession: (session: ChatSession) => Promise<unknown>;
}
/** One cancellable background request. Never blocks foreground generation. */
export function useAutomaticMemory(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [status, setStatus] = useState<MemoryStatus>({
    sessionId: options.session.id,
    phase: 'idle',
    detail: '',
  });
  const [retry, setRetry] = useState(0);
  const [wake, setWake] = useState(0);
  const failed = useRef<{ key: string; attempts: number }>({ key: '', attempts: 0 });
  const active = useRef<(() => void) | null>(null);
  const forcedSession = useRef<string | null>(null);
  const prefs = memoryOf(options.settings);
  const providerId = prefs.providerId || options.settings?.activeProviderId || '';
  const provider = options.settings?.providers.find((p) => p.id === providerId);
  const configKey = JSON.stringify([prefs, provider]);
  useEffect(() => {
    const o = latest.current,
      session = o.session;
    let cancelled = false;
    let requestId: string | undefined;
    const cancel = () => {
      cancelled = true;
      if (requestId) void cancelGeneration(requestId).catch(() => {});
    };
    active.current = cancel;
    const show = (phase: MemoryStatus['phase'], detail: string) => {
      if (!cancelled) setStatus({ sessionId: session.id, phase, detail });
    };
    const config = memoryOf(o.settings);
    const memoryProvider = o.settings?.providers.find(
      (p) => p.id === (config.providerId || o.settings?.activeProviderId),
    );
    if (!config.enabled || session.memoryPaused || o.generating || !memoryProvider?.model) {
      show(
        'idle',
        !config.enabled
          ? '未启用'
          : session.memoryPaused
            ? '此对话已暂停'
            : o.generating
              ? '优先生成回复'
              : '请在设置中选择记忆模型',
      );
      return cancel;
    }
    // Only complete turns are candidates. A cancelled/partial assistant reply
    // is explicitly marked and not treated as a completed turn.
    const last = session.messages.findLastIndex((m) => m.role === 'assistant' && !m.incomplete);
    const messages = session.messages.slice(0, last + 1);
    const old = usableMemory(session.memory, o.characterId, session.id, messages);
    const cursor = old?.cursor ?? { completed: 0, offset: 0 };
    const unseenTurns = messages
      .slice(cursor.completed)
      .filter((m) => m.role === 'assistant').length;
    const behind = messages.length - cursor.completed > config.recentMessages;
    if (
      !messages.length ||
      (!behind &&
        unseenTurns < config.triggerEveryTurns &&
        !cursor.offset &&
        forcedSession.current !== session.id)
    ) {
      show(
        'idle',
        unseenTurns
          ? `等待下一次整理 · 尚有 ${unseenTurns} 轮`
          : old
            ? '记忆已更新'
            : '等待完整对话',
      );
      return cancel;
    }
    const batch = nextMemoryBatch(messages, cursor, config.batchChars);
    if (!batch) {
      forcedSession.current = null;
      show('idle', '记忆已更新');
      return cancel;
    }
    const expectedRevision = session.memory?.revision;
    const expectedDigest = prefixDigest(messages, batch.to);
    const key = JSON.stringify([session.id, expectedRevision, expectedDigest, configKey, retry]);
    if (failed.current.key !== key) failed.current = { key, attempts: 0 };
    if (failed.current.attempts >= 3) {
      show('error', '自动整理已暂停重试；原记录和旧记忆保留，请点击重试或检查模型配置');
      return cancel;
    }
    show('queued', `待整理 ${messages.length - cursor.completed} 条消息`);
    const timer = setTimeout(
      async () => {
        if (cancelled) return;
        show('running', `后台整理中 · 已覆盖 ${cursor.completed}/${session.messages.length} 条`);
        requestId = `memory-${crypto.randomUUID()}`;
        try {
          const previous = old ?? emptyMemoryContent();
          const response = await generateChat(
            {
              requestId,
              providerId: memoryProvider.id,
              purpose: 'memory',
              messages: memoryExtractionMessages(previous, batch),
              maxTokens: config.maxOutputTokens,
              temperature: 0.1,
            },
            () => {},
          );
          if (cancelled) return;
          const allowedIds = new Set([
            ...batch.messages.map((m) => m.id),
            ...previous.facts.flatMap((f) => f.sourceMessageIds),
            ...previous.events.flatMap((f) => f.sourceMessageIds),
            ...previous.openThreads.flatMap((f) => f.sourceMessageIds),
          ]);
          const content = parseMemoryResponse(response.text, allowedIds);
          const current = latest.current.readSession(session.id);
          // Ignore stale results after a reset, deletion, edit, variant switch,
          // navigation, settings change, or another memory revision.
          if (
            !current ||
            cancelled ||
            current.memoryPaused ||
            current.memory?.revision !== expectedRevision ||
            prefixDigest(current.messages, batch.to) !== expectedDigest
          )
            return;
          const owned =
            current.memory?.characterId === o.characterId &&
            current.memory?.sessionId === session.id;
          const checkpoints = (owned ? (current.memory?.checkpoints ?? []) : []).filter(
            (c) =>
              c?.cursor &&
              c.prefixDigest === prefixDigest(current.messages, c.cursor) &&
              (c.cursor.completed < batch.to.completed ||
                (c.cursor.completed === batch.to.completed && c.cursor.offset < batch.to.offset)),
          );
          const memory = {
            version: 1 as const,
            characterId: o.characterId,
            sessionId: session.id,
            revision: crypto.randomUUID(),
            checkpoints: [
              ...checkpoints.slice(-7),
              {
                ...content,
                cursor: batch.to,
                prefixDigest: expectedDigest,
                updatedAt: new Date().toISOString(),
              },
            ],
          };
          // Do not switch the active chat, change timestamps, touch plugin vars,
          // or copy the session captured before the network request.
          await latest.current.saveSession({ ...current, memory });
          forcedSession.current = null;
          failed.current = { key: '', attempts: 0 };
          show('idle', '记忆已更新');
        } catch (error) {
          if (!cancelled) {
            failed.current.attempts++;
            show(
              'error',
              `整理失败，原记录保留：${String(error).slice(0, 400)}（最多自动重试两次）`,
            );
            // Schedule bounded retries without a hot error/request loop.
            retryTimer = setTimeout(() => {
              if (!cancelled) setWake((v) => v + 1);
            }, 30000);
          }
        }
      },
      failed.current.attempts ? 1000 : 800,
    );
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    return () => {
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      cancel();
    };
  }, [
    options.characterId,
    options.session.id,
    options.session.messages,
    options.session.memory,
    options.session.memoryPaused,
    options.generating,
    configKey,
    retry,
    wake,
  ]);
  return {
    status:
      status.sessionId === options.session.id
        ? status
        : { sessionId: options.session.id, phase: 'idle' as const, detail: '' },
    retry: () => {
      forcedSession.current = options.session.id;
      setRetry((v) => v + 1);
    },
    cancel: () => active.current?.(),
  };
}
