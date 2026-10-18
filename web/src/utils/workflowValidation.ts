/** Checks graph integrity; does not pretend arbitrary node types are executable. */
export function validateWorkflow(
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[],
): void {
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) throw new Error('节点 ID 重复');
  const count = new Map(nodes.map((n) => [n.id, 0]));
  const out = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) throw new Error('连线引用不存在的节点');
    out.get(e.source)!.push(e.target);
    count.set(e.target, count.get(e.target)! + 1);
  }
  const ready = [...count].filter(([, n]) => n === 0).map(([id]) => id);
  let seen = 0;
  while (ready.length) {
    const id = ready.pop()!;
    seen++;
    for (const target of out.get(id)!) {
      const n = count.get(target)! - 1;
      count.set(target, n);
      if (n === 0) ready.push(target);
    }
  }
  if (seen !== nodes.length) throw new Error('画布存在循环连线，请移除环路');
}
