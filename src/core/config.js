import { ValidationError } from './errors.js';

const bool = value => String(value).toLowerCase() === 'true';
const integer = (value, fallback) => value === undefined ? fallback : Number.parseInt(value, 10);

export function loadConfig(env = process.env) {
  const profile = env.MINEHIVE_PROFILE ?? 'development';
  const memoryMaxRecords = integer(env.MINEHIVE_MEMORY_MAX_RECORDS, 10_000);
  const openRouterKeys = providerKeys([env.OPENROUTER_API_KEY_1, env.OPENROUTER_API_KEY_2, env.OPENROUTER_API_KEY_3, env.OPENROUTER_API_KEY], 'OpenRouter'); const nvidiaKeys = providerKeys([env.NVIDIA_API_KEY_1, env.NVIDIA_API_KEY_2, env.NVIDIA_API_KEY_3, env.NVIDIA_API_KEY, env.MINEHIVE_LOCAL_LLM_API_KEY], 'NVIDIA NIM');
  const nvidiaEndpoint = env.MINEHIVE_NVIDIA_NIM_ENDPOINT ?? env.MINEHIVE_LOCAL_LLM_ENDPOINT ?? 'https://integrate.api.nvidia.com/v1'; const nvidiaModel = env.MINEHIVE_NVIDIA_NIM_MODEL ?? env.MINEHIVE_LOCAL_LLM_MODEL ?? 'meta/llama-3.1-8b-instruct'; const nvidiaConfigured = nvidiaKeys.length > 0 || Boolean((env.MINEHIVE_NVIDIA_NIM_ENDPOINT ?? env.MINEHIVE_LOCAL_LLM_ENDPOINT) && (env.MINEHIVE_NVIDIA_NIM_MODEL ?? env.MINEHIVE_LOCAL_LLM_MODEL));
  const config = {
    profile,
    log: { level: env.MINEHIVE_LOG_LEVEL ?? 'info', directory: env.MINEHIVE_LOG_DIRECTORY, maxFiles: 3 },
    api: { host: env.MINEHIVE_API_HOST ?? '127.0.0.1', port: integer(env.MINEHIVE_API_PORT, 3000), token: env.MINEHIVE_API_TOKEN || null, rateLimitPerMinute: integer(env.MINEHIVE_API_RATE_LIMIT_PER_MINUTE, 120) },
    dataPath: env.MINEHIVE_DATA_PATH ?? './data',
    database: { driver: env.MINEHIVE_DATABASE_DRIVER ?? (profile === 'production' ? 'sqlite' : 'json'), file: env.MINEHIVE_DATABASE_FILE ?? './data/minehive.sqlite' },
    semanticMemory: { maxRecords: memoryMaxRecords, dimensions: integer(env.MINEHIVE_EMBEDDING_DIMENSIONS, 256), shortTermMaxRecords: integer(env.MINEHIVE_SHORT_MEMORY_MAX_RECORDS, Math.min(1000, memoryMaxRecords)), shortTermTtlMs: integer(env.MINEHIVE_SHORT_MEMORY_TTL_MS, 86_400_000), promotionAccesses: integer(env.MINEHIVE_MEMORY_PROMOTION_ACCESSES, 3), promotionImportance: Number(env.MINEHIVE_MEMORY_PROMOTION_IMPORTANCE ?? 0.8), consolidationIntervalMs: integer(env.MINEHIVE_MEMORY_CONSOLIDATION_INTERVAL_MS, 60_000) },
    ml: { minimumSamples: integer(env.MINEHIVE_ML_MINIMUM_SAMPLES, 10) },
    hive: { heartbeatTimeoutMs: integer(env.MINEHIVE_HIVE_HEARTBEAT_TIMEOUT_MS, 30_000) },
    autonomy: { enabled: bool(env.MINEHIVE_AUTONOMY_ENABLED ?? false), intervalMs: integer(env.MINEHIVE_AUTONOMY_INTERVAL_MS, 60_000), maxActionsPerHour: integer(env.MINEHIVE_AUTONOMY_MAX_ACTIONS_PER_HOUR, 20) },
    acquisition: { enabled: bool(env.MINEHIVE_ACQUISITION_ENABLED ?? true), maxDepth: integer(env.MINEHIVE_ACQUISITION_MAX_DEPTH, 8), maxSubtasks: integer(env.MINEHIVE_ACQUISITION_MAX_SUBTASKS, 32), maxAttempts: integer(env.MINEHIVE_ACQUISITION_MAX_ATTEMPTS, 3), maxDistance: integer(env.MINEHIVE_ACQUISITION_MAX_DISTANCE, 2000), storageFirst: bool(env.MINEHIVE_ACQUISITION_STORAGE_FIRST ?? true), allowFleet: bool(env.MINEHIVE_ACQUISITION_ALLOW_FLEET ?? true), allowCraft: bool(env.MINEHIVE_ACQUISITION_ALLOW_CRAFT ?? true), allowSmelt: bool(env.MINEHIVE_ACQUISITION_ALLOW_SMELT ?? true), allowCollect: bool(env.MINEHIVE_ACQUISITION_ALLOW_COLLECT ?? true), allowPartial: bool(env.MINEHIVE_ACQUISITION_ALLOW_PARTIAL ?? false), toolPreservation: bool(env.MINEHIVE_ACQUISITION_TOOL_PRESERVATION ?? true) },
    recovery: { enabled: bool(env.MINEHIVE_DEATH_RECOVERY_ENABLED ?? true), maxAttempts: integer(env.MINEHIVE_MAX_RECOVERY_ATTEMPTS, 3), minScore: integer(env.MINEHIVE_RECOVERY_MIN_SCORE, 40), optionalScore: integer(env.MINEHIVE_RECOVERY_OPTIONAL_SCORE, 20), urgentScore: integer(env.MINEHIVE_RECOVERY_URGENT_SCORE, 70), despawnTicks: integer(env.MINEHIVE_RECOVERY_ITEM_DESPAWN_TICKS, 6000), safetyMarginTicks: integer(env.MINEHIVE_RECOVERY_SAFETY_MARGIN_TICKS, 600), maxDistance: integer(env.MINEHIVE_RECOVERY_MAX_DISTANCE, 2000), dangerLimit: Number(env.MINEHIVE_RECOVERY_DANGER_LIMIT ?? 0.75) },
    survival: { enabled: bool(env.MINEHIVE_SURVIVAL_ENABLED ?? true), autoEquipArmor: bool(env.MINEHIVE_AUTO_ARMOR_ENABLED ?? true), minimumDurabilityPercent: integer(env.MINEHIVE_ARMOR_MINIMUM_DURABILITY_PERCENT, 10), preferProtection: bool(env.MINEHIVE_ARMOR_PREFER_PROTECTION ?? true), preferDurability: bool(env.MINEHIVE_ARMOR_PREFER_DURABILITY ?? false), allowBindingCurse: bool(env.MINEHIVE_ARMOR_ALLOW_BINDING_CURSE ?? false), allowAnimalKill: bool(env.MINEHIVE_SURVIVAL_ALLOW_ANIMAL_KILL ?? false), minimumSheepReserve: integer(env.MINEHIVE_MINIMUM_SHEEP_RESERVE, 2), minimumCowReserve: integer(env.MINEHIVE_MINIMUM_COW_RESERVE, 2), interactionCooldownMs: integer(env.MINEHIVE_INTERACTION_COOLDOWN_MS, 500), entitySearchDistance: integer(env.MINEHIVE_ENTITY_SEARCH_DISTANCE, 48) },
    tasks: { maxQueuePerBot: integer(env.MINEHIVE_MAX_QUEUE_PER_BOT, 100) },
    bot: {
      host: env.MINEHIVE_HOST ?? 'localhost', port: integer(env.MINEHIVE_PORT, 25565),
      username: env.MINEHIVE_USERNAME ?? 'MineHiveBot', auth: env.MINEHIVE_AUTH ?? 'offline',
      version: env.MINEHIVE_VERSION || undefined, autoConnect: bool(env.MINEHIVE_AUTO_CONNECT ?? false),
      reconnect: { enabled: bool(env.MINEHIVE_RECONNECT ?? true), maxAttempts: integer(env.MINEHIVE_RECONNECT_ATTEMPTS, 5), delayMs: integer(env.MINEHIVE_RECONNECT_DELAY_MS, 3000) },
      autoEat: { enabled: bool(env.MINEHIVE_AUTO_EAT ?? true), minHunger: integer(env.MINEHIVE_AUTO_EAT_MIN_HUNGER, 15) }
    },
    commands: { enabled: bool(env.MINEHIVE_CHAT_COMMANDS ?? true), admins: (env.MINEHIVE_ADMINS ?? '').split(',').map(value => value.trim()).filter(Boolean) },
    viewer: { basePort: integer(env.MINEHIVE_VIEWER_BASE_PORT, 3100), viewDistance: integer(env.MINEHIVE_VIEWER_DISTANCE, 4) },
    llm: { provider: resolveLlmProvider(env.MINEHIVE_LLM_PROVIDER, openRouterKeys.length > 0, nvidiaConfigured), openRouterEndpoint: env.MINEHIVE_OPENROUTER_ENDPOINT ?? env.MINEHIVE_LLM_ENDPOINT ?? 'https://openrouter.ai/api/v1', openRouterModel: env.MINEHIVE_OPENROUTER_MODEL ?? env.MINEHIVE_LLM_MODEL ?? 'openrouter/auto', openRouterApiKeys: openRouterKeys, nvidiaEndpoint, nvidiaModel, nvidiaApiKeys: nvidiaKeys, siteUrl: env.MINEHIVE_SITE_URL, timeoutMs: integer(env.MINEHIVE_LLM_TIMEOUT_MS, 30_000) }
  };
  if (!Number.isInteger(config.api.port) || config.api.port < 1 || config.api.port > 65535) throw new ValidationError('Invalid API port');
  if (!Number.isInteger(config.api.rateLimitPerMinute) || config.api.rateLimitPerMinute < 10) throw new ValidationError('API rate limit must be at least 10 requests per minute');
  if (!Number.isInteger(config.bot.port) || config.bot.port < 1 || config.bot.port > 65535) throw new ValidationError('Invalid Minecraft port');
  if (config.bot.reconnect.maxAttempts < 0 || config.bot.reconnect.delayMs < 0) throw new ValidationError('Invalid reconnect policy');
  if (config.viewer.basePort < 1 || config.viewer.basePort > 65000) throw new ValidationError('Invalid viewer base port');
  if (!['json', 'sqlite'].includes(config.database.driver)) throw new ValidationError('MINEHIVE_DATABASE_DRIVER must be json or sqlite');
  if (!['none', 'openrouter', 'nvidia'].includes(config.llm.provider)) throw new ValidationError('MINEHIVE_LLM_PROVIDER must be none, openrouter, or nvidia');
  validateHttpEndpoint(config.llm.openRouterEndpoint, 'OpenRouter'); validateHttpEndpoint(config.llm.nvidiaEndpoint, 'NVIDIA NIM');
  if (config.semanticMemory.maxRecords < 100 || config.semanticMemory.dimensions < 16) throw new ValidationError('Invalid semantic memory limits');
  if (config.semanticMemory.shortTermMaxRecords < 1 || config.semanticMemory.shortTermMaxRecords > config.semanticMemory.maxRecords || config.semanticMemory.shortTermTtlMs < 1000 || config.semanticMemory.promotionAccesses < 1 || !Number.isFinite(config.semanticMemory.promotionImportance) || config.semanticMemory.promotionImportance < 0 || config.semanticMemory.promotionImportance > 1 || config.semanticMemory.consolidationIntervalMs < 5000) throw new ValidationError('Invalid short-term memory lifecycle policy');
  if (config.ml.minimumSamples < 2) throw new ValidationError('Invalid ML minimum sample count');
  if (config.hive.heartbeatTimeoutMs < 1000) throw new ValidationError('Invalid HiveMind heartbeat timeout');
  if (config.autonomy.intervalMs < 5000 || config.autonomy.maxActionsPerHour < 1) throw new ValidationError('Invalid autonomy limits');
  validateAcquisition(config.acquisition);
  validateRecovery(config.recovery);
  validateSurvival(config.survival);
  if (!Number.isInteger(config.tasks.maxQueuePerBot) || config.tasks.maxQueuePerBot < 1 || config.tasks.maxQueuePerBot > 10_000) throw new ValidationError('Task queue limit must be between 1 and 10000 per bot');
  if (!['development', 'test', 'staging', 'production'].includes(config.profile)) throw new ValidationError('Invalid MINEHIVE_PROFILE');
  if (config.profile === 'production' && !config.api.token) throw new ValidationError('MINEHIVE_API_TOKEN is required in production');
  return Object.freeze(config);
}

