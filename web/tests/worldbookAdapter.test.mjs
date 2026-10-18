import test from 'node:test';
import assert from 'node:assert/strict';
import {toHelperEntry,fromHelperEntry} from '../src/runtime/worldbookAdapter.ts';
test('V2 worldbook comment/id becomes helper name/uid, including disabled init data',()=>{
 const raw={id:7,comment:'[[world]]地图',content:'{}',enabled:false,keys:['x'],secondary_keys:['y'],insertion_order:50,position:'before_char',extensions:{position:4,depth:3,opaque:42},opaque:{keep:true}};
 const api=toHelperEntry(raw,0);assert.equal(api.name,'[[world]]地图');assert.equal(api.uid,7);assert.equal(api.enabled,false);assert.equal(api.position.type,'at_depth');assert.equal(api.position.depth,3);assert.equal(api.position.order,50);assert.deepEqual(api.strategy.keys,['x']);
 const edited=fromHelperEntry({...api,name:'renamed',enabled:true,content:'changed'},raw);
 assert.equal(edited.comment,'renamed');assert.equal(edited.content,'changed');assert.equal(edited.enabled,true);assert.equal(edited.disable,false);assert.deepEqual(edited.opaque,{keep:true});assert.equal(edited.extensions.opaque,42);assert.equal(edited.position,4);
 assert.equal(toHelperEntry(edited,0).name,'renamed');assert.equal(raw.enabled,false);
});
test('ST worldbook aliases and helper changes preserve canonical compiler semantics',()=>{
 const raw={uid:2,comment:'entry',disable:true,key:['a'],keysecondary:[],constant:true,position:1,order:12};
 const api=toHelperEntry(raw,0);assert.equal(api.enabled,false);assert.equal(api.strategy.type,'constant');assert.equal(api.position.type,'after_character_definition');
 const next=fromHelperEntry({...api,strategy:{...api.strategy,type:'selective',keys:['b'],keys_secondary:{logic:'not_any',keys:['bad']}},position:{...api.position,type:'at_depth',role:'assistant',depth:2,order:10},enabled:true},raw);
 assert.equal(next.constant,false);assert.equal(next.selectiveLogic,2);assert.equal(next.role,2);assert.equal(next.order,10);assert.equal(next.position,4);assert.deepEqual(next.key,['b']);
});
