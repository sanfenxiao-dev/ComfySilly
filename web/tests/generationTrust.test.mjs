import test from 'node:test';
import assert from 'node:assert/strict';
import { generationBudget, compilePrompt } from '../src/utils/promptCompiler.ts';
import { cardTrustKey, readCardTrust, writeCardTrust } from '../src/utils/cardTrust.ts';
test('99999 output on 32768 context is repaired consistently without rewriting preset', () => {
 const preset={openai_max_context:32768,openai_max_tokens:99999};
 const out=compilePrompt({character:{name:'x'},preset,history:[{role:'user',content:'中'.repeat(48000)}]});
 assert.equal(out.budget.maxOutputTokens,4096);assert.equal(out.budget.inputBudget,28672);
 assert.ok(out.warnings.some(w=>w.includes('99999')));assert.equal(preset.openai_max_tokens,99999);
});
test('malformed budget stays positive; real overflow remains actionable',()=>{
 for(const preset of [{openai_max_context:-2,openai_max_tokens:NaN},{openai_max_context:1024,openai_max_tokens:999999},{openai_max_context:Infinity,openai_max_tokens:-10}]){
  const b=generationBudget(preset);assert.ok(b.inputBudget>0);assert.ok(Number.isInteger(b.maxOutputTokens));
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
