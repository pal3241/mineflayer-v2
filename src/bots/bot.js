export class Bot {
  constructor({ id, name, capabilities = [], metadata = {} }) {
    this.id = id; this.name = name; this.status = 'REGISTERED'; this.capabilities = new Set(capabilities); this.metadata = metadata;
  }
  toDTO() { return { id: this.id, name: this.name, status: this.status, capabilities: [...this.capabilities], metadata: this.metadata }; }
}
