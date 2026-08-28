import { Goal, GoalStatus } from './goal.js';
import { TaskStatus } from '../tasks/task.js';
import { ConflictError, NotFoundError } from '../core/errors.js';

export class GoalService {
  #goals = new Map();
  #graphs = new Map();
  #running = new Map();
  constructor({ planner, scheduler, executor, eventBus, metrics }) { this.planner = planner; this.scheduler = scheduler; this.executor = executor; this.events = eventBus; this.metrics = metrics; }
  create(input) {
    const goal = new Goal(input); const graph = this.planner.plan(goal); goal.update(GoalStatus.PLANNED);
    this.#goals.set(goal.id, goal); this.#graphs.set(goal.id, graph); this.metrics.increment('goals.created');
    void this.events.publish('goal.created', goal.toDTO(), { source: 'goal-service', correlationId: goal.id }); return goal.toDTO();
  }
  get(id) { const goal = this.#goals.get(id); if (!goal) throw new NotFoundError('Goal', id); return goal; }
  graph(id) { this.get(id); return this.#graphs.get(id); }
  list() { return [...this.#goals.values()].map(goal => goal.toDTO()); }
  tasks(goalId) { return this.graph(goalId).list().map(task => task.toDTO()); }
  task(taskId) { for (const graph of this.#graphs.values()) { const task = graph.tasks.get(taskId); if (task) return task; } throw new NotFoundError('Task', taskId); }
  allTasks() { return [...this.#graphs.values()].flatMap(graph => graph.list().map(task => task.toDTO())); }
  run(id) {
    if (this.#running.has(id)) return this.#running.get(id);
    const operation = this.#run(id).finally(() => this.#running.delete(id)); this.#running.set(id, operation); return operation;
  }
  async #run(id) {
    const goal = this.get(id); const graph = this.graph(id);
    if ([GoalStatus.COMPLETED, GoalStatus.CANCELLED].includes(goal.status)) return goal.toDTO();
    goal.update(GoalStatus.ACTIVE); await this.events.publish('goal.started', goal.toDTO(), { source: 'goal-service', correlationId: id });
    while (!graph.complete() && !graph.failed() && !graph.cancelled()) {
      const ready = graph.ready();
      if (!ready.length) break;
      const assigned = ready.map(task => ({ task, assignment: this.scheduler.assign(task, goal.constraints.preferredBot) }));
      if (assigned.some(item => !item.assignment)) {
        for (const item of assigned) if (item.assignment) { item.task.update(TaskStatus.READY, { assignedBot: null }); this.scheduler.release(item.task); }
        throw new ConflictError('No eligible bot for one or more ready tasks', { goalId: id });
      }
      await Promise.allSettled(assigned.map(item => this.executor.execute(item.task)));
      graph.refresh();
      const completed = graph.list().filter(task => task.status === TaskStatus.COMPLETED).length;
      goal.update(GoalStatus.ACTIVE, Math.round(completed / graph.list().length * 100));
    }
    if (goal.status === GoalStatus.CANCELLED) return goal.toDTO();
    if (graph.complete()) { goal.update(GoalStatus.COMPLETED, 100); this.metrics.increment('goals.completed'); await this.events.publish('goal.completed', goal.toDTO(), { source: 'goal-service', correlationId: id }); }
    else if (graph.failed()) { goal.update(GoalStatus.FAILED); this.metrics.increment('goals.failed'); await this.events.publish('goal.failed', goal.toDTO(), { source: 'goal-service', correlationId: id }); }
    else if (graph.cancelled()) { goal.update(GoalStatus.CANCELLED); await this.events.publish('goal.cancelled', goal.toDTO(), { source: 'goal-service', correlationId: id }); }
    return goal.toDTO();
  }
  async cancel(id, reason = 'Goal cancelled') {
    const goal = this.get(id); const graph = this.graph(id);
    for (const task of graph.list()) {
      if ([TaskStatus.ASSIGNED, TaskStatus.RUNNING].includes(task.status)) this.executor.cancel(task.id, reason);
      else if (![TaskStatus.COMPLETED, TaskStatus.FAILED].includes(task.status)) task.update(TaskStatus.CANCELLED, { error: { code: 'CANCELLED', message: reason } });
    }
    goal.update(GoalStatus.CANCELLED); await this.events.publish('goal.cancelled', goal.toDTO(), { source: 'goal-service', correlationId: id }); return goal.toDTO();
  }
  async stop() { await Promise.allSettled([...this.#goals.values()].filter(goal => goal.status === GoalStatus.ACTIVE).map(goal => this.cancel(goal.id, 'Application shutdown'))); }
}
