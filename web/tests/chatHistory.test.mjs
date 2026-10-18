import test from 'node:test';
import assert from 'node:assert/strict';
import {
  variantsOf,
  addVariant,
  chooseVariant,
  forkSession,
  checkpointSession,
  sessionMarkdown,
} from '../src/utils/chatHistory.ts';
import { normalizeSettings, preferencesOf, personaOf } from '../src/types/settings.ts';
import { compilePrompt } from '../src/utils/promptCompiler.ts';
const msg = (id, role = 'assistant', content = id) => ({
  id,
  role,
  content,
  timestamp: '2026-10-18T00:00:00.000Z',
});
const original = {
  id: 'root',
  title: '原故事',
  updatedAt: '2026-10-18',
  messages: [msg('a'), msg('b', 'user'), msg('c')],
  runtimeVariables: {
    chat: { future: 'must not leak' },
    'message:2': { future: true },
    'script:config': { keep: true },
  },
};
test('old settings migrate to centered layout without losing providers, keys or unknown fields', () => {
  const legacy = {
    activeProviderId: 'custom',
    providers: [{ id: 'custom', apiKey: 'only-a-fixture', name: '原连接', model: 'fixture' }],
    future: { preserve: 42 },
  };
  const out = normalizeSettings(legacy);
  assert.equal(out.providers[0].apiKey, legacy.providers[0].apiKey);
  assert.equal(out.providers[0].model, legacy.providers[0].model);
  assert.equal(out.providers[0].name, legacy.providers[0].name);
  assert.equal(out.future.preserve, 42);
  assert.equal(out.activeProviderId, 'custom');
  assert.equal(out.preferences.chatLayout, 'centered');
  assert.equal(personaOf(out).name, '用户');
  assert.equal(legacy.preferences, undefined);
});
test('preference bounds and unknown theme are safe', () => {
  const p = preferencesOf({
    preferences: { messageWidth: 99999, fontSize: -1, theme: 'invalid', motion: 'invalid' },
  });
  assert.equal(p.messageWidth, 1200);
  assert.equal(p.fontSize, 13);
  assert.equal(p.theme, 'dark');
  assert.equal(p.motion, 'full');
});
test('persona active selection and fallback do not rewrite saved identities', () => {
  const s = normalizeSettings({
    providers: [{ id: 'p' }],
    personas: [
      { id: 'one', name: '甲', description: '背景甲' },
      { id: 'two', name: '乙', description: '背景乙' },
    ],
    activePersonaId: 'two',
  });
  assert.equal(personaOf(s).name, '乙');
  assert.equal(personaOf({ ...s, activePersonaId: 'missing' }).name, '甲');
});
test('persona name and description enter the actual prompt exactly once with or without markers', () => {
  for (const preset of [
    undefined,
    {
      prompts: [
        { identifier: 'personaDescription', enabled: true, marker: true },
        { identifier: 'chatHistory', enabled: true, marker: true },
      ],
    },
  ]) {
    const out = compilePrompt({
      character: { name: '角色', description: '致 {{user}}' },
      history: [{ role: 'user', content: '你好' }],
      preset,
      userName: '小河',
      personaDescription: 'USER_UNIQUE 小河的背景',
    });
    const text = out.messages.map((m) => m.content).join('\n');
    assert.equal(text.split('USER_UNIQUE').length - 1, 1);
    assert.match(text, /致 小河/);
  }
});
test('fork preserves original timeline and deeply isolates prefix', () => {
  const before = JSON.stringify(original);
  const fork = forkSession(original, 1);
  assert.equal(fork.parentSessionId, 'root');
  assert.equal(fork.forkedFromMessageId, 'b');
  assert.equal(fork.messages.length, 2);
  fork.messages[0].content = 'edited';
  assert.equal(JSON.stringify(original), before);
  assert.notEqual(fork.id, original.id);
});
test('legacy historical forks never inherit future chat/message variables', () => {
  const fork = forkSession(original, 1);
  assert.equal(fork.runtimeVariables.chat, undefined);
  assert.equal(fork.runtimeVariables['message:2'], undefined);
  assert.deepEqual(fork.runtimeVariables['script:config'], { keep: true });
});
test('checkpoints restore exact past and trim later scopes', () => {
  const session = {
    ...original,
    runtimeCheckpoints: {
      b: { chat: { past: 1 }, 'message:1': { ok: true }, 'message:2': { bad: true } },
      c: { chat: { past: 2 } },
    },
  };
  const fork = forkSession(session, 1);
  assert.deepEqual(fork.runtimeVariables.chat, { past: 1 });
  assert.equal(fork.runtimeVariables['message:2'], undefined);
  assert.equal(fork.runtimeCheckpoints.c, undefined);
  fork.runtimeVariables.chat.past = 99;
  assert.equal(session.runtimeCheckpoints.b.chat.past, 1);
});
test('regeneration and editing retain original and all alternatives', () => {
  const first = msg('m', 'assistant', 'original');
  const v2 = addVariant(first, 'second');
  const v3 = addVariant(v2, 'third', 'edited');
  assert.deepEqual(
    variantsOf(v3).map((v) => v.content),
    ['original', 'second', 'third'],
  );
  assert.equal(v3.selectedVariant, 2);
  const selected = chooseVariant(v3, 0);
  assert.equal(selected.content, 'original');
  assert.equal(v3.content, 'third');
  assert.equal(first.variants, undefined);
  assert.throws(() => chooseVariant(v3, 5));
});
test('external script edits update the selected variant rather than losing it', () => {
  const m = addVariant(msg('m', 'assistant', 'first'), 'second');
  m.content = 'script-updated';
  const next = addVariant(m, 'third');
  assert.deepEqual(
    next.variants.map((v) => v.content),
    ['first', 'script-updated', 'third'],
  );
});
test('runtime checkpoint and export do not expose provider settings', () => {
  const s = checkpointSession(original);
  s.runtimeVariables.chat.future = 'changed';
  assert.equal(s.runtimeCheckpoints.c.chat.future, 'must not leak');
  assert.equal(original.runtimeCheckpoints, undefined);
  assert.match(sessionMarkdown(s, '角色', '用户'), /# 原故事/);
  assert.doesNotMatch(sessionMarkdown(s, '角色', '用户'), /apiKey|must not leak/);
});

test('malformed optional preferences and identities cannot crash migration', () => {
  const s = normalizeSettings({
    providers: 'invalid',
    personas: [null, { id: 'x', name: 42 }],
    preferences: { sendKey: 'invalid', autoScroll: 'invalid' },
  });
  assert.equal(s.providers.length, 1);
  assert.equal(personaOf(s).name, '用户');
  assert.equal(s.preferences.sendKey, 'enter');
  assert.equal(s.preferences.autoScroll, true);
});
