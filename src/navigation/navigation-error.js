import { MineHiveError } from '../core/errors.js';

export class NavigationError extends MineHiveError {
  constructor(code, message, details) { super(message, { code, details }); }
}
