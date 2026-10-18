import type { Node, Edge } from '@xyflow/react';
import type { SillyPromptItem } from './presetImporter';

/** Stable topological order: wires win; otherwise retain the saved node order. */
export function orderedRegexNodes(nodes: Node[], edges: Edge[]): Node[] {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const e of edges)
    if (index.has(e.source) && index.has(e.target)) {
      outgoing.get(e.source)!.push(e.target);
      incoming.set(e.target, incoming.get(e.target)! + 1);
    }
  const ready = nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id),
    sorted: Node[] = [];
  while (ready.length) {
    ready.sort((a, b) => index.get(a)! - index.get(b)!);
    const id = ready.shift()!;
    sorted.push(nodes[index.get(id)!]);
    for (const target of outgoing.get(id)!) {
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
  }
  // Malformed imported metadata must not crash rendering. Workflow validation
  // reports cycles separately; the remaining nodes retain their saved order.
  const seen = new Set(sorted.map((n) => n.id));
  return [...sorted, ...nodes.filter((n) => !seen.has(n.id))].filter(
    (n) => n.type === 'regexFilter',
  );
}

export function appendRegexRules(
  existing: Record<string, any>[],
  additions: Record<string, any>[],
  skipDuplicates = true,
) {
  const stable = (v: any): any =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, stable(v[k])]),
          )
        : v;
  const signature = (r: any) =>
    JSON.stringify(
      stable(
        Object.fromEntries(
          Object.entries(r).filter(([k]) => k !== 'id' && !k.startsWith('_comfysilly_')),
        ),
      ),
    );
  const seen = new Set(existing.map(signature));
  let skipped = 0;
  const rules = [...existing];
  for (const rule of additions) {
    const key = signature(rule);
    if (skipDuplicates && seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    rules.push(rule);
  }
  if (rules.length > 2000) throw new Error('单个节点最多保留 2000 条正则规则');
  return { rules, skipped };
}

export function canvasState(nodes: Node[], edges: Edge[]) {
  return JSON.parse(
    JSON.stringify({
      version: 1,
      nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
      edges: edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({
        id,
        source,
        target,
        sourceHandle,
        targetHandle,
      })),
    }),
  );
}

export function restoreCanvas(
  nodes: Node[],
  edges: Edge[],
  saved: any,
  callbacks?: any,
): { nodes: Node[]; edges: Edge[] } {
  if (saved?.version !== 1 || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges))
    return { nodes, edges };
  const types = new Set([
    'promptBlock',
    'historySampler',
    'lorebook',
    'assembler',
    'llmInference',
    'regexFilter',
  ]);
  const records = saved.nodes
    .filter(
      (n: any) =>
        n &&
        typeof n.id === 'string' &&
        types.has(n.type) &&
        Number.isFinite(n.position?.x) &&
        Number.isFinite(n.position?.y),
    )
    .slice(0, 2000);
  const byId = new Map<string, any>(records.map((n: any) => [n.id, n]));
  const generatedIds = new Set(nodes.map((n) => n.id));
  const restored = nodes
    .filter((n) => n.type === 'promptBlock' || byId.has(n.id))
    .map((n) => {
      const old = byId.get(n.id);
      return old
        ? {
            ...n,
            position: old.position,
            data: {
              ...n.data,
              ...(n.type === 'regexFilter' && Array.isArray(old.data?.regexList)
                ? { regexList: old.data.regexList }
                : {}),
              collapsed: old.data?.collapsed ?? n.data.collapsed,
            },
          }
        : n;
    });
  for (const n of records)
    if (!generatedIds.has(n.id) && n.type !== 'promptBlock')
      restored.push({
        ...n,
        data: { ...n.data, onUpdate: callbacks?.onUpdate, onToggle: callbacks?.onToggle },
      });
  const ids = new Set(restored.map((n) => n.id));
  const used = new Set<string>();
  const restoredEdges = saved.edges
    .filter(
      (e: any) =>
        e &&
        typeof e.id === 'string' &&
        ids.has(e.source) &&
        ids.has(e.target) &&
        e.source !== e.target &&
        !used.has(e.id) &&
        used.add(e.id),
    )
    .slice(0, 10000);
  return { nodes: restored, edges: restoredEdges };
}

/** A prompt-to-prompt wire means place the target immediately after the source. */
export function connectPromptOrder(prompts: SillyPromptItem[], source: string, target: string) {
  const id = (p: SillyPromptItem, i: number) => `prompt-${p.identifier || i}`;
  const from = prompts.findIndex((p, i) => id(p, i) === source);
  const to = prompts.findIndex((p, i) => id(p, i) === target);
  if (from < 0 || to < 0 || from === to) throw new Error('请选择两个不同的提示词节点');
  const next = [...prompts];
  const [moved] = next.splice(to, 1);
  const sourceIndex = next.findIndex((p) => p === prompts[from]);
  next.splice(sourceIndex + 1, 0, moved);
  return next;
}

export function parseRegexImport(value: unknown): Record<string, any>[] {
  const raw: any = value;
  const rules = Array.isArray(raw)
    ? raw
    : typeof raw?.findRegex === 'string'
      ? [raw]
      : (raw?.regex_scripts ??
        raw?.regexes ??
        raw?.extensions?.regex_scripts ??
        raw?.extensions?.regex);
  if (!Array.isArray(rules) || !rules.length)
    throw new Error('文件不包含正则规则；请选择酒馆正则 JSON，而非 JavaScript 插件');
  if (rules.length > 2000) throw new Error('一次最多导入 2000 条正则');
  return rules.map((r: any, i: number) => {
    if (!r || typeof r.findRegex !== 'string' || typeof r.replaceString !== 'string')
      throw new Error(`第 ${i + 1} 条规则缺少 findRegex 或 replaceString，未导入任何规则`);
    try {
      const match = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(r.findRegex);
      if (match) new RegExp(match[1], match[2]);
      else new RegExp(r.findRegex);
    } catch {
      throw new Error(`第 ${i + 1} 条正则表达式无效，未导入任何规则`);
    }
    return {
      ...r,
      id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
      _comfysilly_instanceId: crypto.randomUUID(),
      scriptName: r.scriptName || r.name || `导入规则 ${i + 1}`,
    };
  });
}
