import { ValidationError } from '../core/errors.js';

export function createDiscoveryService({ worldMemory, semanticMemory, events }) {
  if (!worldMemory || !semanticMemory) throw new ValidationError('Discovery memory services are required');
  const record = async ({ runtime, survey, reason }) => {
    if (!runtime || !Array.isArray(survey?.discoveries)) throw new ValidationError('Discovery record requires runtime and survey discoveries');
    const snapshot = runtime.adapter.snapshot(); const server = serverIdentity(runtime.options); const worldKey = `${server.host}:${server.port}`;
    const memories = [];
    for (const discovery of survey.discoveries) {
      const suffix = `${Math.floor(discovery.position.x)}-${Math.floor(discovery.position.z)}`; const name = `${discovery.type}-${discovery.name}-${suffix}`;
      const memory = await worldMemory.remember({ ...runtime.options, dimension: snapshot.dimension, position: discovery.position, name, type: discovery.type, sourceBotId: runtime.bot.id, confidence: discovery.confidence, importance: discovery.type === 'resource' ? 0.75 : 0.95, tags: ['auto-discovery', discovery.marker], metadata: { marker: discovery.marker, reason, scannedAt: survey.scannedAt } });
      await semanticMemory.remember({ type: discovery.type === 'resource' ? 'SEMANTIC' : 'LONG_TERM', content: `${discovery.type} ${discovery.name} ditemukan di ${discovery.position.x}, ${discovery.position.y}, ${discovery.position.z}`, visibility: 'HIVE', worldKey, dimension: snapshot.dimension, source: reason === 'command' ? 'survey' : 'structure-observer', sourceBotId: runtime.bot.id, confidence: discovery.confidence, importance: discovery.type === 'resource' ? 0.75 : 0.95, tags: ['auto-discovery', discovery.type, discovery.marker], metadata: { worldMemoryId: memory.id, reason } });
      memories.push(memory);
    }
    if (memories.length) await events?.publish('world.structures.discovered', { botId: runtime.bot.id, reason, discoveries: memories }, { source: 'structure-observer' });
    return { ...survey, memories };
  };
  return Object.freeze({ record });
}

function serverIdentity(options) { return { host: String(options?.host ?? 'localhost').toLowerCase(), port: Number(options?.port ?? 25565) }; }
