import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../src/core/event-bus.js';
import { MineflayerAdapter } from '../../src/plugins/minecraft/mineflayer-adapter.js';
import { createSurvivalService } from '../../src/survival/survival-service.js';

const enabled=process.env.MINEHIVE_E2E_SURVIVAL==='1';

test('real Overworld bot survives one night and continues collection',{skip:!enabled,timeout:1_500_000},async()=>{
  const adapter=new MineflayerAdapter();
  const id='survival-e2e';
  const runtime={bot:{id,metadata:{autoSleep:true}},snapshot:()=>({status:adapter.status}),adapter};
  const survival=createSurvivalService({acquisition:{registerSpecialSource(){},async acquire(){return {status:'UNAVAILABLE'};}},events:new EventBus(),logger:null,config:{supervisorIntervalMs:1000}});
  try{
    await adapter.connect({host:process.env.MINEHIVE_E2E_HOST??'127.0.0.1',port:Number(process.env.MINEHIVE_E2E_PORT??25565),username:process.env.MINEHIVE_E2E_USERNAME??'MineHiveSurvivalE2E',auth:process.env.MINEHIVE_E2E_AUTH??'offline',version:process.env.MINEHIVE_E2E_VERSION||undefined});
    await waitFor(()=>adapter.status==='READY',60_000,'bot READY');
    const initial=adapter.snapshot().inventorySummary;
    for(const required of ['bread','torch'])assert.ok(initial.some(item=>item.name===required&&item.count>0),`E2E inventory requires ${required}`);
    assert.ok(initial.some(item=>/_(helmet|chestplate|leggings|boots)$/.test(item.name)),'E2E inventory requires armor');
    assert.ok(initial.some(item=>item.name.endsWith('_bed')&&item.count>0)||await hasNearbyBed(adapter),'E2E requires a bed item or nearby bed');
    survival.attach(runtime);await adapter.setHome({name:'home'});
    await waitFor(()=>adapter.sleepStatus().isNight,720_000,'nightfall');
    await waitFor(()=>!adapter.sleepStatus().isNight,720_000,'sunrise after one night');
    assert.ok(adapter.snapshot().alive,'bot died during the overnight survival run');
    const result=await adapter.collect({block:process.env.MINEHIVE_E2E_COLLECT_BLOCK??'stone',count:1,maxDistance:16},{signal:AbortSignal.timeout(120_000)});
    assert.ok(result.collectedTargets>=1,'bot did not continue collection after sunrise');
  }finally{survival.stop();await adapter.disconnect('survival E2E finished').catch(()=>{});}
});

async function hasNearbyBed(adapter){try{return Boolean(adapter.findBed({maxDistance:32}));}catch{return false;}}
async function waitFor(predicate,timeout,label){const started=Date.now();while(Date.now()-started<timeout){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,1000));}throw new Error(`Timed out waiting for ${label}`);}
