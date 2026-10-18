import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { applyDisplayRules, splitMessageParts, getHelperScripts, inspectFrontend } from '../src/utils/messagePresentation.ts';

const path = process.env.COMFYSILLY_TEST_CARD;
test('real imported card display pipeline (read-only, opt-in)', { skip: !path || !existsSync(path) }, () => {
  const card = JSON.parse(readFileSync(path, 'utf8'));
  const result = applyDisplayRules(card.first_mes, card.extensions?.regex_scripts ?? []);
  assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics));
  const parts = splitMessageParts(result.text);
  assert.ok(parts.some(p => p.kind === 'html'), 'Expected this regression card to expose an HTML frontend');
  for (const part of parts.filter(p => p.kind === 'html')) {
    assert.ok(!part.content.startsWith('```'), 'Fences must not leak into HTML');
    const info = inspectFrontend(part.content);
    if (info.loaderOnly) assert.ok(info.urls.length > 0);
  }
  assert.ok(getHelperScripts(card.extensions).length > 0, 'Must recognize the imported helper script encoding');
  console.log(JSON.stringify({ name:card.name, htmlBlocks:parts.filter(p=>p.kind==='html').length, enabledBackgroundScripts:getHelperScripts(card.extensions).length, regexErrors:result.diagnostics.length }));
});
