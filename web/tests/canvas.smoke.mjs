import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
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
  await page.goto(server.resolvedUrls.local[0] + 'tests/studio-harness.html?presets=1');
  await page.locator('.react-flow__node').first().waitFor();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const pane = page.locator('.react-flow__pane');
  await pane.click({ button: 'right', position: { x: 450, y: 270 } });
  await page.getByRole('button', { name: /提示词块 \(Prompt Block\)/ }).click();
  const custom = page.locator('.react-flow__node').filter({ hasText: '自定义提示词块' });
  await custom.waitFor();
  const id = await custom.getAttribute('data-id');
  const count = await page.locator('.react-flow__node').count();
  const requestDelete = async () => {
    await custom
      .locator('div')
      .first()
      .click({ button: 'right', position: { x: 120, y: 20 } });
    await page.getByRole('menuitem', { name: '删除此节点', exact: true }).click();
    await page.getByRole('dialog', { name: '删除画布节点或连线？' }).waitFor();
  };
  await requestDelete();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await custom.count(), 1);
  await requestDelete();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await custom.waitFor({ state: 'detached' });
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('aside').getByText('自定义提示词块', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '撤销画布删除', exact: true }).click();
  await custom.waitFor();
  assert.equal(await page.locator('.react-flow__node').count(), count);
  report.checks.push('create, context menu delete, cancel, sidebar synchronization and undo');

  // Keyboard editing must never delete the containing node.
  const textarea = custom.locator('textarea').first();
  await textarea.fill('abc');
  await textarea.press('Home');
  await textarea.press('Delete');
  assert.equal(await textarea.inputValue(), 'bc');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await custom.click({ position: { x: 160, y: 20 } });
  await page.keyboard.press('Delete');
  await page.getByRole('dialog', { name: '删除画布节点或连线？' }).waitFor();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await custom.waitFor({ state: 'detached' });
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => window.fixtureState.presetWrites.length > 0);
  const saved = await page.evaluate(() => window.fixtureState.presetWrites.at(-1));
  assert.ok(!saved.prompts.some((p) => 'prompt-' + p.identifier === id));
  assert.ok(!saved.extensions.comfysilly_canvas.nodes.some((n) => n.id === id));
  assert.ok(
    !saved.extensions.comfysilly_canvas.edges.some((e) => e.source === id || e.target === id),
  );
  report.checks.push(
    'Delete key, text input protection, saved prompts/nodes/edges contain no deleted node',
  );

  // Reload the saved library entry, then delete a non-prompt node with incident edges.
  const currentName = (await page.locator('.preset-picker > button').textContent()).trim();
  const reloadPreset = async () => {
    await page.locator('.preset-picker > button').click();
    await page.locator('.popover-select').filter({ hasText: '轻量预设' }).click();
    await page.locator('.preset-picker > button').click();
    await page.locator('.popover-select').filter({ hasText: currentName }).click();
  };
  await reloadPreset();
  assert.equal(await page.locator(`[data-id="${id}"]`).count(), 0);
  report.checks.push(
    'deleted custom prompt stays deleted after switching away and reloading preset',
  );

  // Offscreen nodes are virtualized; fit the canvas before choosing a built-in.
  await page.locator('.react-flow__controls-fitview').click();
  const history = page.locator('.react-flow__node-historySampler').first();
  await history.waitFor();
  const historyId = await history.getAttribute('data-id');
  await history.click({ button: 'right', position: { x: 90, y: 20 } });
  await page.getByRole('menuitem', { name: '删除此节点' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(
    (id) =>
      !window.fixtureState.presetWrites
        .at(-1)
        .extensions.comfysilly_canvas.nodes.some((n) => n.id === id),
    historyId,
  );
  const last = await page.evaluate(() => window.fixtureState.presetWrites.at(-1));
  assert.ok(
    !last.extensions.comfysilly_canvas.edges.some(
      (e) => e.source === historyId || e.target === historyId,
    ),
  );
  await reloadPreset();
  await page.locator('.react-flow__controls-fitview').click();
  assert.equal(await page.locator(`[data-id="${historyId}"]`).count(), 0);
  report.checks.push('built-in deletion removes incident edges and survives preset reload');

  // A failed disk write must not be presented as a successful save.
  await page.evaluate(() => (window.failPresetSave = true));
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page
    .getByText(/保存失败，修改仍在界面中/)
    .first()
    .waitFor();
  report.checks.push('save failure is surfaced instead of falsely reporting persistence');
  await page.evaluate(() => (window.failPresetSave = false));

  // Toolbar deletion handles a multi-selection without touching other nodes.
  await page
    .locator('.react-flow__node-assembler')
    .first()
    .click({ position: { x: 50, y: 10 } });
  await page.keyboard.down('Control');
  await page
    .locator('.react-flow__node-lorebook')
    .first()
    .click({ position: { x: 50, y: 10 } });
  await page.keyboard.up('Control');
  assert.equal(await page.locator('.react-flow__node.selected').count(), 2);
  await page.getByRole('button', { name: '删除选中节点/连线', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.react-flow__node-assembler').count(), 0);
  assert.equal(await page.locator('.react-flow__node-lorebook').count(), 0);
  await page.getByRole('button', { name: '撤销画布删除', exact: true }).click();
  await page.locator('.react-flow__node-assembler').waitFor();
  await page.locator('.react-flow__node-lorebook').waitFor();
  report.checks.push('Ctrl multi-selection, toolbar deletion and multi-node undo');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page
    .getByText(/已持久化保存/)
    .first()
    .waitFor();
  await page.screenshot({ path: join(out, 'canvas-delete.png') });
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync(join(out, 'canvas-delete-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
