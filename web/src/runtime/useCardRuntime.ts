import { useEffect, useMemo, useRef } from 'react';
import { CardBridge } from './cardBridge';
import type { RuntimeSnapshot } from './cardBridge';
import type { CharacterCardData, ChatSession } from '../components/CharacterShelf';
import { toHelperEntry, fromHelperEntry } from './worldbookAdapter';

type Obj = Record<string, any>;
interface Options {
  character: CharacterCardData;
  session: ChatSession;
  sessions: ChatSession[];
  userName?: string;
  presetKey?: string;
  persist: (sessions: ChatSession[], id?: string) => unknown;
  updateCharacter: (character: Partial<CharacterCardData>) => unknown;
  generate: (sessionId: string, messages: ChatSession['messages']) => Promise<string | undefined>;
  setInput: (text: string) => void;
  notice: (text: string) => void;
  buttons: (buttons: Array<{ name: string; visible?: boolean }>) => void;
}
function stored(key: string): Obj {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}
function initialMessageVariables(content: string): Obj {
  const m = content.match(/<VariableInsert>([\s\S]*?)<\/VariableInsert>/i);
  if (!m) return {};
  try {
    return JSON.parse(m[1]);
  } catch {
    return {};
  }
}
const entries = (v: unknown): Obj[] =>
  Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
