import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/bots/capabilities.js';
import { MINECRAFT_CAPABILITIES, registerMinecraftCapabilities } from '../src/bots/minecraft-capabilities.js';
import { createSurvivalService } from '../src/survival/survival-service.js';

const SURVIVAL_CAPABILITIES=new Set(['minecraft.equip','minecraft.unequip','minecraft.use-item','minecraft.interact-entity','minecraft.interact-block','minecraft.entity-search','minecraft.armor.inspect','minecraft.armor.equip','minecraft.armor.auto-equip','minecraft.sheep-search','minecraft.shear','minecraft.shear-nearest','minecraft.acquire-wool','minecraft.cow-search','minecraft.milk','minecraft.milk-nearest','minecraft.acquire-milk','minecraft.bed-search','minecraft.sleep','minecraft.wake','minecraft.sleep-status','minecraft.open-door','minecraft.close-door','minecraft.open-trapdoor','minecraft.close-trapdoor']);

test('every advertised Minecraft capability executes a real adapter or survival operation',async()=>{
  const calls=[];const runtime={bot:{id:'contract-bot'}};
  const adapter=new Proxy({}, {get(_target,method){if(method==='snapshot')return()=>{calls.push({target:'adapter',method,args:[]});return {inventorySummary:[]};};return(...args)=>{calls.push({target:'adapter',method:String(method),args});return {method:String(method),verified:true};};}});
  runtime.adapter=adapter;
  const survival=new Proxy({}, {get(_target,method){return(...args)=>{calls.push({target:'survival',method:String(method),args});return {method:String(method),verified:true};};}});
  const registry=new CapabilityRegistry();registerMinecraftCapabilities(registry,{get:()=>runtime},survival);
  assert.deepEqual(registry.list().map(item=>item.name).sort(),[...MINECRAFT_CAPABILITIES].sort());
  const input={target:{x:1,y:64,z:2},position:{x:1,y:64,z:2},item:'white_wool',count:1,message:'hello',name:'sheep',type:'mob',entityId:'1',block:'oak_door'};
  for(const name of MINECRAFT_CAPABILITIES){const before=calls.length;await registry.execute(name,input,{botId:'contract-bot'});assert.ok(calls.length>before,`${name} returned without executing a real operation`);const call=calls.at(-1);assert.equal(call.target,SURVIVAL_CAPABILITIES.has(name)?'survival':'adapter',`${name} used the wrong execution layer`);if(call.target==='survival')assert.equal(call.args[0],runtime,`${name} did not receive the bot runtime`);}
});

test('missing navigation implementations fail instead of returning verified unavailable results',async()=>{
  const registry=new CapabilityRegistry();registerMinecraftCapabilities(registry,{get:()=>({bot:{id:'missing'},adapter:{}})},{});
  await assert.rejects(registry.execute('minecraft.navigation-terrain-scan',{position:{x:0,y:64,z:0}},{botId:'missing'}),error=>error.code==='VALIDATION_ERROR'&&/inspectNavigationTerrain/.test(error.message));
  await assert.rejects(registry.execute('minecraft.navigation-precision',{target:{x:0,y:64,z:0}},{botId:'missing'}),error=>error.code==='VALIDATION_ERROR'&&/precisionNavigate/.test(error.message));
});

test('survival policy reaches the wool execution branch without losing guarded-kill settings',async()=>{
  let received=null;const runtime={bot:{id:'wool-bot'},adapter:{async acquireWool(input){received=input;return {verified:true};}}};
  const survival=createSurvivalService({acquisition:{registerSpecialSource(){}},events:null,logger:null,config:{allowAnimalKill:true,minimumSheepReserve:3,entitySearchDistance:27}});
  await survival.acquireWool(runtime,{color:'white',count:2},{});
  assert.deepEqual(received,{maxDistance:27,minimumSheepReserve:3,allowAnimalKill:true,color:'white',count:2});
});