function providerKeys(values, provider) { const keys = [...new Set(values.filter(Boolean))]; if (keys.length > 3 || keys.some(key => typeof key !== 'string' || key.length > 500)) throw new ValidationError(`${provider} must have at most three API keys of up to 500 characters`); return keys; }
function validateHttpEndpoint(value, provider) { let url; try { url = new URL(value); } catch { throw new ValidationError(`${provider} endpoint must be a valid URL`); } if (!['http:', 'https:'].includes(url.protocol)) throw new ValidationError(`${provider} endpoint must use HTTP or HTTPS`); }
function resolveLlmProvider(value, hasOpenRouter, hasNvidia) { const requested = value ?? 'auto'; if (requested === 'auto') return hasOpenRouter ? 'openrouter' : hasNvidia ? 'nvidia' : 'none'; if (requested === 'local') return 'nvidia'; return requested; }
function validateAcquisition(value) {
  const fields = ['maxDepth', 'maxSubtasks', 'maxAttempts', 'maxDistance'];
  for (const field of fields) if (!Number.isInteger(value[field])) throw new ValidationError(`Acquisition setting '${field}' must be an integer`);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new ValidationError('Acquisition enabled must be a boolean');
  if (value.maxDepth < 1 || value.maxDepth > 32) throw new ValidationError('Acquisition maxDepth must be between 1 and 32');
  if (value.maxSubtasks < 1 || value.maxSubtasks > 256) throw new ValidationError('Acquisition maxSubtasks must be between 1 and 256');
  if (value.maxAttempts < 1 || value.maxAttempts > 10) throw new ValidationError('Acquisition maxAttempts must be between 1 and 10');
  if (value.maxDistance < 16 || value.maxDistance > 100_000) throw new ValidationError('Acquisition maxDistance must be between 16 and 100000');
  for (const field of ['storageFirst', 'allowFleet', 'allowCraft', 'allowSmelt', 'allowCollect', 'allowPartial', 'toolPreservation']) if (typeof value[field] !== 'boolean') throw new ValidationError(`Acquisition setting '${field}' must be a boolean`);
}
function validateRecovery(value) { const integerFields = ['maxAttempts', 'minScore', 'optionalScore', 'urgentScore', 'despawnTicks', 'safetyMarginTicks', 'maxDistance']; for (const field of integerFields) if (!Number.isInteger(value[field])) throw new ValidationError(`Recovery setting '${field}' must be an integer`); if (value.maxAttempts < 1 || value.maxAttempts > 10) throw new ValidationError('Recovery maxAttempts must be between 1 and 10'); if (value.optionalScore < 0 || value.optionalScore > value.minScore || value.minScore > value.urgentScore || value.urgentScore > 100) throw new ValidationError('Recovery score thresholds must satisfy 0 <= optionalScore <= minScore <= urgentScore <= 100'); if (value.despawnTicks < 1200 || value.despawnTicks > 72_000 || value.safetyMarginTicks < 0 || value.safetyMarginTicks >= value.despawnTicks) throw new ValidationError('Recovery despawn tick budget or safety margin is invalid'); if (value.maxDistance < 16 || value.maxDistance > 100_000) throw new ValidationError('Recovery maxDistance must be between 16 and 100000'); if (!Number.isFinite(value.dangerLimit) || value.dangerLimit < 0 || value.dangerLimit > 1) throw new ValidationError('Recovery dangerLimit must be between 0 and 1'); }
function validateSurvival(value) { for (const field of ['enabled', 'autoEquipArmor', 'preferProtection', 'preferDurability', 'allowBindingCurse', 'allowAnimalKill']) if (typeof value[field] !== 'boolean') throw new ValidationError(`Survival setting '${field}' must be a boolean`); for (const [field, minimum, maximum] of [['minimumDurabilityPercent', 0, 100], ['minimumSheepReserve', 0, 100], ['minimumCowReserve', 0, 100], ['interactionCooldownMs', 100, 10_000], ['entitySearchDistance', 4, 128]]) if (!Number.isInteger(value[field]) || value[field] < minimum || value[field] > maximum) throw new ValidationError(`Survival setting '${field}' must be an integer between ${minimum} and ${maximum}`); }