function snapshot(o: Options): RuntimeSnapshot {
  const variables: Record<string, Obj> = {
    global: stored('comfysilly:global-vars'),
    preset: stored(`comfysilly:preset-vars:${o.presetKey ?? 'default'}`),
    character: o.character.extensions?.comfysilly_variables ?? {},
    chat: {},
    ...(o.session.runtimeVariables ?? {}),
  };
  o.session.messages.forEach((m, i) => {
    if (!variables[`message:${i}`]) variables[`message:${i}`] = initialMessageVariables(m.content);
  });
  return {
    userName: o.userName || '用户',
    character: {
      id: o.character.id,
      name: o.character.name,
      description: o.character.description,
      // Worldbook entries stay in the trusted host and are fetched through
      // getWorldbook. Sending the complete card lorebook into every sandboxed
      // iframe was the largest source of startup stalls and RPC starvation.
      lorebook: o.character.lorebook ? { name: o.character.lorebook.name } : undefined,
    },
    variables,
    regexes: o.character.extensions?.regex_scripts ?? [],
    messages: o.session.messages.map((m, i) => ({
      message_id: i,
      name: m.name || (m.role === 'user' ? o.userName || '用户' : o.character.name),
      role: m.role,
      message: m.content,
      data: variables[`message:${i}`] ?? {},
      extra: {},
      is_hidden: false,
    })),
  };
}
/** Every operation is scoped to the open character/session. No arbitrary IPC or filesystem RPC. */
export function useCardRuntime(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const lastCharacter = useRef(options.character);
  const bridge = useMemo(
    () => new CardBridge(snapshot(options)),
    [options.character.id, options.session.id],
  );
  // New documents must read current render inputs, before passive snapshot broadcasts run.
  bridge.getSnapshot = () => snapshot(latest.current);
  useEffect(() => {
    bridge.start();
    return () => bridge.destroy();
  }, [bridge]);
  useEffect(() => {
    const next = snapshot(options);
    const previousCharacter = lastCharacter.current;
    const characterChangedOnlyVariables =
      previousCharacter !== options.character &&
      previousCharacter.id === options.character.id &&
      previousCharacter.name === options.character.name &&
      previousCharacter.description === options.character.description &&
      previousCharacter.personality === options.character.personality &&
      previousCharacter.scenario === options.character.scenario &&
      previousCharacter.first_mes === options.character.first_mes &&
      previousCharacter.lorebook === options.character.lorebook &&
      Object.keys(previousCharacter.extensions ?? {})
        .filter((key) => key !== 'comfysilly_variables')
        .every(
          (key) =>
            (previousCharacter.extensions ?? {})[key] ===
            (options.character.extensions ?? {})[key],
        ) &&
      Object.keys(options.character.extensions ?? {})
        .filter((key) => key !== 'comfysilly_variables')
        .every(
          (key) =>
            (previousCharacter.extensions ?? {})[key] ===
            (options.character.extensions ?? {})[key],
        );

    // Variable writes are frequent in author UI cards. Do not rebroadcast the
    // whole snapshot (which may contain a multi-megabyte lorebook) to every
    // iframe just because the persisted card object got a new wrapper.
    if (
      characterChangedOnlyVariables &&
      previousCharacter.extensions?.comfysilly_variables !==
        options.character.extensions?.comfysilly_variables
    ) {
      bridge.updateVariable('character', structuredClone(next.variables.character));
    } else {
      bridge.update(next);
    }
    lastCharacter.current = options.character;
  }, [bridge, options.character, options.session, options.presetKey, options.userName]);
  bridge.onNotice = (text) => latest.current.notice(text);
  bridge.onCall = async (method, args) => {
    const o = latest.current;
    const persistMessages = async (messages: ChatSession['messages']) => {
      const next = o.sessions.map((s) => (s.id === o.session.id ? { ...s, messages } : s));
      latest.current = { ...o, sessions: next, session: { ...o.session, messages } };
      const nextSnapshot = snapshot(latest.current);
      // Message edits are common in helper scripts. Send only the changed
      // message list and variable tables; cloning the character lorebook into
      // every iframe here made large cards visibly stutter and could starve
      // the RPC response queue.
      bridge.updateMessages(nextSnapshot.messages, nextSnapshot.variables);
      // Resolve helper RPCs immediately; the app's serialized writer handles
      // the disk write in the background.
      void Promise.resolve(o.persist(next, o.session.id)).catch((error: unknown) =>
        latest.current.notice(`消息已更新到当前会话，但保存失败：${String(error)}`),
      );
    };
    const updateCharacter = async (patch: Partial<CharacterCardData>) => {
      latest.current = { ...latest.current, character: { ...latest.current.character, ...patch } };
      await o.updateCharacter(patch);
    };
    switch (method) {
      case 'flush':
        await o.persist(o.sessions, o.session.id);
        return true;
      case 'replaceVariables': {
        const [key, value] = args;
        if (
          typeof key !== 'string' ||
          !/^(global|preset|character|chat|message:\d+|script:.{1,150}|extension:.{1,150})$/.test(
            key,
          ) ||
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value)
        )
          throw new Error('变量作用域或内容无效');
        if (JSON.stringify(value).length > 4 * 1024 * 1024)
          throw new Error('单个变量表超过 4 MiB 限制');
        bridge.updateVariable(key, structuredClone(value));
        if (key === 'global' || key === 'preset') {
          localStorage.setItem(
            key === 'global'
              ? 'comfysilly:global-vars'
              : `comfysilly:preset-vars:${o.presetKey ?? 'default'}`,
            JSON.stringify(value),
          );
        } else if (key === 'character') {
          // Character cards can be several megabytes and third-party buttons often
          // call this from a synchronous UI handler. Persist in the background so
          // the iframe RPC does not hit its 10s timeout while the card file is being
          // atomically rewritten. The in-memory snapshot is already updated above.
          void updateCharacter({
            extensions: { ...o.character.extensions, comfysilly_variables: value },
          }).catch((error) => latest.current.notice(`角色变量已更新到当前会话，但保存卡片失败：${String(error)}`));
        } else {
          const current = latest.current;
          const vars = { ...current.session.runtimeVariables, [key]: value };
          const session = { ...current.session, runtimeVariables: vars };
          const sessions = current.sessions.map((s) => (s.id === session.id ? session : s));
          latest.current = { ...current, session, sessions };
          void Promise.resolve(o.persist(sessions, session.id)).catch((error: unknown) =>
            latest.current.notice(`变量已更新到当前会话，但保存失败：${String(error)}`),
          );
        }
        return true;
      }
      case 'setChatMessages': {
        const changes = args[0] as Obj[];
        if (!Array.isArray(changes) || changes.length > 500) throw new Error('消息更新列表无效');
        const map = new Map(changes.map((v) => [v.message_id, v]));
        await persistMessages(
          o.session.messages.map((m, i) => {
            const patch = map.get(i);
            if (!patch) return m;
            return {
              ...m,
              ...(typeof patch.message === 'string' ? { content: patch.message } : {}),
              ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
            };
          }),
        );
        for (const change of changes) void bridge.emit('message_updated', [change.message_id]);
        return true;
      }
      case 'createChatMessages': {
        const input = args[0] as Obj[];
        if (!Array.isArray(input) || input.length > 100) throw new Error('消息创建列表无效');
        const messages = input.map((m) => {
          if (
            !['user', 'assistant', 'system'].includes(m.role) ||
            typeof (m.message ?? m.content) !== 'string'
          )
            throw new Error('消息格式无效');
          return {
            id: crypto.randomUUID(),
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.message ?? m.content,
            timestamp: new Date().toLocaleTimeString(),
          };
        });
        await persistMessages([...o.session.messages, ...messages]);
        return messages.map((_, i) => o.session.messages.length + i);
      }
      case 'deleteChatMessages': {
        const ids = args[0];
        if (!Array.isArray(ids) || ids.some((v) => !Number.isInteger(v)))
          throw new Error('消息 ID 无效');
        if (ids.length >= o.session.messages.length) throw new Error('不能通过脚本删除整个会话');
        await persistMessages(o.session.messages.filter((_, i) => !ids.includes(i)));
        return true;
      }
      case 'getWorldbook':
      case 'replaceWorldbook':
      case 'createWorldbook':
      case 'createWorldbookEntries': {
        const name = String(args[0]);
        if (name.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(name))
          throw new Error('世界书名称无效');
        const primary = o.character.lorebook;
        const extra = { ...(o.character.extensions?.comfysilly_worldbooks ?? {}) };
        const existing = primary?.name === name ? entries(primary.entries) : extra[name];
        if (method === 'getWorldbook') {
          if (!existing) throw new Error(`世界书不存在：${name}`);
          return existing.map(toHelperEntry);
        }
        if (method === 'createWorldbook' && existing) return false;
        if (method !== 'createWorldbook' && !existing) throw new Error(`世界书不存在：${name}`);
        if (!Array.isArray(args[1]) || args[1].length > 10000) throw new Error('世界书条目无效');
        const used = new Set(
          (existing ?? []).map((e: Obj, i: number) => Number(e.uid ?? e.id ?? i)),
        );
        let nextUid = Math.max(-1, ...Array.from(used).map(Number)) + 1;
        const added = args[1].map((e: Obj, i: number) => {
          const old =
            method === 'createWorldbookEntries'
              ? undefined
              : existing?.find((raw: Obj, n: number) => Number(raw.uid ?? raw.id ?? n) === e.uid);
          const uid =
            e.uid == null || (method === 'createWorldbookEntries' && used.has(e.uid))
              ? nextUid++
              : e.uid;
          used.add(uid);
          return fromHelperEntry({ ...e, uid }, old, i);
        });
        const next = method === 'createWorldbookEntries' ? [...existing, ...added] : added;
        if (primary?.name === name)
          await updateCharacter({ lorebook: { ...primary, entries: next } });
        else {
          extra[name] = next;
          await updateCharacter({
            extensions: { ...o.character.extensions, comfysilly_worldbooks: extra },
          });
        }
        return method === 'createWorldbookEntries'
          ? { worldbook: next.map(toHelperEntry), new_entries: added.map(toHelperEntry) }
          : true;
      }
      case 'replaceRegexes': {
        const rules = args[0];
        if (!Array.isArray(rules) || rules.length > 1000) throw new Error('正则列表无效');
        await updateCharacter({ extensions: { ...o.character.extensions, regex_scripts: rules } });
        return true;
      }
      case 'scriptButtons': {
        if (!Array.isArray(args[0]) || args[0].length > 100) throw new Error('按钮列表无效');
        o.buttons(args[0].filter((b: Obj) => typeof b.name === 'string'));
        return true;
      }
      case 'generate': {
        const input = args[0]?.user_input;
        if (typeof input === 'string' && input.trim()) {
          const message = {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content: input,
            timestamp: new Date().toLocaleTimeString(),
          };
          const messages = [...o.session.messages, message];
          await persistMessages(messages);
          return await o.generate(o.session.id, messages);
        }
        return await o.generate(o.session.id, o.session.messages);
      }
      case 'triggerSlash':
        return await slash(String(args[0]), bridge, latest);
      default:
        throw new Error(`尚未支持酒馆接口：${method}`);
    }
  };
  return bridge;
}
function splitPipeline(command: string) {
  const result: string[] = [];
  let quote = '';
  let escaped = false;
  let current = '';
  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '|') {
      result.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}
