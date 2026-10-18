import test from 'node:test';
import assert from 'node:assert/strict';
import { generationBudget, compilePrompt } from '../src/utils/promptCompiler.ts';
import { cardTrustKey, cardIdTrustKey, readCardTrust, writeCardTrust } from '../src/utils/cardTrust.ts';
test('99999 output on 32768 context is repaired consistently without rewriting preset', () => {
 const preset={openai_max_context:32768,openai_max_tokens:99999};
 const out=compilePrompt({character:{name:'x'},preset,history:[{role:'user',content:'中'.repeat(48000)}]});
 assert.equal(out.budget.maxOutputTokens,4096);assert.equal(out.budget.inputBudget,28672);
 assert.ok(out.warnings.some(w=>w.includes('99999')));assert.equal(preset.openai_max_tokens,99999);
});

test('chat budget trims only older history and retains preset user/assistant prompts and latest turn', () => {
 const preset={openai_max_context:1024,openai_max_tokens:100,prompts:[
  {identifier:'instruction',role:'user',content:'PRESET_USER'},
  {identifier:'chatHistory',marker:true},
  {identifier:'suffix',role:'assistant',content:'PRESET_SUFFIX'},
 ]};
 const history=[{role:'user',content:'old'.repeat(600)},{role:'assistant',content:'older answer'},{role:'user',content:'latest question'},{role:'assistant',content:'latest answer'}];
 const out=compilePrompt({character:{name:'x'},preset,history,overflowPolicy:'trim-history'});
 assert.ok(out.estimatedTokens<=out.budget.inputBudget);
 for(const content of ['PRESET_USER','PRESET_SUFFIX','latest question','latest answer'])assert.ok(out.messages.some(m=>m.content===content));
 assert.ok(out.warnings.some(w=>w.includes('完整聊天记录仍保留')));
 assert.equal(history.length,4);assert.equal(history[0].content.length,1800);
 assert.throws(()=>compilePrompt({character:{name:'x'},preset,history:[{role:'user',content:'x'.repeat(5000)}],overflowPolicy:'trim-history'}),/当前输入预算/);
 assert.throws(()=>compilePrompt({character:{name:'x',description:'x'.repeat(5000)},preset,history,overflowPolicy:'trim-history'}),/当前输入预算/);
});

test('card ID grants remain bound to executable content and failed writes are reported', async () => {
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 try {
  const card={id:'sticky-card',first_mes:'original'};const key=await cardTrustKey(card);
  writeCardTrust(key,true,card.id);assert.equal(readCardTrust(key,card.id),true);
  const changed=await cardTrustKey({...card,first_mes:'new executable frontend'});
  assert.equal(readCardTrust(changed,card.id),false);
  store.set(cardIdTrustKey(card.id),'trusted');store.set(key,'trusted');
  assert.equal(readCardTrust(key,card.id),true);assert.equal(readCardTrust(changed,card.id),false);
  writeCardTrust(key,false,card.id);assert.equal(readCardTrust(key,card.id),false);
  globalThis.localStorage.setItem=()=>{throw Error('DISK_FULL');};
  assert.throws(()=>writeCardTrust(key,true,card.id),/DISK_FULL/);
 } finally {delete globalThis.localStorage;}
});
test('malformed budget stays positive; real overflow remains actionable',()=>{
 for(const preset of [{openai_max_context:-2,openai_max_tokens:NaN},{openai_max_context:1024,openai_max_tokens:999999},{openai_max_context:Infinity,openai_max_tokens:-10},{openai_max_context:1024,openai_max_tokens:0.1}]){
  const b=generationBudget(preset);assert.ok(b.inputBudget>0);assert.ok(Number.isInteger(b.maxOutputTokens));assert.ok(b.maxOutputTokens>0);
 }
 assert.throws(()=>compilePrompt({character:{name:'x'},preset:{openai_max_context:1024,openai_max_tokens:100},history:[{role:'user',content:'x'.repeat(5000)}]}),/输入预算 924 = 上下文 1024/);
});
test('trust survives reentry but is scoped to card and executable content, not runtime state',async()=>{
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const card={id:'a',first_mes:'hello',extensions:{tavern_helper:{scripts:[{content:'a'}]}}};
 const key=await cardTrustKey(card);assert.equal(readCardTrust(key),false);writeCardTrust(key,true);
 assert.equal(readCardTrust(await cardTrustKey({...card,sessions:[1]})),true);
 assert.notEqual(key,await cardTrustKey({...card,id:'b'}));
 assert.notEqual(key,await cardTrustKey({...card,first_mes:'changed'}));
 assert.notEqual(key,await cardTrustKey({...card,extensions:{...card.extensions,regex_scripts:[{replaceString:'<script/>'}]}}));
 writeCardTrust(key,false);assert.equal(readCardTrust(key),false);delete globalThis.localStorage;
});
