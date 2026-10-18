import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = dirname(dirname(fileURLToPath(import.meta.url))),
  require = createRequire(import.meta.url);
const { chromium } = require(join(process.env.PLAYWRIGHT_MODULE_DIR, 'playwright'));
const server = await createServer({ root, server: { host:'127.0.0.1',port:0,hmr:false,watch:null } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const messages = Array.from({ length: 200 }, (_, i) => ({
    id: 'history-' + i,
    role: i % 2 === 0 ? 'assistant' : 'user',
    content: `历史消息 ${i}：这是必须保留的原文。`,
    timestamp: '2026-10-18T00:00:00Z',
  }));
  const card = {
    id: 'history-test',
    name: '长对话测试',
    creator: '',
    character_version: '1',
    description: '',
    personality: '',
    scenario: '',
    first_mes: '开场',
    avatar_b64: '',
    sessions: [{ id: 'long', title: '200 条原始历史', updatedAt: '2026-10-18', messages }],
  };
  await page.route('**/__test__/card.json', (r) => r.fulfill({ json: card }));
  await page.goto(server.resolvedUrls.local[0] + 'tests/chat-harness.html?generation=1');
  await page.waitForFunction(() => document.querySelectorAll('.chat-message').length === 80);
  // Visibility is a presentation preference, NEVER a model history filter.
  await page.evaluate(() => window.updateTestPreferences({ visibleMessageCount: 20 }));
  await page.waitForFunction(() => document.querySelectorAll('.chat-message').length === 20);
  assert.equal(await page.locator('.chat-message').first().getAttribute('data-message-id'), 'history-180');
  await page.getByRole('textbox', { name: '对话输入' }).fill('隐藏的历史仍需读取');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.waitForFunction(() => window.savedCharacters.at(-1)?.sessions[0].messages.length === 202);
  const requestText = await page.evaluate(() => window.testRequests[0].messages.map(m=>m.content).join('\n'));
  for (const m of messages) assert.ok(requestText.includes(m.content), `Hidden message ${m.id} must reach model`);
  assert.equal(await page.locator('.chat-message').count(), 20);
  // Fixture reload restores the original 200 messages, while the preference persists.
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.chat-message').length === 20);
  await page.getByRole('button', { name: '加载更早的消息 · 还有 180 条' }).click();
  assert.equal(await page.locator('.chat-message').count(), 60);
  await page.getByRole('button', { name: '收起较早消息 · 仅显示最近 20 条' }).click();
  assert.equal(await page.locator('.chat-message').count(), 20);
  await page.evaluate(() => window.updateTestPreferences({ visibleMessageCount: 80 }));
  await page.waitForFunction(() => document.querySelectorAll('.chat-message').length === 80);
  assert.equal(
    await page.locator('.chat-message').first().getAttribute('data-message-id'),
    'history-120',
  );
  await page.locator('.chat-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(650);
  const oldY = (await page.locator('[data-message-id="history-120"]').boundingBox()).y;
  await page.getByRole('button', { name: '加载更早的消息 · 还有 120 条' }).click();
  assert.equal(await page.locator('.chat-message').count(), 120);
  await page.waitForTimeout(650);
  const newY = (await page.locator('[data-message-id="history-120"]').boundingBox()).y;
  console.log('HISTORY anchor delta:',newY-oldY);
  assert.ok(Math.abs(oldY - newY) < 3, 'Loading earlier messages must preserve reading anchor');
  await page.getByRole('button', { name: '编辑消息 191', exact: true }).click();
  await page.getByRole('textbox', { name: '编辑消息内容' }).fill('历史编辑：必须创建独立分支');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.waitForFunction(() => window.savedCharacters.at(-1)?.sessions.length === 2);
  const saved = await page.evaluate(() => window.savedCharacters.at(-1));
  assert.equal(saved.sessions.find((s) => s.id === 'long').messages.length, 200);
  assert.equal(
    saved.sessions.find((s) => s.id === 'long').messages[190].content,
    messages[190].content,
  );
  assert.equal(saved.sessions[0].messages.length, 191);
  assert.equal(saved.sessions[0].messages[190].content, '历史编辑：必须创建独立分支');
  // A failed disk save is visible and retryable, without duplicate AI replies.
  await page.evaluate(() => (window.failNextSave = true));
  await page.getByRole('button', { name: '从消息 191 创建分支', exact: true }).click();
  await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await page.waitForFunction(() => window.savedCharacters.at(-1)?.sessions.length === 3);
  await page.getByRole('textbox', { name: '对话输入' }).fill('保存恢复后继续');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.savedCharacters.at(-1)?.sessions[0].messages.at(-1)?.content === '真实链路测试回复',
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.savedCharacters
          .at(-1)
          .sessions[0].messages.filter((m) => m.content === '真实链路测试回复').length,
    ),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    'HISTORY PASS: configurable display count and reload, ALL hidden history reaches model, collapse/load-more scroll anchor, historical isolation, failed-save retry, no duplicate generation.',
  );
} finally {
  await browser.close();
  await server.close();
}
