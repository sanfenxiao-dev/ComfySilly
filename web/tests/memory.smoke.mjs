/** IPC fixture tests: no user cards, real keys, external network or paid API calls. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
const require=createRequire(import.meta.url), root=dirname(dirname(fileURLToPath(import.meta.url)));
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_DIR ? join(process.env.PLAYWRIGHT_MODULE_DIR,'playwright') : 'playwright');
const server=await createServer({root,server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
let card={id:'memory-card-A',name:'记忆角色',first_mes:'新对话的独立开场',avatar_b64:'',extensions:{},
  sessions:[{id:'old-chat',title:'长历史',updatedAt:'2026-10-18',messages:Array.from({length:24},(_,i)=>({
    id:'m-'+i,role:i%2?'assistant':'user',timestamp:'2026-10-18',content:(i===0?'唯一事实：用户是八千慧的丈夫。':'本对话的第'+i+'条剧情。')+'剧情'.repeat(300),
  }))}],activeSessionId:'old-chat'};
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/__test__/memory-card.json')return route.fulfill({json:card});
    if(url.hostname!=='127.0.0.1')return route.abort();
    return route.continue();
  });
  await page.goto(server.resolvedUrls.local[0]+'tests/memory-harness.html');
  await page.waitForFunction(()=>window.savedCharacters.at(-1)?.sessions.find(s=>s.id==='old-chat')?.memory?.checkpoints.at(-1).cursor.completed===24,{},{timeout:20000});
  const requests=await page.evaluate(()=>window.requests.filter(r=>r.purpose==='memory'));
  assert.ok(requests.length>=4,'Long legacy history must be sequentially caught up');
  const ids=new Set(requests.flatMap(r=>JSON.parse(r.messages[1].content).newMessages.map(m=>m.id)));
  assert.equal(ids.size,24,'Do not skip the middle');
  assert.ok(requests.every(r=>r.providerId==='mem'));
  await page.getByRole('button',{name:'对话记忆',exact:true}).click();
  await page.getByRole('heading',{name:'剧情摘要',exact:true}).waitFor();
  await page.getByRole('button',{name:'来源 #1',exact:true}).click();
  await page.getByRole('heading',{name:'记忆来源消息'}).waitFor();
  await page.getByRole('dialog').last().getByRole('button',{name:'关闭弹窗'}).click();
  await page.getByRole('dialog').first().getByRole('button',{name:'关闭弹窗'}).click();
  await page.getByRole('textbox',{name:'对话输入'}).fill('请继续，不要忘记身份');
  await page.getByRole('button',{name:'发送消息'}).click();
  await page.waitForFunction(()=>window.requests.some(r=>!r.purpose));
  const chat=await page.evaluate(()=>window.requests.find(r=>!r.purpose));
  assert.equal(chat.providerId,'chat');
  assert.match(chat.messages.map(m=>m.content).join('\n'),/用户是八千慧的丈夫/);
  assert.ok(chat.messages.length<15,'Old raw transcript is replaced only after covered');
  await page.waitForFunction(()=>window.savedCharacters.at(-1).sessions.find(s=>s.id==='old-chat').memory.checkpoints.at(-1).cursor.completed===26);
  // Reload saved data: actual serialized memory must be used with no reimport.
  card=await page.evaluate(()=>window.savedCharacters.at(-1));
  await page.reload();
  await page.getByRole('button',{name:'对话记忆',exact:true}).click();
  await page.getByText(/已整理 26 \/ 26/).waitFor();
  await page.getByRole('button',{name:'暂停本对话记忆'}).click();
  await page.getByText('本对话已暂停自动记忆',{exact:true}).waitFor();
  await page.getByRole('dialog').first().getByRole('button',{name:'关闭弹窗'}).click();
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await page.waitForFunction(()=>window.savedCharacters.at(-1)?.sessions[0]?.memory?.checkpoints.length>0);
  const fresh=await page.evaluate(()=>window.savedCharacters.at(-1).sessions[0]);
  assert.notEqual(fresh.id,'old-chat');
  assert.doesNotMatch(JSON.stringify(fresh.memory),/八千慧/,'Different conversations must have empty initial memory');
  assert.equal(fresh.memory.sessionId,fresh.id);
  // Invalid model output cannot silently overwrite valid memory / advance coverage.
  await page.evaluate(()=>{window.invalidMemory=true;});
  await page.getByRole('button',{name:'对话记忆',exact:true}).click();
  await page.getByRole('button',{name:'清空并重新整理',exact:true}).click();
  await page.getByRole('button',{name:'清空记忆',exact:true}).click();
  await page.getByText(/整理失败，原记录保留/).waitFor({timeout:10000});
  assert.equal(await page.evaluate(()=>window.savedCharacters.at(-1).sessions[0].memory),undefined);
  await page.evaluate(()=>{window.invalidMemory=false;});
  await page.getByRole('button',{name:'重试整理',exact:true}).click();
  await page.waitForFunction(()=>window.savedCharacters.at(-1).sessions[0].memory?.checkpoints.length>0);
  // Foreground send cancels background. A slow late response must not replace newer state.
  await page.evaluate(()=>{window.memoryDelay=2200;});
  await page.getByRole('button',{name:'清空并重新整理',exact:true}).click();
  await page.getByRole('button',{name:'清空记忆',exact:true}).click();
  await page.getByText(/后台整理中/).waitFor();
  await page.getByRole('dialog').first().getByRole('button',{name:'关闭弹窗'}).click();
  await page.getByRole('textbox',{name:'对话输入'}).fill('优先处理这个新问题');
  await page.getByRole('button',{name:'发送消息'}).click();
  await page.waitForFunction(()=>window.cancelled.length>0);
  await page.waitForFunction(()=>window.savedCharacters.at(-1).sessions[0].messages.length===3);
  await page.waitForFunction(()=>window.savedCharacters.at(-1).sessions[0].memory?.checkpoints.at(-1).cursor.completed===3,{},{timeout:12000});
  await page.getByRole('button',{name:'对话记忆',exact:true}).click();
  await page.getByRole('button',{name:'修正记忆',exact:true}).click();
  await page.getByRole('textbox',{name:'剧情摘要',exact:true}).fill('手动修正：用户与角色已约好明天见面。');
  await page.getByRole('button',{name:'保存修正',exact:true}).click();
  await page.waitForFunction(()=>window.savedCharacters.at(-1).sessions[0].memory?.checkpoints.at(-1).summary.startsWith('手动修正'));
  await page.getByRole('dialog').first().getByRole('button',{name:'关闭弹窗'}).click();
  // Settings UI lives in its own category; changing it does not touch chat provider.
  await page.getByRole('button',{name:'测试打开设置'}).click();
  const settingsDialog=page.getByRole('dialog').last();
  await settingsDialog.getByRole('switch',{name:'启用自动记忆'}).waitFor();
  await settingsDialog.getByRole('switch',{name:'启用自动记忆'}).click();
  await settingsDialog.getByRole('button',{name:'保存设置'}).click();
  await page.waitForFunction(()=>window.fixtureSettings.memory.enabled===false);
  assert.equal(await page.evaluate(()=>window.fixtureSettings.activeProviderId),'chat');
  assert.deepEqual(errors,[]);
  mkdirSync(join(root,'.test-results'),{recursive:true});
  await page.getByRole('button',{name:'对话记忆',exact:true}).click();
  await page.getByRole('heading',{name:'对话记忆',exact:true}).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({path:join(root,'.test-results','automatic-memory.png'),fullPage:true});
  console.log('MEMORY UI PASS: automatic sequential catch-up, isolation, prompt injection, reload, pause, invalid JSON, retry, foreground cancellation, manual corrections, categorized settings; page errors=0. Fixture IPC only.');
} finally {await browser.close();await server.close();}