async function slash(command: string, bridge: CardBridge, latest: React.RefObject<Options>) {
  let result = '';
  for (const stage of splitPipeline(command)) {
    const m = /^\/(\w+)\s*([\s\S]*)$/.exec(stage);
    if (!m) throw new Error('Slash 命令格式无效');
    const [, name, arg] = m;
    const o = latest.current;
    switch (name) {
      case 'send':
      case 'sendas': {
        let text = arg.replace(/^name=(?:"[^"]*"|'[^']*'|\S+)\s*/, '');
        if (
          (text.startsWith('"') && text.endsWith('"')) ||
          (text.startsWith("'") && text.endsWith("'"))
        )
          text = text.slice(1, -1);
        await bridge.onCall('createChatMessages', [
          [{ role: 'user', message: text.replace(/\\n/g, '\n') }],
        ]);
        result = text;
        break;
      }
      case 'trigger': {
        const updated = latest.current;
        result = (await updated.generate(updated.session.id, updated.session.messages)) || '';
        break;
      }
      case 'setinput':
        o.setInput(arg);
        result = arg;
        break;
      case 'pass':
        result = arg.replace(/\{\{lastMessageId\}\}/gi, String(o.session.messages.length - 1));
        break;
      case 'echo':
        o.notice(arg);
        result = arg;
        break;
      default:
        throw new Error(`尚未支持 Slash 命令：/${name}`);
    }
  }
  return result;
}
