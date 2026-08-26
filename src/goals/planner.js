import { Task } from '../tasks/task.js';
import { TaskGraph } from '../tasks/task-graph.js';
import { ValidationError } from '../core/errors.js';

export class DeterministicPlanner {
  plan(goal) {
    if (!goal.steps.length) throw new ValidationError('Deterministic goals require at least one structured step');
    const aliases = new Map();
    const tasks = goal.steps.map((step, index) => {
      const id = step.id ?? `${goal.id}:step:${index + 1}`; aliases.set(step.name ?? step.id ?? String(index), id);
      return new Task({ ...step, id, goalId: goal.id, priority: step.priority ?? goal.priority, dependencies: [] });
    });
    goal.steps.forEach((step, index) => {
      tasks[index].dependencies = (step.dependencies ?? (index ? [goal.steps[index - 1].name ?? goal.steps[index - 1].id ?? String(index - 1)] : [])).map(value => aliases.get(value) ?? value);
      tasks[index].status = tasks[index].dependencies.length ? 'PENDING' : 'READY';
    });
    return new TaskGraph(tasks);
  }
}
