type Obj = Record<string, any>;
const positions = [
  'before_character_definition',
  'after_character_definition',
  'before_author_note',
  'after_author_note',
  'at_depth',
  'before_example_messages',
  'after_example_messages',
  'outlet',
];
const roles = ['system', 'user', 'assistant'];
const logics = ['and_any', 'not_all', 'not_any', 'and_all'];
/** Character-card V2, ST JSON and TavernHelper are three different schemas. */
export function toHelperEntry(raw: Obj, index: number): Obj {
  const ext = raw.extensions ?? {};
  const pos =
    typeof raw.position === 'number'
      ? raw.position
      : typeof ext.position === 'number'
        ? ext.position
        : raw.position === 'after_char'
          ? 1
          : 0;
  return {
    ...raw,
    uid: Number(raw.uid ?? raw.id ?? index),
    name: raw.name ?? raw.comment ?? '',
    enabled: raw.enabled !== false && raw.disable !== true,
    content: raw.content ?? '',
    strategy: raw.strategy ?? {
      type: raw.constant ? 'constant' : raw.vectorized ? 'vectorized' : 'selective',
      keys: raw.key ?? raw.keys ?? [],
      keys_secondary: {
        logic: logics[raw.selectiveLogic ?? ext.selectiveLogic ?? 0] ?? 'and_any',
        keys: raw.keysecondary ?? raw.secondary_keys ?? [],
      },
      scan_depth: raw.scanDepth ?? ext.scan_depth ?? 'same_as_global',
    },
    position:
      typeof raw.position === 'object' && raw.position
        ? raw.position
        : {
            type: positions[pos] ?? 'before_character_definition',
            role: roles[raw.role ?? ext.role ?? 0] ?? 'system',
            depth: raw.depth ?? ext.depth ?? 4,
            order: raw.order ?? raw.insertion_order ?? 100,
          },
    probability: raw.probability ?? ext.probability ?? 100,
    recursion: raw.recursion ?? {
      prevent_incoming: raw.excludeRecursion ?? ext.exclude_recursion ?? false,
      prevent_outgoing: raw.preventRecursion ?? ext.prevent_recursion ?? false,
      delay_until: raw.delayUntilRecursion ?? ext.delay_until_recursion ?? null,
    },
    effect: raw.effect ?? {
      sticky: raw.sticky ?? ext.sticky ?? null,
      cooldown: raw.cooldown ?? ext.cooldown ?? null,
      delay: raw.delay ?? ext.delay ?? null,
    },
  };
}
/** Apply API edits over the existing raw entry, retaining opaque author fields. */
export function fromHelperEntry(entry: Obj, old: Obj = {}, index = 0): Obj {
  const { strategy, position, recursion, effect, ...rest } = entry;
  const result: Obj = { ...old, ...rest };
  result.uid = Number(entry.uid ?? old.uid ?? old.id ?? index);
  if (entry.name !== undefined) {
    result.comment = entry.name;
    if ('name' in old) result.name = entry.name;
  }
  if (entry.enabled !== undefined) {
    result.enabled = entry.enabled;
    result.disable = !entry.enabled;
  }
  if (strategy) {
    result.constant = strategy.type === 'constant';
    result.vectorized = strategy.type === 'vectorized';
    if (strategy.keys) {
      result.key = strategy.keys;
      result.keys = strategy.keys;
    }
    if (strategy.keys_secondary) {
      result.keysecondary = strategy.keys_secondary.keys;
      result.secondary_keys = strategy.keys_secondary.keys;
      result.selectiveLogic = logics.indexOf(strategy.keys_secondary.logic);
      result.selective = !!strategy.keys_secondary.keys?.length;
    }
    if (strategy.scan_depth !== undefined)
      result.scanDepth = strategy.scan_depth === 'same_as_global' ? null : strategy.scan_depth;
  }
  if (position && typeof position === 'object') {
    result.position = Math.max(0, positions.indexOf(position.type));
    result.order = position.order ?? old.order ?? old.insertion_order ?? 100;
    result.insertion_order = result.order;
    result.depth = position.depth ?? old.depth ?? 4;
    result.role = Math.max(0, roles.indexOf(position.role));
    result.extensions = {
      ...old.extensions,
      position: result.position,
      depth: result.depth,
      role: result.role,
    };
  } else if (position !== undefined) result.position = position;
  if (recursion) {
    result.excludeRecursion = recursion.prevent_incoming;
    result.preventRecursion = recursion.prevent_outgoing;
    result.delayUntilRecursion = recursion.delay_until;
  }
  if (effect) Object.assign(result, effect);
  return result;
}
