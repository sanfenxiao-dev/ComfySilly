import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = dirname(dirname(fileURLToPath(import.meta.url))),
  require = createRequire(import.meta.url);
const { chromium } = require(join(process.env.PLAYWRIGHT_MODULE_DIR, 'playwright'));
const output = join(root, '.test-results');
mkdirSync(output, { recursive: true });
const server = await createServer({ root, server: { host:'127.0.0.1',port:0,hmr:false,watch:null } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = { fixtureOnly: true, checks: [], screenshots: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => report.errors.push(String(e)));
  await page.goto(server.resolvedUrls.local[0] + 'tests/studio-harness.html');
  const shot = async (name) => {
    await page.waitForTimeout(500);
    const file = join(output, `studio-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    report.screenshots.push(file);
  };
  await shot('preset');
  await page.getByRole('button', { name: '角色与对话', exact: true }).click();
  await page.getByRole('heading', { name: '角色书架', exact: true }).waitFor();
  await page.getByRole('button', { name: '打开角色 雨后的书店' }).waitFor();
  await shot('shelf');
  assert.equal(await page.locator('.book-card').count(), 5);
  await page.getByRole('textbox', { name: '搜索角色' }).fill('山海');
  assert.equal(await page.locator('.book-card').count(), 1);
  await page.getByRole('textbox', { name: '搜索角色' }).fill('');
  report.checks.push('searchable animated bookshelf');
  await page.getByRole('button', { name: '世界书', exact: true }).click();
  await page.getByRole('heading', { name: '世界书', exact: true }).waitFor();
  await shot('worldbooks');
  const toggle = page.getByRole('switch', { name: '启用 旧城纪事' });
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  await page.getByRole('button', { name: '旧城纪事', exact: true }).click();
  // Work within the editor, independent of its display title.
  let dialog = page.getByRole('dialog').first();
  assert.equal(
    await dialog.getByRole('textbox', { name: '主要关键词', exact: true }).inputValue(),
    '街区',
  );
  assert.equal(
    await dialog
      .getByRole('switch', { name: '启用条目', exact: true })
      .getAttribute('aria-checked'),
    'false',
  );
  await dialog.getByRole('switch', { name: '启用条目', exact: true }).click();
  await dialog.getByRole('button', { name: '添加条目' }).click();
  await dialog.getByRole('textbox', { name: '条目名称 / 注释' }).fill('回归测试条目');
  await dialog.getByRole('button', { name: '删除条目', exact: true }).click();
  await dialog.getByRole('button', { name: '撤销上次删除' }).click();
  await dialog.getByRole('textbox', { name: '条目名称 / 注释' }).fill('已恢复条目');
  await dialog.getByRole('textbox', { name: '世界书名称', exact: true }).fill('旧城纪事 · 修订');
  await shot('worldbook-editor');
  await dialog.getByRole('button', { name: '保存世界书', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.fixtureState.books[0].entries.length), 2);
  assert.equal(await page.locator('.lore-card').count(), 3);
  await page.getByRole('button', { name: '旧城纪事 · 修订', exact: true }).waitFor();
  report.checks.push(
    'worldbook master/entry switches, V2 keyword aliases, add/delete/undo and rename without duplicate files',
  );
  await page.getByTitle('用户身份设置').click();
  dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('textbox', { name: '名字', exact: true }).fill('小河');
  await dialog
    .getByRole('textbox', { name: '用户设定', exact: true })
    .fill('PERSONA_FIXTURE 一位穿灰色外套的旅行者。');
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.waitForTimeout(200);
  await shot('persona');
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.fixtureState.settings.personas[0].name), '小河');
  assert.ok(
    (await page.evaluate(() => window.fixtureState.settings.personas[0].avatar)).startsWith(
      'data:image/webp',
    ),
  );
  report.checks.push('top-level persona name, avatar and description persistence');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: '外观与动效', exact: true }).click();
  await dialog.getByRole('button', { name: '纸笺', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await shot('settings-light');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  report.checks.push('categorized settings, live theme preview and cancel rollback');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: '对话偏好', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: '默认显示最近消息数' }).fill('24');
  await dialog.getByRole('button', { name: '配置自动记忆与近期原文', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: '保留最近消息数' }).fill('40');
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.fixtureState.settings.preferences.visibleMessageCount), 24);
  assert.equal(await page.evaluate(() => window.fixtureState.settings.memory.recentMessages), 40);
  report.checks.push('independent saved display limit and model recent raw history window');
  await page.getByRole('button', { name: '角色与对话', exact: true }).click();
  await page.getByRole('button', { name: '打开角色 雨后的书店' }).click();
  await page.getByRole('heading', { name: '雨后的书店', exact: true }).waitFor();
  await shot('character-detail');
  await page.getByRole('button', { name: '继续上次对话', exact: true }).click();
  await page.locator('.chat-room').waitFor();
  await shot('chat-centered');
  assert.ok((await page.locator('.chat-room').getAttribute('class')).includes('layout-centered'));
  await page.getByRole('button', { name: '编辑消息 2', exact: true }).click();
  await page.getByRole('textbox', { name: '编辑消息内容' }).fill('已修改历史用户消息');
  await page.getByRole('button', { name: '保存并重新生成', exact: true }).click();
  await page.getByText('这是新的故事版本。', { exact: true }).first().waitFor();
  await page.waitForFunction(
    () =>
      window.fixtureState.characters[0].sessions.length === 2 &&
      window.fixtureState.characters[0].sessions[0].messages.at(-1)?.content ===
        '这是新的故事版本。',
  );
  let state = await page.evaluate(() => window.fixtureState.characters[0]);
  const rootSession = state.sessions.find((s) => s.id === 'fixture-session');
  assert.equal(rootSession.messages.length, 3);
  assert.equal(rootSession.messages[1].content, '路上耽误了一会儿。你上次说的那本书，找到了吗？');
  assert.equal(state.sessions[0].parentSessionId, 'fixture-session');
  const request = await page.evaluate(() => window.fixtureState.requests.at(-1));
  assert.ok(request.messages.some((m) => m.content.includes('PERSONA_FIXTURE')));
  assert.ok(request.messages.some((m) => m.content === '已修改历史用户消息'));
  assert.equal(request.apiKey, undefined);
  report.checks.push(
    'historical edit+regenerate forks without altering original; real prompt includes persona',
  );
  await page.getByRole('button', { name: '重新生成消息 3', exact: true }).click();
  await page.waitForFunction(
    () => window.fixtureState.characters[0].sessions[0].messages[2].variants?.length === 2,
  );
  await page.waitForFunction(() => !document.querySelector('.is-streaming'));
  assert.equal(await page.evaluate(() => window.fixtureState.characters[0].sessions.length), 2);
  await page.getByRole('button', { name: '消息 3 上一版本', exact: true }).click();
  await page.waitForFunction(
    () => window.fixtureState.characters[0].sessions[0].messages[2].selectedVariant === 0,
  );
  await page.getByRole('button', { name: '消息 3 下一版本', exact: true }).click();
  await page.waitForFunction(
    () => window.fixtureState.characters[0].sessions[0].messages[2].selectedVariant === 1,
  );
  report.checks.push(
    'latest reply regeneration creates reversible variants, not duplicate sessions',
  );
  await page.getByRole('button', { name: '从消息 1 创建分支', exact: true }).click();
  await page.waitForFunction(() => window.fixtureState.characters[0].sessions.length === 3);
  await page.getByRole('button', { name: '历史与分支', exact: true }).click();
  await page.locator('.session-select').filter({ hasText: '灯火初见' }).last().click();
  await page
    .locator('.session-item.is-active .session-select')
    .filter({ hasText: '灯火初见' })
    .waitFor();
  await shot('chat-branches');
  report.checks.push('fork any message and switch independent sessions');
  await page.getByTitle('重命名对话').last().click();
  let rename = page.getByRole('dialog', { name: '重命名对话', exact: true });
  await rename.getByRole('textbox').fill('原始主线 · 保留');
  await rename.getByRole('button', { name: '保存名称', exact: true }).click();
  await rename.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(
      () =>
        window.fixtureState.characters[0].sessions.find((s) => s.id === 'fixture-session').title,
    ),
    '原始主线 · 保留',
  );
  report.checks.push('rename history persistence');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: '对话偏好', exact: true }).click();
  await dialog.getByRole('button', { name: '左右气泡', exact: true }).click();
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.ok((await page.locator('.chat-room').getAttribute('class')).includes('layout-bubbles'));
  await page.getByRole('button', { name: '收起历史', exact: true }).click();
  await shot('chat-bubbles');
  report.checks.push('layout preference saved and applied to live chat');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('dialog', { name: '导出当前对话', exact: true }).waitFor();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown · 阅读与存档' }).click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith('.md'));
  report.checks.push('current-branch Markdown download');
  assert.deepEqual(report.errors, []);
  console.log('STUDIO PASS:', report.checks.join('; '));
} finally {
  writeFileSync(join(output, 'studio-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
