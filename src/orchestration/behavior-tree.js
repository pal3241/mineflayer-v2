import { ValidationError } from '../core/errors.js';
import { retry, withTimeout } from './execution.js';

export const Status = Object.freeze({ RUNNING: 'RUNNING', SUCCESS: 'SUCCESS', FAILURE: 'FAILURE', CANCELLED: 'CANCELLED' });

export class Blackboard {
  #values = new Map();
  get(key, fallback) { return this.#values.has(key) ? this.#values.get(key) : fallback; }
  set(key, value) { this.#values.set(key, value); return value; }
  delete(key) { return this.#values.delete(key); }
  snapshot() { return Object.fromEntries(this.#values); }
}

export class ActionNode {
  constructor(name, action) { this.name = name; this.action = action; }
  async tick(context) { return this.action(context); }
}

export class ConditionNode extends ActionNode {
  constructor(name, predicate) { super(name, async context => await predicate(context) ? Status.SUCCESS : Status.FAILURE); }
}

export class Sequence {
  constructor(name, children = []) { this.name = name; this.children = children; this.cursor = 0; }
  async tick(context) {
    while (this.cursor < this.children.length) {
      const status = await this.children[this.cursor].tick(context);
      if (status === Status.RUNNING) return status;
      if (status !== Status.SUCCESS) { this.cursor = 0; return status; }
      this.cursor++;
    }
    this.cursor = 0; return Status.SUCCESS;
  }
}

export class Selector extends Sequence {
  async tick(context) {
    while (this.cursor < this.children.length) {
      const status = await this.children[this.cursor].tick(context);
      if (status === Status.RUNNING) return status;
      if (status === Status.SUCCESS) { this.cursor = 0; return status; }
      this.cursor++;
    }
    this.cursor = 0; return Status.FAILURE;
  }
}

export class Parallel {
  constructor(name, children = [], successThreshold = children.length) { this.name = name; this.children = children; this.successThreshold = successThreshold; }
  async tick(context) {
    const statuses = await Promise.all(this.children.map(child => child.tick(context)));
    if (statuses.filter(x => x === Status.SUCCESS).length >= this.successThreshold) return Status.SUCCESS;
    if (statuses.filter(x => x === Status.FAILURE).length > this.children.length - this.successThreshold) return Status.FAILURE;
    return Status.RUNNING;
  }
}

export class RetryNode {
  constructor(name, child, attempts = 3) { this.name = name; this.child = child; this.attempts = attempts; }
  async tick(context) {
    try {
      return await retry(async () => {
        const status = await this.child.tick(context);
        if (status === Status.FAILURE) throw new Error(`${this.child.name} failed`);
        return status;
      }, { attempts: this.attempts, signal: context.signal });
    } catch { return context.signal?.aborted ? Status.CANCELLED : Status.FAILURE; }
  }
}

export class TimeoutNode {
  constructor(name, child, timeoutMs) { this.name = name; this.child = child; this.timeoutMs = timeoutMs; }
  async tick(context) {
    try { return await withTimeout(signal => this.child.tick({ ...context, signal }), this.timeoutMs, { name: this.name, signal: context.signal }); }
    catch { return context.signal?.aborted ? Status.CANCELLED : Status.FAILURE; }
  }
}

export class BehaviorTree {
  constructor(root, { blackboard = new Blackboard() } = {}) { if (!root?.tick) throw new ValidationError('Behavior tree root must be tickable'); this.root = root; this.blackboard = blackboard; this.paused = false; this.cancelled = false; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  cancel() { this.cancelled = true; }
  checkpoint(metadata = {}) { return { ...metadata, behaviorNode: this.root.name, blackboardSnapshot: this.blackboard.snapshot(), createdAt: new Date().toISOString() }; }
  restore(checkpoint) { for (const [key, value] of Object.entries(checkpoint.blackboardSnapshot ?? {})) this.blackboard.set(key, value); }
  async tick(context = {}) { if (this.cancelled || context.signal?.aborted) return Status.CANCELLED; if (this.paused) return Status.RUNNING; return this.root.tick({ ...context, blackboard: this.blackboard }); }
}
