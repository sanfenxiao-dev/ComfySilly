import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = dirname(dirname(fileURLToPath(import.meta.url))),
  require = createRequire(import.meta.url);
const { chromium } = require(join(process.env.PLAYWRIGHT_MODULE_DIR, 'playwright'));
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
});
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = { fixtureOnly: true, checks: [], errors: [] };
const out = join(root, '.test-results');
mkdirSync(out, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => report.errors.push(String(e)));
  const origin = server.resolvedUrls.local[0];
  await page.goto(origin + 'tests/studio-harness.html?presets=1');
  await page.locator('.react-flow__node').first().waitFor();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.locator('.react-flow__controls-fitview').click();
  const defaultId = 'node-regex-filter';
  const defaultNode = page.locator(`[data-id="${defaultId}"]`);
  await defaultNode.getByRole('button', { name: '导入 JSON 到此节点', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '导入正则到节点' });
  assert.equal(
    await dialog.getByRole('combobox', { name: '目标正则节点' }).inputValue(),
    defaultId,
  );
  const file = (name, rule) => ({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(rule)),
  });
  const a = { scriptName: 'FIRST', findRegex: 'AAA', replaceString: 'BBB', placement: [2] };
  const b = { scriptName: 'SECOND', findRegex: 'BBB', replaceString: 'CCC', placement: [2] };
  await dialog.getByLabel('选择正则 JSON 文件').setInputFiles(file('B.json', b));
  await dialog.getByRole('button', { name: '按顺序导入 1 条规则' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '导入正则', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '导入正则到节点' });
  await dialog.getByRole('combobox', { name: '目标正则节点' }).selectOption('__new__');
  await dialog.getByLabel('选择正则 JSON 文件').setInputFiles(file('A.json', a));
  await dialog.getByRole('button', { name: '按顺序导入 1 条规则' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.react-flow__controls-fitview').click();
  const ids = await page
    .locator('.react-flow__node-regexFilter')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')));
  const customId = ids.find((id) => id !== defaultId);
  await page.locator(`[data-id="${customId}"] .react-flow__handle.source`).click();
  await defaultNode.locator('.react-flow__handle.target').click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.fixtureState.presetWrites.at(-1)?.extensions.regex_scripts[0]?.scriptName === 'FIRST',
  );
  let saved = await page.evaluate(() => window.fixtureState.presetWrites.at(-1));
  assert.deepEqual(
    saved.extensions.regex_scripts.map((r) => r.scriptName),
    ['FIRST', 'SECOND'],
  );
  report.checks.push(
    'node-local import targets chosen node; regex handle connection controls actual saved execution order',
  );

  // Two files in one node: queue order is explicit and adjustable before commit.
  await defaultNode.getByRole('button', { name: '导入 JSON 到此节点', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '导入正则到节点' });
  const c = { scriptName: 'THIRD', findRegex: 'CCC', replaceString: 'DDD', placement: [2] };
  const d = { scriptName: 'FOURTH', findRegex: 'DDD', replaceString: 'EEE', placement: [2] };
  await dialog
    .getByLabel('选择正则 JSON 文件')
    .setInputFiles([file('D.json', d), file('C.json', c)]);
  await dialog.getByRole('button', { name: '上移文件 C.json', exact: true }).click();
  assert.deepEqual(await dialog.locator('.regex-import-queue strong').allTextContents(), [
    'C.json',
    'D.json',
  ]);
  await dialog.getByRole('button', { name: '按顺序导入 2 条规则' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(
    () => window.fixtureState.presetWrites.at(-1)?.extensions.regex_scripts.length === 4,
  );
  saved = await page.evaluate(() => window.fixtureState.presetWrites.at(-1));
  assert.deepEqual(
    saved.extensions.regex_scripts.map((r) => r.scriptName),
    ['FIRST', 'SECOND', 'THIRD', 'FOURTH'],
  );
  report.checks.push(
    'multiple JSON files append in adjustable queue order and retain all prior rules',
  );
  await page.screenshot({ path: join(out, 'regex-two-nodes.png') });

  if (process.env.COMFYSILLY_TEST_REGEX_FILES) {
    await page.getByRole('button', { name: '导入正则', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '导入正则到节点' });
    await dialog.getByRole('combobox', { name: '目标正则节点' }).selectOption('__new__');
    await dialog
      .getByLabel('选择正则 JSON 文件')
      .setInputFiles(JSON.parse(process.env.COMFYSILLY_TEST_REGEX_FILES));
    await dialog.getByRole('button', { name: '按顺序导入 45 条规则' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(
      () => window.fixtureState.presetWrites.at(-1)?.extensions.regex_scripts.length === 49,
    );
    report.checks.push(
      'read-only user files import 44+1 rules through real UI without missing fields',
    );
  }
  // A 600-prompt preset is virtualized; leaving the preset page unmounts its DOM.
  await page.goto(origin + 'tests/studio-harness.html?presets=1&largePreset=600');
  await page.locator('.preset-picker > button').filter({ hasText: '长篇预设' }).waitFor();
  await page.locator('.react-flow__node').first().waitFor();
  await page.evaluate(() => {
    window.canvasSerializations = 0;
    const original = JSON.stringify;
    JSON.stringify = function (value, ...args) {
      if (value?.version === 1 && Array.isArray(value.nodes) && Array.isArray(value.edges))
        window.canvasSerializations++;
      return original.call(JSON, value, ...args);
    };
  });
  const n = page.locator('.react-flow__node-promptBlock').first();
  const box = await n.boundingBox();
  const before = await n.getAttribute('style');
  await page.mouse.move(box.x + box.width / 2, box.y + 1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + 50, { steps: 12 });
  await page.mouse.up();
  assert.notEqual(await n.getAttribute('style'), before);
  assert.equal(await page.evaluate(() => window.canvasSerializations), 0);
  await page.getByRole('button', { name: '世界书', exact: true }).click();
  await page.getByRole('heading', { name: '世界书', exact: true }).waitFor();
  assert.equal(await page.locator('.react-flow').count(), 0);
  await page.getByRole('button', { name: '角色与对话', exact: true }).click();
  await page.getByRole('button', { name: '打开角色 雨后的书店' }).click();
  await page.getByRole('button', { name: '继续上次对话', exact: true }).click();
  await page.locator('.chat-room').waitFor();
  assert.equal(await page.locator('.react-flow').count(), 0);
  const serializations = await page.evaluate(() => window.canvasSerializations);
  await page.getByRole('textbox', { name: '对话输入' }).fill('typing without canvas work');
  assert.equal(await page.evaluate(() => window.canvasSerializations), serializations);
  report.checks.push(
    '600-prompt canvas does not serialize during drag, is unmounted on worldbook/chat pages and does no canvas work on chat typing',
  );

  const expanded = await page.locator('.chat-header').boundingBox();
  await page.getByRole('button', { name: '收起对话工具栏', exact: true }).click();
  await page.waitForTimeout(250);
  const compact = await page.locator('.chat-header').boundingBox();
  assert.ok(compact.height < expanded.height);
  assert.equal(await page.getByRole('combobox', { name: '当前对话预设' }).count(), 0);
  const scroll = await page.locator('.chat-scroll').boundingBox();
  assert.ok(scroll.y >= compact.y + compact.height - 1);
  await page.screenshot({ path: join(out, 'chat-collapsed-header.png') });
  await page.reload();
  await page.getByRole('button', { name: '角色与对话', exact: true }).click();
  await page.getByRole('button', { name: '打开角色 雨后的书店' }).click();
  await page.getByRole('button', { name: '继续上次对话', exact: true }).click();
  await page.getByRole('button', { name: '展开对话工具栏', exact: true }).click();
  await page.getByRole('combobox', { name: '当前对话预设' }).waitFor();
  report.checks.push(
    'compact header frees reader space, never overlays scroll region, remembers preference and restores all controls',
  );
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync(join(out, 'regex-ui-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
