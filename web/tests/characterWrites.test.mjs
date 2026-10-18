import test from 'node:test';
import assert from 'node:assert/strict';
import {CharacterWrites} from '../src/utils/characterWrites.ts';
test('serialized partial writes preserve metadata, worldbook and concurrent chat changes',async()=>{
 const base={id:'one',name:'角色',sessions:[],lorebook:{entries:[]}};const disk=[];
 const q=new CharacterWrites(async value=>{await new Promise(r=>setTimeout(r,5));disk.push(structuredClone(value));});
 await Promise.all([q.save(base,{sessions:[{id:'chat1'}]}),q.save(base,{lorebook:{entries:[{content:'new'}]}}),q.save(base,{name:'new name'})]);
 assert.deepEqual(disk.at(-1),{id:'one',name:'new name',sessions:[{id:'chat1'}],lorebook:{entries:[{content:'new'}]}});
});
test('failed write rejects and does not poison queue or overwrite successful state',async()=>{
 let fail=true;let disk;const q=new CharacterWrites(async v=>{if(fail){fail=false;throw new Error('disk full');}disk=v;});
 const base={id:'one',name:'old',sessions:[]};await assert.rejects(q.save(base,{name:'not saved'}),/disk full/);
 await q.save(base,{sessions:[1]});assert.equal(disk.name,'old');assert.deepEqual(disk.sessions,[1]);
});

import {validateWorkflow} from '../src/utils/workflowValidation.ts';
test('workflow detects cycles, duplicate IDs and dangling edges',()=>{
 const nodes=[{id:'a'},{id:'b'}];assert.doesNotThrow(()=>validateWorkflow(nodes,[{source:'a',target:'b'}]));
 assert.throws(()=>validateWorkflow(nodes,[{source:'a',target:'b'},{source:'b',target:'a'}]),/循环/);
 assert.throws(()=>validateWorkflow(nodes,[{source:'a',target:'z'}]),/不存在/);
 assert.throws(()=>validateWorkflow([{id:'a'},{id:'a'}],[]),/重复/);
});
