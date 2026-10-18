import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyMemoryContent, prefixDigest, usableMemory, forkMemory, nextMemoryBatch,
  parseMemoryResponse, memoryPromptBlock, memoryContext, memoryExtractionMessages } from '../src/utils/memory.ts';
import { forkSession, addVariant, chooseVariant } from '../src/utils/chatHistory.ts';
import { compilePrompt } from '../src/utils/promptCompiler.ts';
import { memoryOf, preferencesOf, normalizeSettings } from '../src/types/settings.ts';
const messages = (n = 20) => Array.from({ length: n }, (_, i) => ({
  id: `m-${i}`, content: `消息${i}`, role: i % 2 ? 'assistant' : 'user', timestamp: '2026-10-18',
}));
const checkpoint = (history, completed, summary = '过去的故事', offset = 0) => ({
  ...emptyMemoryContent(), summary, cursor: { completed, offset },
  prefixDigest: prefixDigest(history, { completed, offset }), updatedAt: '2026-10-18',
});
const memory = (history, counts = [4, 12, 18]) => ({
  version: 1, characterId: 'card-A', sessionId: 'session-A', revision: 'r1',
  checkpoints: counts.map(n => checkpoint(history, n)),
});
test('display limits migrate independently of memory and reject non-finite or fractional settings', () => {
  assert.equal(preferencesOf().visibleMessageCount, 80);
  for (const [raw, expected] of [[Infinity,80],[NaN,80],['invalid',80],[-2,10],[900,500],[24.9,24]]) {
    const s = normalizeSettings({ providers: [], preferences: { visibleMessageCount: raw }, memory: {recentMessages: 50} });
    assert.equal(s.preferences.visibleMessageCount, expected);
    assert.equal(s.memory.recentMessages, 50);
  }
  assert.equal(memoryOf({ memory: { recentMessages: 500 } }).recentMessages, 200);
});
test('automatic memory is opt-in, bounded, migrated without touching provider/persona config', () => {
  assert.equal(memoryOf().enabled, false);
  const config = normalizeSettings({ providers: [{ id: 'p', apiKey: 'kept' }], memory: {
    enabled: true, batchChars: Infinity, recentMessages: -1, maxOutputTokens: 'bad', triggerEveryTurns: 1.8,
  } });
  assert.equal(config.providers[0].apiKey, 'kept');
  assert.deepEqual(config.memory, { enabled: true, providerId: '', triggerEveryTurns: 1,
    recentMessages: 6, maxMemoryChars: 12000, batchChars: 16000, maxOutputTokens: 4096 });
});
test('memory isolation checks BOTH character and conversation, including identical message IDs', () => {
  const history = messages(), m = memory(history);
  assert.equal(usableMemory(m, 'card-B', 'session-A', history), undefined);
  assert.equal(usableMemory(m, 'card-A', 'session-B', history), undefined);
  assert.equal(usableMemory(m, 'card-A', 'session-A', history).cursor.completed, 18);
  const restored = JSON.parse(JSON.stringify(m));
  assert.equal(usableMemory(restored, 'card-A', 'session-A', history).summary, '过去的故事');
});
test('edit, deletion, variant changes and in-place script changes invalidate stale/future memory', () => {
  const history = messages(), m = memory(history);
  history[6].content = '历史被改写';
  assert.equal(usableMemory(m, 'card-A', 'session-A', history).cursor.completed, 4);
  history[0].content = '开头改写';
  assert.equal(usableMemory(m, 'card-A', 'session-A', history), undefined);
  const h2 = messages(), m2 = memory(h2, [20]);
  h2[19] = addVariant(h2[19], '新结局');
  assert.equal(usableMemory(m2, 'card-A', 'session-A', h2), undefined);
  h2[19] = chooseVariant(h2[19], 0);
  assert.equal(usableMemory(m2, 'card-A', 'session-A', h2).cursor.completed, 20);
  assert.equal(usableMemory(m2, 'card-A', 'session-A', h2.slice(1)), undefined);
});
test('historical fork takes only prefix-valid memory and owns independent deep data', () => {
  const history = messages(), m = memory(history);
  const original = { id: 'session-A', title: '原故事', messages: history, memory: m };
  const fork = forkSession(original, 7);
  assert.notEqual(fork.id, original.id);
  assert.equal(fork.memory.sessionId, fork.id);
  assert.equal(usableMemory(fork.memory, 'card-A', fork.id, fork.messages).cursor.completed, 4);
  assert.equal(fork.memory.checkpoints.length, 1);
  fork.memory.checkpoints[0].summary = '新分支';
  assert.equal(m.checkpoints[0].summary, '过去的故事');
  assert.equal(forkMemory(m, 'card-A', 'new', history.slice(0, 2)), undefined);
});
test('sequential catch-up reads every character of old histories and huge single messages', () => {
  const history = messages(100);
  history[0].content = '超长消息🌸'.repeat(15000);
  const reconstructed = new Map();
  let cursor = { completed: 0, offset: 0 }, batches = 0;
  for (;;) {
    const batch = nextMemoryBatch(history, cursor, 16000);
    if (!batch) break;
    batches++;
    assert.ok(batch.messages.reduce((n, m) => n + m.content.length, 0) <= 16000);
    for (const m of batch.messages) reconstructed.set(m.id, (reconstructed.get(m.id) ?? '') + m.content);
    cursor = batch.to;
  }
  assert.ok(batches > 5);
  assert.deepEqual(cursor, { completed: 100, offset: 0 });
  for (const m of history) assert.equal(reconstructed.get(m.id), m.content);
});
test('only covered messages leave the prompt, unprocessed middle history and recent tail remain', () => {
  const history = messages(30), m = memory(history, [12]);
  const out = memoryContext(m, 'card-A', 'session-A', history, 6);
  assert.equal(out.omitted, 12);
  assert.equal(out.history[0].id, 'm-12');
  assert.equal(out.history.length, 18);
  const partial = memory(history, []);
  partial.checkpoints = [checkpoint(history, 0, '长消息开头', 2)];
  assert.equal(memoryContext(partial, 'card-A', 'session-A', history, 6).omitted, 0);
  assert.equal(memoryContext(undefined, 'card-A', 'session-A', history, 6).history.length, 30);
});
test('strict JSON validation rejects empty, truncated, forged or malformed LLM memory', () => {
  const good = { summary: '约定明日见面', facts: [{ content: '约定', sourceMessageIds: ['m-1'] }], events: [], openThreads: [] };
  assert.equal(parseMemoryResponse('```json\n' + JSON.stringify(good) + '\n```', new Set(['m-1'])).facts.length, 1);
  for (const bad of ['{}', '{"summary":"cut', 'null', JSON.stringify({ ...good, facts: [null] }),
    JSON.stringify({ ...good, facts: [{ content: '捏造', sourceMessageIds: ['not-real'] }] }),
    JSON.stringify(emptyMemoryContent())]) {
    assert.throws(() => parseMemoryResponse(bad, new Set(['m-1'])));
  }
});
test('memory is inserted once without replacing preset, worldbook, history or executing macros', () => {
  const content = { ...emptyMemoryContent(), summary: '用户是八千慧的丈夫 {{getvar::secret}}',
    facts: [{ content: '博丽神社的约定', sourceMessageIds: ['m-0'] }] };
  for (const preset of [{}, { prompts: [{ identifier: 'main', content: '原预设规则' }, { identifier: 'chatHistory', marker: true }] }]) {
    const out = compilePrompt({ character: { name: '测试角色' }, preset,
      history: [{ role: 'user', content: '你好' }], memory: content,
      worldbookHistory: [{ role: 'user', content: '关键词' }],
      worldbooks: [{ name: '书', enabled: true, data: { entries: [{ key: ['关键词'], content: '世界书命中' }] } }],
    });
    const all = out.messages.map(m => m.content).join('\n');
    assert.equal(all.match(/用户是八千慧的丈夫/g).length, 1);
    assert.match(all, /\{\{getvar::secret\}\}/);
    assert.match(all, /世界书命中/);
    assert.equal(out.messages.at(-1).content, '你好');
    assert.ok(out.sources.some(s => s.name === '当前对话自动记忆'));
  }
  assert.ok(memoryPromptBlock(content, 200).length <= 200);
  assert.deepEqual(memoryExtractionMessages(content, nextMemoryBatch(messages()))[1].role, 'user');
});
