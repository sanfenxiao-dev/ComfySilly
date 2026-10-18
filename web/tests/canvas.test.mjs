import test from 'node:test';
import assert from 'node:assert/strict';
import { connectPromptOrder, parseRegexImport } from '../src/utils/canvasState.ts';
import {
  convertSillyPresetToGraph,
  exportGraphToSillyPreset,
  extractRegexRulesFromPreset,
} from '../src/utils/presetImporter.ts';
import { orderPrompts } from '../src/utils/promptCompiler.ts';
test('canvas persists custom nodes, positions, deleted default nodes and edges without callbacks', () => {
  const preset = {
    prompts: [
      { identifier: 'a', content: 'A' },
      { identifier: 'b', content: 'B' },
    ],
  };
  const graph = convertSillyPresetToGraph(preset);
  graph.nodes = graph.nodes.filter((n) => n.type !== 'historySampler');
  graph.nodes[0].position = { x: 123, y: 456 };
  graph.nodes.push({
    id: 'custom-asm',
    type: 'assembler',
    position: { x: 25, y: 25 },
    data: { onUpdate: () => {} },
  });
  graph.edges = graph.edges.filter(
    (e) => graph.nodes.some((n) => n.id === e.source) && graph.nodes.some((n) => n.id === e.target),
  );
  const saved = exportGraphToSillyPreset(preset.prompts, graph.nodes, preset, graph.edges);
  const reload = convertSillyPresetToGraph(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reload.nodes[0].position, { x: 123, y: 456 });
  assert.ok(reload.nodes.some((n) => n.id === 'custom-asm'));
  assert.ok(!reload.nodes.some((n) => n.type === 'historySampler'));
  assert.deepEqual(
    reload.edges.map((e) => e.id),
    graph.edges.map((e) => e.id),
  );
  assert.equal(JSON.stringify(saved).includes('onUpdate'), false);
});
test('prompt wires update canonical order and rejected self-connections do not mutate', () => {
  const p = ['a', 'b', 'c'].map((identifier) => ({ identifier, content: identifier }));
  const next = connectPromptOrder(p, 'prompt-c', 'prompt-a');
  assert.deepEqual(
    next.map((p) => p.identifier),
    ['b', 'c', 'a'],
  );
  assert.deepEqual(
    p.map((p) => p.identifier),
    ['a', 'b', 'c'],
  );
  assert.throws(() => connectPromptOrder(p, 'prompt-a', 'prompt-a'));
  const g = convertSillyPresetToGraph({ prompts: next });
  const saved = exportGraphToSillyPreset(next, g.nodes, {}, g.edges);
  assert.deepEqual(
    orderPrompts(saved).map((p) => p.identifier),
    ['b', 'c', 'a'],
  );
});
test('regex JSON accepts single rule and envelopes, validates atomically, preserves unknown fields', () => {
  const r = {
    scriptName: 'rule',
    findRegex: '/a/g',
    replaceString: 'b',
    custom: { keep: true },
    placement: [2],
  };
  for (const value of [r, [r], { regex_scripts: [r] }, { extensions: { regex_scripts: [r] } }]) {
    const parsed = parseRegexImport(value);
    assert.equal(parsed.length, 1);
    assert.deepEqual(parsed[0].custom, r.custom);
  }
  for (const bad of [
    null,
    {},
    [],
    [r, { findRegex: '[', replaceString: '' }],
    { content: 'alert(1)' },
  ])
    assert.throws(() => parseRegexImport(bad));
  const preset = { prompts: [], extensions: { regex: [r], regex_scripts: [r] } };
  const graph = convertSillyPresetToGraph(preset);
  graph.nodes.find((n) => n.type === 'regexFilter').data.regexList = [r];
  const saved = exportGraphToSillyPreset([], graph.nodes, preset, graph.edges);
  assert.equal(extractRegexRulesFromPreset(saved).length, 1);
  assert.equal(
    extractRegexRulesFromPreset(
      exportGraphToSillyPreset([], convertSillyPresetToGraph(saved).nodes, saved),
    ).length,
    1,
  );
});
