import { ConflictError, NotFoundError } from '../core/errors.js';
import { TaskStatus } from './task.js';

export class TaskGraph {
  constructor(tasks = []) { this.tasks = new Map(tasks.map(task => [task.id, task])); this.validate(); this.refresh(); }
  validate() {
    for (const task of this.tasks.values()) for (const dependency of task.dependencies) if (!this.tasks.has(dependency)) throw new NotFoundError('Task dependency', dependency);
    const visiting = new Set(); const visited = new Set();
    const visit = id => { if (visiting.has(id)) throw new ConflictError('Task graph contains a cycle', { taskId: id }); if (visited.has(id)) return; visiting.add(id); for (const dependency of this.tasks.get(id).dependencies) visit(dependency); visiting.delete(id); visited.add(id); };
    for (const id of this.tasks.keys()) visit(id);
  }
  refresh() {
    for (const task of this.tasks.values()) {
      if (task.status !== TaskStatus.PENDING) continue;
      const dependencies = task.dependencies.map(id => this.tasks.get(id));
      if (dependencies.some(item => [TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.BLOCKED].includes(item.status))) task.update(TaskStatus.BLOCKED);
      else if (dependencies.every(item => item.status === TaskStatus.COMPLETED)) task.update(TaskStatus.READY);
    }
  }
  ready() { this.refresh(); return [...this.tasks.values()].filter(task => task.status === TaskStatus.READY).sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt)); }
  complete() { return [...this.tasks.values()].every(task => task.status === TaskStatus.COMPLETED); }
  failed() { return [...this.tasks.values()].some(task => [TaskStatus.FAILED, TaskStatus.BLOCKED].includes(task.status)); }
  cancelled() { return [...this.tasks.values()].some(task => task.status === TaskStatus.CANCELLED); }
  list() { return [...this.tasks.values()]; }
}
