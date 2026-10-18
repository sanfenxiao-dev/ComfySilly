import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePrompt, orderPrompts, withPromptOrder } from '../src/utils/promptCompiler.ts';
import {
  convertSillyPresetToGraph,
  exportGraphToSillyPreset,
} from '../src/utils/presetImporter.ts';
const character = {
  name: '测试角色',
  description: '角色设定 {{char}}',
  personality: '耐心',
  scenario: '图书馆',
  lorebook: { name: '角色书', entries: [{ uid: 1, key: ['钥匙'], content: '角色钥匙信息' }] },
};
const history = [{ role: 'user', content: '寻找钥匙' }];
test('prompt_order is authoritative for canvas, compiler, and round trip', () => {
  const preset = {
    unknown: { keep: 42 },
    prompts: [
      { identifier: 'a', content: 'A' },
      { identifier: 'b', content: 'B' },
      { identifier: 'chatHistory', marker: true },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'b', enabled: true },
          { identifier: 'a', enabled: false },
          { identifier: 'chatHistory', enabled: true },
        ],
      },
    ],
  };
  assert.deepEqual(
    orderPrompts(preset).map((p) => [p.identifier, p.enabled]),
    [
      ['b', true],
      ['a', false],
      ['chatHistory', true],
    ],
  );
  const graph = convertSillyPresetToGraph(preset);
  assert.deepEqual(
    graph.nodes.filter((n) => n.type === 'promptBlock').map((n) => n.data.identifier),
    ['b', 'chatHistory'],
  );
  const ordered = withPromptOrder(preset, [
    { ...preset.prompts[0], enabled: true },
    preset.prompts[2],
    { ...preset.prompts[1], enabled: false },
  ]);
  const exported = exportGraphToSillyPreset(
    orderPrompts(ordered),
    convertSillyPresetToGraph(ordered).nodes,
    ordered,
  );
  assert.equal(exported.unknown.keep, 42);
  assert.deepEqual(
    orderPrompts(exported).map((p) => p.identifier),
    ['a', 'chatHistory', 'b'],
  );
  const out = compilePrompt({ character: { name: 'x' }, history, preset: exported });
  assert.equal(
    out.messages.some((m) => m.content === 'B'),
    false,
  );
  assert.equal(
    out.messages.some((m) => m.content === 'A'),
    true,
  );
});
test('worldbooks respect master switch, entry switch, keys and recursion', () => {
  const out = compilePrompt({
    character,
    history,
    worldbooks: [
      {
        name: '开',
        enabled: true,
        data: {
          entries: [
            { constant: true, content: '常驻' },
            { key: ['角色钥匙信息'], content: '递归命中' },
            { key: ['钥匙'], disable: true, content: '禁用条目' },
          ],
        },
      },
      {
        name: '关',
        enabled: false,
        data: { entries: [{ constant: true, content: '禁用世界书' }] },
      },
    ],
  });
  const text = out.messages.map((m) => m.content).join('\n');
  assert.match(text, /角色钥匙信息/);
  assert.match(text, /递归命中/);
  assert.match(text, /常驻/);
  assert.doesNotMatch(text, /禁用条目|禁用世界书/);
  assert.match(text, /角色设定 测试角色/);
});
test('prompt-only regex transforms requests without changing persisted history', () => {
  const input = [{ role: 'user', content: 'secret data' }];
  const c = {
    name: 'x',
    extensions: {
      regex_scripts: [
        { findRegex: 'secret', replaceString: 'redacted', promptOnly: true, placement: [1] },
      ],
    },
  };
  const out = compilePrompt({ character: c, history: input });
  assert.equal(out.messages.at(-1).content, 'redacted data');
  assert.equal(input[0].content, 'secret data');
});
test('depth injection uses actual history; no silently dropped over-budget content', () => {
  const preset = {
    prompts: [
      { identifier: 'chatHistory', marker: true },
      { identifier: 'depth', content: 'insert', injection_position: 1, injection_depth: 1 },
    ],
    openai_max_context: 1024,
    openai_max_tokens: 100,
  };
  const out = compilePrompt({ character: { name: 'x' }, history, preset });
  assert.equal(out.messages.at(-2).content, 'insert');
  assert.equal(out.messages.at(-1).content, '寻找钥匙');
  assert.throws(
    () =>
      compilePrompt({
        character: { name: 'x' },
        history: [{ role: 'user', content: 'x'.repeat(10000) }],
        preset,
      }),
    /当前输入预算/,
  );
});

test('worldbook insertion order and character-card aliases are honored after recursive activation', () => {
  const book = {
    name: '排序',
    enabled: true,
    data: {
      entries: [
        { constant: true, order: 250, content: 'LATE activates EARLY_KEY' },
        { keys: ['EARLY_KEY'], insertion_order: 100, content: 'EARLY_ONLY' },
        { constant: true, enabled: false, content: 'DISABLED_ALIAS' },
      ],
    },
  };
  const out = compilePrompt({
    character: { name: 'x' },
    history: [{ role: 'user', content: 'hi' }],
    worldbooks: [book],
  });
  const text = out.messages.map((m) => m.content).join('\n');
  assert.ok(text.indexOf('EARLY_ONLY') < text.indexOf('LATE activates'));
  assert.doesNotMatch(text, /DISABLED_ALIAS/);
});
test('unsupported worldbook positions are reported instead of silently injected at the wrong place', () => {
  const out = compilePrompt({
    character: { name: 'x' },
    history: [],
    worldbooks: [
      {
        name: '扩展',
        enabled: true,
        data: { entries: [{ constant: true, position: 7, content: 'OUTLET_NOT_IMPLEMENTED' }] },
      },
    ],
  });
  assert.ok(out.warnings.some((w) => w.includes('位置 7 尚未支持')));
  assert.equal(
    out.messages.some((m) => m.content.includes('OUTLET_NOT_IMPLEMENTED')),
    false,
  );
});
