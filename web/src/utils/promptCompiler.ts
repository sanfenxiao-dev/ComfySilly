import type { SillyPresetJson, SillyPromptItem } from './presetImporter.ts';
import { applyDisplayRules } from './messagePresentation.ts';
import type { MemoryContent } from './memory.ts';
import { memoryPromptBlock } from './memory.ts';
export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
interface Entry {
  [key: string]: unknown;
}
export interface PromptCharacter {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  lorebook?: { name?: string; entries: unknown };
  extensions?: Record<string, unknown>;
}
export interface PromptBook {
  name: string;
  enabled: boolean;
  data: { entries: unknown };
}
export interface PromptInput {
  character: PromptCharacter;
  preset?: SillyPresetJson | null;
  history: PromptMessage[];
  worldbooks?: PromptBook[];
  userName?: string;
  personaDescription?: string;
  variables?: Record<string, unknown>;
  overflowPolicy?: 'error' | 'trim-history';
  /** Optional character budget for activated worldbook content. */
  worldbookCharBudget?: number;
  memory?: MemoryContent;
  memoryCharBudget?: number;
  /** Keep worldbook matching independent of memory's recent-history window. */
  worldbookHistory?: PromptMessage[];
}
export interface PromptCompilation {
  messages: PromptMessage[];
  sources: { name: string; characters: number }[];
  warnings: string[];
  estimatedTokens: number;
  budget: GenerationBudget;
}
export interface GenerationBudget {
  contextWindow: number;
  maxOutputTokens: number;
  inputBudget: number;
  warnings: string[];
}
/** Imported presets are untrusted configuration, not model capability metadata. */
export function generationBudget(preset?: SillyPresetJson | null): GenerationBudget {
  const warnings: string[] = [];
  const rawContext = Number(preset?.openai_max_context ?? 32768);
  const contextWindow =
    Number.isFinite(rawContext) && rawContext >= 1024
      ? Math.min(2000000, Math.floor(rawContext))
      : 32768;
  const rawOutput = Number(preset?.openai_max_tokens ?? 4096);
  let maxOutputTokens =
    Number.isFinite(rawOutput) && rawOutput > 0
      ? Math.max(1, Math.min(131072, Math.floor(rawOutput)))
      : Math.min(4096, Math.floor(contextWindow / 4));
  if (maxOutputTokens >= contextWindow) {
    maxOutputTokens = Math.min(4096, Math.floor(contextWindow / 4));
    warnings.push(
      `预设回复上限 ${rawOutput} 不小于上下文 ${contextWindow}，本次按 ${maxOutputTokens} 回复 tokens 请求；原预设未修改，可在“生成参数”中调整。`,
    );
  }
  if (contextWindow !== rawContext)
    warnings.push(
      `上下文数值无效或超出支持范围，本次使用 ${contextWindow}；请按模型实际能力调整。`,
    );
  return { contextWindow, maxOutputTokens, inputBudget: contextWindow - maxOutputTokens, warnings };
}
export function orderPrompts(preset: SillyPresetJson): SillyPromptItem[] {
  const prompts = Array.isArray(preset.prompts) ? preset.prompts : [];
  const orders = Array.isArray(preset.prompt_order) ? preset.prompt_order : [];
  const selected = orders.find((o) => o.character_id === 100001) ?? orders.at(-1);
  if (!Array.isArray(selected?.order)) return [...prompts];
  const map = new Map(prompts.map((p) => [p.identifier, p]));
  const used = new Set<string>();
  const result: SillyPromptItem[] = [];
  for (const item of selected.order) {
    const p = map.get(item.identifier);
    if (p && !used.has(item.identifier)) {
      used.add(item.identifier);
      result.push({ ...p, enabled: item.enabled ?? p.enabled });
    }
  }
  // Unordered extensions remain preserved but do not silently become active.
  for (const p of prompts)
    if (!p.identifier || !used.has(p.identifier)) result.push({ ...p, enabled: false });
  return result;
}
export function withPromptOrder(
  preset: SillyPresetJson,
  prompts: SillyPromptItem[],
): SillyPresetJson {
  const orders = Array.isArray(preset.prompt_order) ? preset.prompt_order : [];
  const selected = orders.findIndex((o) => o.character_id === 100001);
  const index = selected >= 0 ? selected : Math.max(0, orders.length - 1);
  const order = prompts
    .filter((p) => p.identifier)
    .map((p) => ({ identifier: p.identifier, enabled: p.enabled !== false }));
  const next = orders.length
    ? orders.map((item, i) => (i === index ? { ...item, order } : item))
    : [{ character_id: 100001, order }];
  return { ...preset, prompts, prompt_order: next };
}
const list = (v: unknown): Entry[] =>
  Array.isArray(v)
    ? v.filter((x) => x && typeof x === 'object')
    : v && typeof v === 'object'
      ? (Object.values(v).filter((x) => x && typeof x === 'object') as Entry[])
      : [];
