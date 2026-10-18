import { createServer } from 'vite';
import { createRequire } from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));const require=createRequire(import.meta.url);
const {chromium}=require(join(process.env.PLAYWRIGHT_MODULE_DIR,'playwright'));
if(!process.env.COMFYSILLY_TEST_CARD)throw new Error('Set COMFYSILLY_TEST_CARD');
const server=await createServer({root,server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}});const errors=[];const failures=[];const logs=[];page.on('console',m=>{if(/updateByPath|writeUser|失败|路径|错误|updateEraVariable/.test(m.text()))logs.push(m.text().slice(0,800));});
 page.on('pageerror',e=>errors.push(String(e).slice(0,800)));page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()?.errorText}));page.on('response',r=>{if(r.status()>=400)failures.push({url:r.url(),status:r.status()});});
 const original=JSON.parse(readFileSync(process.env.COMFYSILLY_TEST_CARD,'utf8'));const card={...original,sessions:[],activeSessionId:undefined,avatar_b64:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'};
 await page.route('**/__test__/card.json',r=>r.fulfill({json:card}));
 await page.goto(server.resolvedUrls.local[0]+'tests/chat-harness.html?generation=1');
 await page.getByRole('button',{name:'信任此卡并启用交互前端'}).click();
 // Let actual imported scripts and remote modules initialize; no synthetic ERA events.
 await page.waitForTimeout(20000);
 const front=page.frameLocator('iframe[title="角色卡交互前端"]');
 await front.getByRole('button',{name:'将角色设置写入变量',exact:true}).waitFor();
 await front.locator('input').first().fill('ComfySilly兼容测试玩家');
 await front.getByRole('button',{name:'将角色设置写入变量',exact:true}).click();
 let variableWriteVerified=false;try{await page.waitForFunction(()=>window.savedCharacters.some(c=>JSON.stringify(c.sessions.map(s=>s.runtimeVariables)).includes('ComfySilly兼容测试玩家')),{},{timeout:15000});variableWriteVerified=true;}catch{}
 await page.waitForTimeout(2000);
 if(variableWriteVerified){const latest=await page.evaluate(()=>window.savedCharacters.at(-1)?.sessions[0].runtimeVariables?.chat?.stat_data?.user?.姓名);if(latest!=='ComfySilly兼容测试玩家')throw new Error('Saved variable was overwritten');}
 const frames=[];for(const frame of page.frames().slice(1)){try{frames.push({url:frame.url().slice(0,100),buttons:await frame.locator('button').count(),text:(await frame.locator('body').innerText()).slice(0,1800)});}catch(error){frames.push({error:String(error)});}}
 const host=(await page.locator('body').innerText()).slice(-6000);
 await front.getByRole('button',{name:'开始幻想乡故事（请注意保存你的修改）',exact:true}).click();
 await page.waitForFunction(()=>window.testRequests?.some(r=>r.messages.some(m=>m.content.includes('GENERATE_STORY_SCENE'))),{},{timeout:20000});
 await page.waitForFunction(()=>window.savedCharacters.some(c=>c.sessions.some(s=>s.messages.some(m=>m.role==='assistant'&&m.content==='真实链路测试回复'))),{},{timeout:10000});
 await page.waitForTimeout(2500);
 const latestMessages=await page.evaluate(()=>window.savedCharacters.at(-1)?.sessions[0].messages.map(m=>({role:m.role,hasTestReply:m.content.includes('真实链路测试回复')})));console.log("LATEST STORY",latestMessages);
 if(!latestMessages.some(m=>m.role==='assistant'&&m.hasTestReply))throw new Error('Story reply overwritten');
 const storyButtonVerified=true;
 const report={variableWriteVerified,storyButtonVerified,errors,failures:failures.slice(0,30),frames,host};
 mkdirSync(join(root,'.test-results'),{recursive:true});writeFileSync(join(root,'.test-results','era-runtime-report.json'),JSON.stringify(report,null,2));await page.screenshot({path:join(root,'.test-results','era-runtime.png'),fullPage:true});
 console.log(JSON.stringify(report,null,2));if(!variableWriteVerified)throw new Error("ERA variable write not verified");
}finally{await browser.close();await server.close();}

