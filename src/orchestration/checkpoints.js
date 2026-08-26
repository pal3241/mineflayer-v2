import { NotFoundError } from '../core/errors.js';

export class CheckpointManager {
  #items = new Map();
  async save({ taskId, botId, behaviorNode = null, machineState = null, blackboardSnapshot = {}, attempt = 0 }) {
    const checkpoint = { id: taskId, taskId, botId, behaviorNode, machineState, blackboardSnapshot: structuredClone(blackboardSnapshot), attempt, createdAt: new Date().toISOString() };
    this.#items.set(taskId, checkpoint); return structuredClone(checkpoint);
  }
  async find(taskId) { const value = this.#items.get(taskId); if (!value) throw new NotFoundError('Checkpoint', taskId); return structuredClone(value); }
  async restore(taskId, validate = async () => true) {
    const checkpoint = await this.find(taskId);
    if (!await validate(checkpoint)) return { restored: false, reason: 'CHECKPOINT_STALE', checkpoint };
    return { restored: true, checkpoint };
  }
  async remove(taskId) { return this.#items.delete(taskId); }
  async list() { return [...this.#items.values()].map(item => structuredClone(item)); }
}