const keys = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === 'string')
    : typeof v === 'string'
      ? v
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
export function compilePrompt(input: PromptInput): PromptCompilation {
  const { character: c, preset = {}, history } = input;
  const p = preset ?? {};
  const warnings: string[] = [];
  const sources: PromptCompilation['sources'] = [];
  const generation = generationBudget(p);
  // Worldbooks are intentionally bounded, but a fixed 48k ceiling made large
  // books look completely broken: one oversized entry could cause every later
  // entry to be reported as "skipped". Derive a safer default from the actual
  // input budget and let callers override it for small local models.
  const requestedWorldBudget = Number(input.worldbookCharBudget);
  const worldBudget =
    Number.isFinite(requestedWorldBudget) && requestedWorldBudget > 0
      ? Math.floor(requestedWorldBudget)
      : Math.min(160000, Math.max(48000, Math.floor(generation.inputBudget * 1.5)));
  const values: Record<string, string> = {
    char: c.name,
    user: input.userName || '用户',
    description: c.description || '',
    personality: c.personality || '',
    scenario: c.scenario || '',
    mesexamples: c.mes_example || '',
    persona: input.personaDescription || '',
    lastmessage: history.at(-1)?.content || '',
    newline: '\n',
    trim: '',
    original: '',
  };
  const expand = (text: string) =>
    text
      .replace(/\{\{\/\/[\s\S]*?\}\}/g, '')
      .replace(/\{\{([^{}]+)\}\}/g, (whole, name: string) => {
        const lower = name.trim().toLowerCase();
        if (Object.hasOwn(values, lower)) return values[lower];
        const variable = /^getvar::(.+)$/i.exec(name);
        if (variable) return String(input.variables?.[variable[1]] ?? '');
        if (!warnings.includes(`未展开的宏：${name}`)) warnings.push(`未展开的宏：${name}`);
        return whole;
      });
  const books = [
    ...(input.worldbooks ?? [])
      .filter((b) => b.enabled)
      .map((b) => ({ name: b.name, entries: b.data.entries })),
    ...(c.lorebook ? [{ name: c.lorebook.name || '角色世界书', entries: c.lorebook.entries }] : []),
  ];
  const candidates = books.flatMap((b) =>
    list(b.entries).map((entry, index) => ({
      entry,
      name: `${b.name} / ${String(entry.comment ?? entry.name ?? entry.uid ?? index)}`,
    })),
  );
  const activated = new Set<number>();
  const before: string[] = [];
  const after: string[] = [];
  const depthEntries: { content: string; depth: number; role: PromptMessage['role'] }[] = [];
  const activatedEntries: {
    content: string;
    order: number;
    position: unknown;
    depth: number;
    role: PromptMessage['role'];
  }[] = [];
  let search = (input.worldbookHistory ?? history)
    .slice(-10)
    .map((m) => m.content)
    .join('\n');
  let worldChars = 0;
  for (let pass = 0; pass < 3; pass++) {
    let additions = '';
    for (const [index, { entry: e, name }] of candidates.entries()) {
      if (
        activated.has(index) ||
        e.disable === true ||
        e.enabled === false ||
        Number(e.probability ?? 100) === 0
      )
        continue;
      const ext = (e.extensions ?? {}) as Entry;
      const content = typeof e.content === 'string' ? expand(e.content) : '';
      if (!content.trim()) continue;
      const haystack = e.caseSensitive === true ? search : search.toLocaleLowerCase();
      const match = (k: string) =>
        haystack.includes(e.caseSensitive === true ? k : k.toLocaleLowerCase());
      const primary = keys(e.key ?? e.keys);
      const secondary = keys(e.keysecondary ?? e.secondary_keys);
      const primaryHit = primary.some(match);
      const secondaryHit = secondary.some(match);
      const logic = Number(e.selectiveLogic ?? ext.selectiveLogic ?? 0);
      const selective = e.selective === true && secondary.length > 0;
      const secondaryPass =
        !selective ||
        (logic === 0
          ? secondaryHit
          : logic === 1
            ? !secondary.every(match)
            : logic === 2
              ? !secondaryHit
              : secondary.every(match));
      if (e.constant !== true && !(primaryHit && secondaryPass)) continue;
      const remaining = worldBudget - worldChars;
      if (remaining <= 0) {
        warnings.push(`世界书预算已用尽，未注入：${name}`);
        continue;
      }
      // Keep an activated entry visible whenever there is room. Truncating the
      // tail is much more useful than dropping the whole entry, especially for
      // cards whose first paragraphs contain the actual setting/keywords.
      const injectedContent = content.length > remaining ? content.slice(0, remaining) : content;
      if (injectedContent.length < content.length) {
        warnings.push(
          `世界书条目过长，本次截断 ${content.length - injectedContent.length} 字符：${name}`,
        );
      }
      activated.add(index);
      worldChars += injectedContent.length;
      additions += '\n' + injectedContent;
      sources.push({ name, characters: injectedContent.length });
      const position = e.position ?? ext.position ?? 0;
      if (
        ![0, 1, 4, 'before_char', 'after_char', 'at_depth'].includes(position as number | string)
      ) {
        warnings.push(
          `世界书「${name}」的位置 ${String(position)} 尚未支持，已跳过注入；原参数保留。`,
        );
        continue;
      }
      const order = Number(e.order ?? e.insertion_order ?? 100);
      const role = Number(e.role ?? ext.role ?? 0);
      activatedEntries.push({
        content: injectedContent,
        order: Number.isFinite(order) ? order : 100,
        position,
        depth: Math.max(0, Number(e.depth ?? ext.depth ?? 0) || 0),
        role: role === 1 ? 'user' : role === 2 ? 'assistant' : 'system',
      });
    }
    if (!additions) break;
    search += additions;
  }
  // ST insertion order: larger numbers appear later in the same prompt position.
  // https://docs.sillytavern.app/usage/core-concepts/worldinfo/#insertion-order
  for (const entry of activatedEntries.sort((a, b) => a.order - b.order)) {
    if (entry.position === 4 || entry.position === 'at_depth')
      depthEntries.push({ content: entry.content, depth: entry.depth, role: entry.role });
    else if (entry.position === 1 || entry.position === 'after_char') after.push(entry.content);
    else before.push(entry.content);
  }
  values.wibefore = before.join('\n\n');
  values.wiafter = after.join('\n\n');
  const historyCopy = history.map((m) => ({ ...m, content: expand(m.content) }));
  const result: PromptMessage[] = [];
  const injections: { content: string; depth: number; role: PromptMessage['role'] }[] = [
    ...depthEntries,
  ];
  let hadHistory = false;
  const markers = new Set<string>();
  const memoryBlock = input.memory
    ? memoryPromptBlock(input.memory, input.memoryCharBudget ?? 12000)
    : '';
  const markerValues: Record<string, string> = {
    worldInfoBefore: values.wibefore,
    charDescription: values.description,
    charPersonality: values.personality,
    scenario: values.scenario,
    worldInfoAfter: values.wiafter,
    dialogueExamples: values.mesexamples,
    personaDescription: values.persona,
  };
  const add = (content: string, role: PromptMessage['role'], name: string) => {
    if (content.trim()) {
      result.push({ role, content: expand(content) });
      sources.push({ name, characters: content.length });
    }
  };
  const prompts = orderPrompts(p);
  if (!prompts.some((x) => x.enabled !== false)) {
    add(p.main_prompt || '以角色身份继续对话，遵循角色设定与世界信息。', 'system', '默认主提示词');
    add(
      [
        values.wibefore,
        values.description,
        values.personality,
        values.scenario,
        values.wiafter,
        values.mesexamples,
        values.persona,
      ]
        .filter(Boolean)
        .join('\n\n'),
      'system',
      '角色与世界书',
    );
    result.push(...historyCopy);
    hadHistory = true;
  } else {
    for (const item of prompts) {
      if (item.enabled === false) continue;
      const id = item.identifier || '';
      markers.add(id);
      if (id === 'chatHistory') {
        result.push(...historyCopy);
        hadHistory = true;
        continue;
      }
      const role: PromptMessage['role'] = ['user', 'assistant'].includes(item.role ?? '')
        ? (item.role as PromptMessage['role'])
        : 'system';
      const content = markerValues[id] ?? item.content ?? '';
      if (item.injection_position === 1)
        injections.push({
          content: expand(content),
          depth: Math.max(0, Number(item.injection_depth ?? 0)),
          role,
        });
      else add(content, role, item.name || id || '预设提示词');
    }
    // Presets without marker blocks still need the selected character's context.
    if (!markers.has('charDescription'))
      result.unshift({
        role: 'system',
        content: expand(
          [values.description, values.personality, values.scenario].filter(Boolean).join('\n\n'),
        ),
      });
    if (!markers.has('worldInfoBefore') && values.wibefore)
      result.unshift({ role: 'system', content: values.wibefore });
    if (!markers.has('worldInfoAfter') && values.wiafter)
      result.push({ role: 'system', content: values.wiafter });
    if (!markers.has('personaDescription') && values.persona)
      result.unshift({ role: 'system', content: expand(values.persona) });
    if (!hadHistory) result.push(...historyCopy);
  }
  const memoryMessage: PromptMessage | undefined = memoryBlock
    ? { role: 'system', content: memoryBlock }
    : undefined;
  if (memoryMessage) {
    const firstHistory = result.findIndex((m) => historyCopy.includes(m));
    result.splice(firstHistory < 0 ? result.length : firstHistory, 0, memoryMessage);
    sources.push({ name: '当前对话自动记忆', characters: memoryBlock.length });
  }
  for (const inj of injections)
    if (inj.content.trim())
      result.splice(Math.max(0, result.length - inj.depth), 0, {
        role: inj.role,
        content: inj.content,
      });
  const promptRules = Array.isArray(c.extensions?.regex_scripts)
    ? c.extensions.regex_scripts
        .filter((r: Entry) => r?.promptOnly === true)
        .map((r: Entry) => ({ ...r, promptOnly: false }))
    : [];
  const historyMessages = new Set(historyCopy);
  const latestUserIndex = historyCopy.findLastIndex((m) => m.role === 'user');
  const protectedHistory = new Set(historyCopy.slice(latestUserIndex >= 0 ? latestUserIndex : -1));
  const candidatesToSend = result
    .filter((m) => m.content.trim())
    .map((m, index) => {
      const processed =
        m === memoryMessage
          ? { text: m.content, diagnostics: [] }
          : applyDisplayRules(m.content, promptRules, m.role, result.length - index - 1);
      warnings.push(...processed.diagnostics.map((d) => `${d.name}: ${d.error}`));
      return {
        message: { ...m, content: processed.text },
        removable: historyMessages.has(m) && !protectedHistory.has(m),
      };
    });
  const messages = candidatesToSend.map((item) => item.message);
  if (messages.some((m) => m.content.includes('<%')))
    warnings.push('检测到 EJS 提示词模板：当前未执行模板脚本，原文保留，请先检查发送内容。');
  const budget = generation;
  warnings.push(...budget.warnings);
  let chars = messages.reduce((n, m) => n + m.content.length, 0);
  let count = messages.length;
  const tokens = () => Math.ceil(chars / 2) + count * 4;
  const removed = new Set<PromptMessage>();
  if (input.overflowPolicy === 'trim-history') {
    for (const candidate of candidatesToSend) {
      if (tokens() <= budget.inputBudget) break;
      if (!candidate.removable) continue;
      removed.add(candidate.message);
      chars -= candidate.message.content.length;
      count--;
    }
  }
  const estimatedTokens = tokens();
  if (estimatedTokens > budget.inputBudget)
    throw new Error(
      `输入约 ${estimatedTokens} tokens（字符估算），当前输入预算 ${budget.inputBudget} = 上下文 ${budget.contextWindow} − 回复预留 ${budget.maxOutputTokens}。请打开“生成参数”按模型能力调整上下文/回复上限，或缩短当前消息、角色设定与世界书；预设提示词和最新一轮对话不会自动删减。`,
    );
  if (removed.size)
    warnings.push(
      `本次请求省略了 ${removed.size} 条较早历史以适配输入预算；完整聊天记录仍保留在本地。`,
    );
  return {
    messages: messages.filter((m) => !removed.has(m)),
    sources,
    warnings: [...new Set(warnings)],
    estimatedTokens,
    budget,
  };
}
