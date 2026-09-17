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
