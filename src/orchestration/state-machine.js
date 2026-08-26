import { InvalidTransitionError, ValidationError } from '../core/errors.js';

export class StateMachine {
  constructor({ initial, states, context = {}, eventBus, source = 'state-machine' }) {
    if (!initial || !states?.[initial]) throw new ValidationError('A valid initial state is required');
    this.state = initial; this.states = states; this.context = context; this.eventBus = eventBus; this.source = source; this.history = [];
    for (const [name, state] of Object.entries(states)) if (state.parent && !states[state.parent]) throw new ValidationError(`Unknown parent state '${state.parent}' for '${name}'`);
  }

  #transitionFor(event) {
    const seen = new Set(); let name = this.state;
    while (name && !seen.has(name)) { seen.add(name); const state = this.states[name]; if (state?.on?.[event]) return state.on[event]; name = state?.parent; }
    return null;
  }
  can(event) { return Boolean(this.#transitionFor(event)); }

  async transition(event, payload) {
    const from = this.state;
    const spec = this.#transitionFor(event);
    if (!spec) throw new InvalidTransitionError(from, event);
    const transition = typeof spec === 'string' ? { target: spec } : spec;
    if (!this.states[transition.target]) throw new ValidationError(`Unknown target state '${transition.target}'`);
    if (transition.guard && !await transition.guard(this.context, payload)) throw new InvalidTransitionError(from, event);
    await this.states[from].exit?.(this.context, payload);
    await transition.action?.(this.context, payload);
    this.state = transition.target;
    await this.states[this.state].entry?.(this.context, payload);
    const record = { from, to: this.state, event, timestamp: new Date().toISOString() };
    this.history.push(record);
    await this.eventBus?.publish('state.transitioned', record, { source: this.source });
    return this.state;
  }

  snapshot() { return { state: this.state, context: structuredClone(this.context), history: [...this.history] }; }
}
