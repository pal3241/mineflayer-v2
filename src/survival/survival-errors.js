import { MineHiveError } from '../core/errors.js';

export class SurvivalCapabilityError extends MineHiveError {
  constructor(code, message, details) { super(message, { code, details }); }
}
