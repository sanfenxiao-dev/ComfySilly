import type { ChatMessage, ChatSession, MessageVariant } from '../components/CharacterShelf.tsx';
import { forkMemory } from './memory.ts';
const copy = <T>(value: T): T => structuredClone(value);
export function variantsOf(message: ChatMessage): MessageVariant[] {
  const variants = copy(message.variants ?? []);
  if (!variants.length)
    return [
      {
        id: message.id,
        content: message.content,
        timestamp: message.timestamp,
        source: 'original',
      },
    ];
  const selected = Math.max(0, Math.min(variants.length - 1, message.selectedVariant ?? 0));
  variants[selected] = { ...variants[selected], content: message.content };
  return variants;
}
export function addVariant(
  message: ChatMessage,
  content: string,
  source: MessageVariant['source'] = 'generated',
  runtimeVariables?: ChatSession['runtimeVariables'],
): ChatMessage {
  const variants = variantsOf(message);
  variants.push({
    id: crypto.randomUUID(),
    content,
    timestamp: new Date().toISOString(),
    source,
    runtimeVariables: copy(runtimeVariables),
  });
  return { ...message, content, variants, selectedVariant: variants.length - 1 };
}
export function chooseVariant(message: ChatMessage, index: number): ChatMessage {
  const variants = variantsOf(message);
  if (index < 0 || index >= variants.length) throw new Error('回复版本不存在');
  return { ...message, variants, selectedVariant: index, content: variants[index].content };
}
/** A branch owns an independent prefix. Never copy future chat/message state into the past. */
export function forkSession(session: ChatSession, index: number): ChatSession {
  if (index < 0 || index >= session.messages.length) throw new Error('分支起点不存在');
  const messages = copy(session.messages.slice(0, index + 1));
  const checkpoint = session.runtimeCheckpoints?.[messages.at(-1)!.id];
  const variables = copy(
    checkpoint ??
      Object.fromEntries(
        Object.entries(session.runtimeVariables ?? {}).filter(
          ([scope]) => scope.startsWith('script:') || scope.startsWith('extension:'),
        ),
      ),
  );
  for (const key of Object.keys(variables))
    if (key.startsWith('message:') && Number(key.slice(8)) > index) delete variables[key];
  const ids = new Set(messages.map((m) => m.id));
  const branchId = crypto.randomUUID();
  return {
    id: branchId,
    title: `${session.title.replace(/ · 分支.*$/, '')} · 分支 ${index + 1}`,
    updatedAt: new Date().toISOString(),
    parentSessionId: session.id,
    forkedFromMessageId: messages.at(-1)!.id,
    messages,
    memory: session.memory
      ? forkMemory(session.memory, session.memory.characterId, branchId, messages)
      : undefined,
    memoryPaused: session.memoryPaused,
    runtimeVariables: variables,
    runtimeCheckpoints: copy(
      Object.fromEntries(
        Object.entries(session.runtimeCheckpoints ?? {}).filter(([id]) => ids.has(id)),
      ),
    ),
  };
}
export function checkpointSession(session: ChatSession): ChatSession {
  const last = session.messages.at(-1);
  if (!last) return session;
  return {
    ...session,
    runtimeCheckpoints: {
      ...session.runtimeCheckpoints,
      [last.id]: copy(session.runtimeVariables ?? {}),
    },
  };
}
export function sessionMarkdown(
  session: ChatSession,
  characterName: string,
  userName = '用户',
): string {
  return (
    `# ${session.title}\n\n` +
    session.messages
      .map((m) => `## ${m.name || (m.role === 'user' ? userName : characterName)}\n\n${m.content}`)
      .join('\n\n---\n\n')
  );
}
