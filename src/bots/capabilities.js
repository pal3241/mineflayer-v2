import { Registry } from '../core/registry.js';
import { ValidationError } from '../core/errors.js';

export class CapabilityRegistry extends Registry {
  constructor() { super('Capability'); }
  register(capability) { if (typeof capability?.execute !== 'function') throw new ValidationError('Capability needs execute()'); return super.register(capability); }
  async execute(name, input, context) { return this.get(name).execute(input, context); }
}
