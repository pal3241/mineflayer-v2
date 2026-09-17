import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { CheckpointManager } from '../src/orchestration/checkpoints.js';
import { Task } from '../src/tasks/task.js';
import { TaskExecutor } from '../src/tasks/task-executor.js';

test('survival interruption reruns the capability inside the original task',async()=>{
  let calls=0,rejectWork;const paused=[];const events=new EventBus();events.subscribe('task.survival.paused',event=>paused.push(event.payload));
  const executor=new TaskExecutor({capabilities:{execute:async()=>{calls++;if(calls===1)return new Promise((_resolve,reject)=>{rejectWork=reject;});return {continued:true};}},scheduler:{release(){},record(){}},eventBus:events,metrics:{increment(){}},checkpointRepository:new CheckpointManager(),maxQueuePerBot:4});
  const task=new Task({goalId:'goal',type:'collect',requiredCapabilities:['minecraft.collect'],retries:0});task.assignedBot='worker';
  const running=executor.execute(task);await waitFor(()=>typeof rejectWork==='function');executor.beginSurvivalInterrupt('worker','LOW_HEALTH');rejectWork(new Error('pathfinder stopped for survival'));await waitFor(()=>paused.length===1);await executor.endSurvivalInterrupt('worker',{safe:true});
  assert.deepEqual(await running,{continued:true});assert.equal(calls,2);assert.equal(task.status,'COMPLETED');
});

async function waitFor(predicate,timeout=1000){const started=Date.now();while(Date.now()-started<timeout){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('condition timed out');}
