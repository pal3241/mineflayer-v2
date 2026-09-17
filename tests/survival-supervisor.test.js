import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EventBus } from '../src/core/event-bus.js';
import { createSurvivalService } from '../src/survival/survival-service.js';

test('survival supervisor interrupts work before handling panic health', async () => {
  class Adapter extends EventEmitter { constructor(){super();this.stops=0;this.emergencies=[];} snapshot(){return {health:6,food:20,inventorySummary:[]};} survivalStatus(){return {health:6,food:20,oxygen:20,onFire:false,inLava:false,foodItems:0,hostileCount:1};} async stopActions(){this.stops++;} async emergencySurvival(input){this.emergencies.push(input);return {verified:true};} async autoEquipArmor(){return {changed:false};} }
  const adapter=new Adapter(),runtime={bot:{id:'supervised',metadata:{}},snapshot:()=>({status:'READY'}),adapter};const acquisition={registerSpecialSource(){},acquire:async()=>({status:'COMPLETED'})},events=new EventBus(),interrupted=[];events.subscribe('survival.supervisor.interrupted',event=>interrupted.push(event.payload));const survival=createSurvivalService({acquisition,events,logger:null,config:{supervisorIntervalMs:250}});survival.attach(runtime);await new Promise(resolve=>setTimeout(resolve,320));survival.stop();assert.ok(adapter.stops>=1);assert.equal(adapter.emergencies[0].reason,'PANIC_HEALTH');assert.equal(interrupted[0].priority,2);
});

test('survival supervisor asks acquisition for food reserve without blocking its tick', async () => {
  class Adapter extends EventEmitter { snapshot(){return {health:20,food:18,inventorySummary:[]};} survivalStatus(){return {health:20,food:18,oxygen:20,onFire:false,inLava:false,foodItems:1,hostileCount:0};} async autoEquipArmor(){return {changed:false};} async sleepStatus(){return {sleeping:false,isNight:false};} }
  const requests=[],adapter=new Adapter(),runtime={bot:{id:'hungry',metadata:{autoSleep:false}},snapshot:()=>({status:'READY'}),adapter};const acquisition={registerSpecialSource(){},async acquire(input){requests.push(input);return {status:'COMPLETED'};}};const survival=createSurvivalService({acquisition,events:new EventBus(),logger:null,config:{supervisorIntervalMs:250,minimumFoodItems:4}});survival.attach(runtime);await new Promise(resolve=>setTimeout(resolve,320));survival.stop();assert.equal(requests.length,1);assert.equal(requests[0].item,'bread');assert.equal(requests[0].count,3);assert.equal(requests[0].priority,95);
});

test('survival interrupt retreats to an ally then restores the interrupted action', async () => {
  class Adapter extends EventEmitter {
    constructor(){super();this.calls=[];}
    survivalStatus(){return {health:7,food:20,oxygen:20,onFire:false,inLava:false,foodItems:4,hostileCount:1};}
    async beginSurvivalInterrupt(input){this.calls.push(['pause',input.reason]);return {goal:'collect-stone'};}
    async emergencySurvival(){this.calls.push(['emergency']);return {verified:true};}
    async retreatToSafety(input){this.calls.push(['retreat',input.allies[0]?.botId]);return {destination:'ALLY',verified:true};}
    async resumeSurvivalInterrupt(input){this.calls.push(['resume',input.checkpoint.goal]);return {resumed:true};}
    async autoEquipArmor(){return {changed:false};}
  }
  const adapter=new Adapter();
  const runtime={bot:{id:'worker',metadata:{}},snapshot:()=>({status:'READY'}),adapter};
  const bots={list:()=>[{id:'worker',status:'READY',runtime:{position:{x:0,y:64,z:0},dimension:'overworld'}},{id:'guard',status:'READY',runtime:{position:{x:4,y:64,z:0},dimension:'overworld'}}]};
  const survival=createSurvivalService({acquisition:{registerSpecialSource(){}},events:new EventBus(),logger:null,bots,config:{supervisorIntervalMs:250}});
  survival.attach(runtime);await new Promise(resolve=>setTimeout(resolve,320));survival.stop();
  assert.deepEqual(adapter.calls,[['pause','LOW_HEALTH'],['emergency'],['retreat','guard'],['resume','collect-stone']]);
});

test('dark areas receive a torch without interrupting safe work', async () => {
  class Adapter extends EventEmitter {
    constructor(){super();this.torches=0;}
    survivalStatus(){return {health:20,food:20,oxygen:20,onFire:false,inLava:false,foodItems:4,hostileCount:0,torchItems:8,lightLevel:3,isNight:false};}
    async placeSafetyTorch(){this.torches++;return {placed:true,verified:true};}
    async autoEquipArmor(){return {changed:false};}
    async sleepStatus(){return {sleeping:false,isNight:false};}
  }
  const adapter=new Adapter();const runtime={bot:{id:'lighter',metadata:{autoSleep:false}},snapshot:()=>({status:'READY'}),adapter};
  const survival=createSurvivalService({acquisition:{registerSpecialSource(){}},events:new EventBus(),logger:null,config:{supervisorIntervalMs:250,torchIntervalMs:1000}});
  survival.attach(runtime);await new Promise(resolve=>setTimeout(resolve,320));survival.stop();assert.equal(adapter.torches,1);
});

test('night threat builds an emergency pillar and resumes the previous action', async () => {
  class Adapter extends EventEmitter {
    constructor(){super();this.calls=[];}
    survivalStatus(){return {health:20,food:20,oxygen:20,onFire:false,inLava:false,foodItems:4,hostileCount:2,torchItems:0,lightLevel:0,isNight:true};}
    async beginSurvivalInterrupt(){this.calls.push('pause');return {goal:'farm'};}
    async buildEmergencyShelter(){this.calls.push('pillar');return {type:'PILLAR',height:3,verified:true};}
    async resumeSurvivalInterrupt(){this.calls.push('resume');return {resumed:true};}
    async autoEquipArmor(){return {changed:false};}
  }
  const adapter=new Adapter();const runtime={bot:{id:'night-watch',metadata:{autoSleep:false}},snapshot:()=>({status:'READY'}),adapter};
  const survival=createSurvivalService({acquisition:{registerSpecialSource(){}},events:new EventBus(),logger:null,config:{supervisorIntervalMs:250}});
  survival.attach(runtime);await new Promise(resolve=>setTimeout(resolve,320));survival.stop();assert.deepEqual(adapter.calls,['pause','pillar','resume']);
});
