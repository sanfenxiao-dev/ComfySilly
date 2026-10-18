import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRegexImport, appendRegexRules, orderedRegexNodes } from '../src/utils/canvasState.ts';
import {
  convertSillyPresetToGraph,
  exportGraphToSillyPreset,
  extractRegexRulesFromPreset,
} from '../src/utils/presetImporter.ts';
import { applyDisplayRules } from '../src/utils/messagePresentation.ts';

const rule = (name, findRegex, replaceString) => ({
  scriptName: name,
  findRegex,
  replaceString,
  placement: [2],
});
const node = (id, rules) => ({
  id,
  type: 'regexFilter',
  position: { x: 0, y: 0 },
  data: { regexList: rules },
});
test('empty separator expressions are preserved as no-op rules', () => {
  const rules = parseRegexImport([rule('section', '', ''), rule('replace', 'A', 'B')]);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].findRegex, '');
  assert.equal(applyDisplayRules('A', rules, 'assistant', 0).text, 'B');
});
test('file appends retain order, dedupe only exact behavior, and never dedupe other nodes', () => {
  const a = rule('A', 'A', 'B'),
    b = rule('B', 'B', 'C');
  const first = parseRegexImport([a]);
  const appended = appendRegexRules(first, parseRegexImport([a, b]));
  assert.equal(appended.skipped, 1);
  assert.deepEqual(
    appended.rules.map((r) => r.scriptName),
    ['A', 'B'],
  );
  assert.equal(appendRegexRules(first, parseRegexImport([a]), false).rules.length, 2);
  assert.equal(appendRegexRules([], parseRegexImport([a])).rules.length, 1);
  assert.equal(appendRegexRules(first, [{ ...a, trimStrings: ['x'] }]).rules.length, 2);
});
test('regex wires override creation order in the actual exported/display pipeline and survive reload', () => {
  const a = node('a', [rule('A', 'A', 'B')]),
    b = node('b', [rule('B', 'B', 'C')]);
  const nodes = [b, a],
    edges = [
      { id: 'a-b', source: 'a', target: 'b', sourceHandle: 'filtered_out', targetHandle: 'llm_in' },
    ];
  assert.deepEqual(
    orderedRegexNodes(nodes, edges).map((n) => n.id),
    ['a', 'b'],
  );
  const saved = exportGraphToSillyPreset([], nodes, {}, edges);
  assert.deepEqual(
    extractRegexRulesFromPreset(saved).map((r) => r.scriptName),
    ['A', 'B'],
  );
  assert.equal(
    applyDisplayRules('A', extractRegexRulesFromPreset(saved), 'assistant', 0).text,
    'C',
  );
  const restored = convertSillyPresetToGraph(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(
    orderedRegexNodes(restored.nodes, restored.edges).map((n) => n.id),
    ['a', 'b'],
  );
  assert.equal(
    applyDisplayRules(
      'A',
      extractRegexRulesFromPreset(
        exportGraphToSillyPreset([], restored.nodes, saved, restored.edges),
      ),
      'assistant',
      0,
    ).text,
    'C',
  );
});
test(
  'read-only user regex fixtures preserve every original field and rule order',
  { skip: !process.env.COMFYSILLY_TEST_REGEX_FILES },
  () => {
    for (const path of JSON.parse(process.env.COMFYSILLY_TEST_REGEX_FILES)) {
      const raw = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
      const originals = Array.isArray(raw) ? raw : [raw],
        parsed = parseRegexImport(raw);
      assert.equal(parsed.length, originals.length);
      for (let i = 0; i < parsed.length; i++)
        for (const key of Object.keys(originals[i]))
          assert.deepEqual(parsed[i][key], originals[i][key]);
    }
  },
);
