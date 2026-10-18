/** UI smoke tests. Uses Edge headlessly and never writes imported character files. */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_DIR ? join(process.env.PLAYWRIGHT_MODULE_DIR, 'playwright') : 'playwright');
const server = await createServer({ root, server:{ host:'127.0.0.1',port:0,hmr:false,watch:null } });
await server.listen();
const browser = await chromium.launch({ channel:'msedge', headless:true });
try {
  const page = await browser.newPage({ viewport:{width:1400,height:900} });
  let card = process.env.COMFYSILLY_TEST_CARD ? JSON.parse(readFileSync(process.env.COMFYSILLY_TEST_CARD,'utf8')) : {
    id:'test',name:'测试角色',first_mes:'```\n<body><script>$("body").load("https://example.invalid/start.html")</script></body>\n```',
    extensions:{tavern_helper:[['scripts',[{name:'后台',content:'test',enabled:true}]]]},
  };
  card = {...card, sessions:[], activeSessionId:undefined, avatar_b64:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="%237c3aed"/%3E%3C/svg%3E'};
  const errors = [];
  page.on('pageerror',error=>errors.push(String(error)));
  const externalRequests = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__test__/card.json') return route.fulfill({json:card});
    if (url.hostname !== '127.0.0.1') { externalRequests.push(url.toString()); return route.abort(); }
    return route.continue();
  });
  const origin = server.resolvedUrls.local[0];
  await page.goto(origin+'tests/chat-harness.html');
  await page.getByText('检测到角色卡交互前端 · 尚未授权执行').waitFor();
  assert.equal(await page.locator('iframe').count(),0,'Do not create an empty loader frame');
  await page.getByText(/外部依赖 \(/).click();
  await page.getByText('https://onmm.top/2.0.4/Starter/index.html', {exact:true}).or(page.getByText('https://example.invalid/start.html',{exact:true})).waitFor();
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await page.waitForFunction(()=>window.savedCharacters.length===2);
  let saved = await page.evaluate(()=>window.savedCharacters.at(-1));
  assert.equal(saved.sessions[0].id,saved.activeSessionId,'New active ID must be persisted');
  assert.equal(saved.sessions.length,2);
  await page.getByRole('textbox',{name:'对话输入'}).fill('测试消息，不能伪造 AI 回复');
  await page.getByRole('textbox',{name:'对话输入'}).press('Enter');
  await page.waitForFunction(()=>window.savedCharacters.length===3);
  saved = await page.evaluate(()=>window.savedCharacters.at(-1));
  assert.equal(saved.sessions[0].messages.length,2);
  assert.equal(saved.sessions[0].messages[1].role,'user');
  await page.locator('.session-title').click();
  await page.locator('.session-select').filter({hasText:'初始开局'}).click();
  await page.waitForFunction(()=>window.savedCharacters.length===4);
  saved = await page.evaluate(()=>window.savedCharacters.at(-1));
  assert.equal(saved.activeSessionId,saved.sessions[1].id,'Switch must save selected history');
  // History stays open after selection; delete the original, now active, timeline.
  await page.getByTitle('删除此对话分支').nth(1).click();
  await page.getByRole('button',{name:'删除对话',exact:true}).click();
  await page.waitForFunction(()=>window.savedCharacters.length===5);
  saved = await page.evaluate(()=>window.savedCharacters.at(-1));
  assert.equal(saved.activeSessionId,saved.sessions[0].id,'Deleting active history must select an existing session');
  assert.equal(saved.sessions.length,1);
  await page.getByRole('button',{name:'收起历史',exact:true}).click();
  const output = join(root,'.test-results'); mkdirSync(output,{recursive:true});
  await page.screenshot({path:join(output,'era-chat-diagnostic.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  assert.deepEqual(externalRequests,[],'Must not execute remote card loaders');

  card = {...card,id:'static',name:'静态预览测试',first_mes:'```html\n<div><h1>静态卡片内容</h1><style>h1{color:purple}</style></div>\n```',extensions:{}};
  await page.reload();
  await page.getByRole('button',{name:'打开静态预览（不含交互）'}).click();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('heading',{name:'静态卡片内容'}).waitFor();
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'');
  await page.screenshot({path:join(output,'static-preview.png'),fullPage:true});
  // Actually execute a bundled opaque-origin runtime and a separate background frame.
  card = {...card,id:'interactive',name:'交互测试',extensions:{tavern_helper:{scripts:[{id:'worker',name:'测试后台',enabled:true,content:"eventOn('test:ping', async value => { await eventEmit('test:pong', value + 1); });"}]}},first_mes:'```html\n<div><button id="go">交互测试按钮</button><output id="out">等待点击</output></div><script>window.bootId=crypto.randomUUID();eventOn("test:pong",v=>document.querySelector("#out").textContent="事件结果 "+v);$("#go").on("click",async()=>{updateVariablesWith(v=>({...v,count:7}),{type:"chat"});await eventEmit("test:ping",7);await triggerSlash("/send 来自卡片的输入 | /trigger").catch(error=>window.expectedGenerationError=String(error));});</script>\n```'};
  await page.reload();
  console.log('UI: enabling isolated runtime');
  page.on('console', message => { if(message.type() === 'error') console.log('BROWSER:',message.text().slice(0,400)); });
  await page.getByRole('button',{name:'信任此卡并启用交互前端'}).click();
  const interactive=page.frameLocator('iframe[title="角色卡交互前端"]');
  await interactive.getByRole('button',{name:'交互测试按钮'}).waitFor();
  console.log('UI: real button rendered');
  // Wait for the genuine test background handler, not an injected fake event.
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===2);
  await page.waitForTimeout(200);
  const boot=await interactive.locator('body').evaluate(()=>window.bootId);
  await interactive.getByRole('button',{name:'交互测试按钮'}).click();
  try { await interactive.getByText('事件结果 8',{exact:true}).waitFor({timeout:5000}); }
  catch(error) { console.log('RUNTIME PARENT:',(await page.locator('body').innerText()).slice(-4000));console.log('RUNTIME ERRORS:',errors);await page.screenshot({path:join(output,'runtime-failure.png'),fullPage:true});throw error; }
  await page.waitForFunction(()=>window.savedCharacters.some(c=>c.sessions.some(s=>s.messages.some(m=>m.content==='来自卡片的输入'))));
  const records=await page.evaluate(()=>window.savedCharacters);
  assert.ok(records.some(c=>c.sessions.some(s=>s.runtimeVariables?.chat?.count===7)),'Scoped card variables must persist');
  assert.equal(await interactive.locator('body').evaluate(()=>window.bootId),boot,'Height/variable changes must not reload the iframe');
  assert.equal(await page.locator('iframe[title="角色卡交互前端"]').getAttribute('sandbox'),'allow-scripts allow-modals');
  assert.equal(await interactive.locator('body').evaluate(()=>{try{return !!window.parent.document;}catch{return false;}}),false,'Untrusted frame must not access parent DOM');
  assert.equal(await interactive.locator('body').evaluate(()=>typeof window.__TAURI_INTERNALS__),'undefined','No native IPC in card frames');
  await page.screenshot({path:join(output,'interactive-runtime.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  // Exercise the UI-side stream lifecycle against an explicit IPC fixture.
  await page.goto(origin+'tests/chat-harness.html?generation=1');
  await page.getByRole('textbox',{name:'对话输入'}).fill('请记住：来自用户的上下文');
  await page.getByRole('button',{name:'发送消息'}).click();
  await page.getByText('真实链路测试回复',{exact:true}).first().waitFor();
  await page.waitForFunction(()=>window.savedCharacters.some(c=>c.sessions.some(s=>s.messages.at(-1)?.content==='真实链路测试回复')));
  const requests=await page.evaluate(()=>window.testRequests);
  assert.equal(requests.length,1);
  assert.ok(requests[0].messages.some(m=>m.content==='请记住：来自用户的上下文'));
  assert.equal(requests[0].providerId,'test-provider');
  assert.equal(requests[0].apiKey,undefined);
  await page.getByRole('button',{name:'信任此卡并启用交互前端'}).click();
  await page.frameLocator('iframe[title="角色卡交互前端"]').getByRole('button',{name:'交互测试按钮'}).waitFor();
  assert.equal((await page.locator('iframe[title="角色卡交互前端"]').getAttribute('srcdoc')).includes('TEST_ONLY_KEY_NOT_FOR_CARDS'),false);
  await page.screenshot({path:join(output,'streaming-chat.png'),fullPage:true});
  console.log('UI PASS: session persistence, static preview, real iframe clicks, background cross-frame events, scoped variable persistence, Slash send, no frame reload, opaque-origin/native-IPC isolation.');

} finally { await browser.close(); await server.close(); }
