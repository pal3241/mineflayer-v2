import { ValidationError } from './errors.js';

const bool = value => String(value).toLowerCase() === 'true';
const integer = (value, fallback) => value === undefined ? fallback : Number.parseInt(value, 10);

export function loadConfig(env = process.env) {
  const profile = env.MINEHIVE_PROFILE ?? 'development';
  const config = {
    profile,
    log: { level: env.MINEHIVE_LOG_LEVEL ?? 'info', directory: env.MINEHIVE_LOG_DIRECTORY, maxFiles: 3 },
    api: { host: env.MINEHIVE_API_HOST ?? '127.0.0.1', port: integer(env.MINEHIVE_API_PORT, 3000), token: env.MINEHIVE_API_TOKEN || null, rateLimitPerMinute: integer(env.MINEHIVE_API_RATE_LIMIT_PER_MINUTE, 120) },
    dataPath: env.MINEHIVE_DATA_PATH ?? './data',
    database: { driver: env.MINEHIVE_DATABASE_DRIVER ?? (profile === 'production' ? 'sqlite' : 'json'), file: env.MINEHIVE_DATABASE_FILE ?? './data/minehive.sqlite' },
    semanticMemory: { maxRecords: integer(env.MINEHIVE_MEMORY_MAX_RECORDS, 10_000), dimensions: integer(env.MINEHIVE_EMBEDDING_DIMENSIONS, 256) },
    ml: { minimumSamples: integer(env.MINEHIVE_ML_MINIMUM_SAMPLES, 10) },
    hive: { heartbeatTimeoutMs: integer(env.MINEHIVE_HIVE_HEARTBEAT_TIMEOUT_MS, 30_000) },
    autonomy: { enabled: bool(env.MINEHIVE_AUTONOMY_ENABLED ?? false), intervalMs: integer(env.MINEHIVE_AUTONOMY_INTERVAL_MS, 60_000), maxActionsPerHour: integer(env.MINEHIVE_AUTONOMY_MAX_ACTIONS_PER_HOUR, 20) },
    bot: {
      host: env.MINEHIVE_HOST ?? 'localhost', port: integer(env.MINEHIVE_PORT, 25565),
      username: env.MINEHIVE_USERNAME ?? 'MineHiveBot', auth: env.MINEHIVE_AUTH ?? 'offline',
      version: env.MINEHIVE_VERSION || undefined, autoConnect: bool(env.MINEHIVE_AUTO_CONNECT ?? false),
      reconnect: { enabled: bool(env.MINEHIVE_RECONNECT ?? true), maxAttempts: integer(env.MINEHIVE_RECONNECT_ATTEMPTS, 5), delayMs: integer(env.MINEHIVE_RECONNECT_DELAY_MS, 3000) },
      autoEat: { enabled: bool(env.MINEHIVE_AUTO_EAT ?? true), minHunger: integer(env.MINEHIVE_AUTO_EAT_MIN_HUNGER, 15) }
    },
    commands: { enabled: bool(env.MINEHIVE_CHAT_COMMANDS ?? true), admins: (env.MINEHIVE_ADMINS ?? '').split(',').map(value => value.trim()).filter(Boolean) },
    viewer: { basePort: integer(env.MINEHIVE_VIEWER_BASE_PORT, 3100), viewDistance: integer(env.MINEHIVE_VIEWER_DISTANCE, 4) },
    llm: { provider: env.MINEHIVE_LLM_PROVIDER ?? 'auto', endpoint: env.MINEHIVE_LLM_ENDPOINT, apiKey: env.OPENROUTER_API_KEY, apiKeys: [env.OPENROUTER_API_KEY_1, env.OPENROUTER_API_KEY_2, env.OPENROUTER_API_KEY_3, env.OPENROUTER_API_KEY].filter(Boolean), model: env.MINEHIVE_LLM_MODEL ?? 'openrouter/auto', siteUrl: env.MINEHIVE_SITE_URL,
      localEndpoint: env.MINEHIVE_LOCAL_LLM_ENDPOINT, localApiKey: env.MINEHIVE_LOCAL_LLM_API_KEY, localModel: env.MINEHIVE_LOCAL_LLM_MODEL, localStructuredOutput: bool(env.MINEHIVE_LOCAL_LLM_STRUCTURED ?? false), timeoutMs: integer(env.MINEHIVE_LLM_TIMEOUT_MS, 30_000) }
  };
  if (!Number.isInteger(config.api.port) || config.api.port < 1 || config.api.port > 65535) throw new ValidationError('Invalid API port');
  if (!Number.isInteger(config.api.rateLimitPerMinute) || config.api.rateLimitPerMinute < 10) throw new ValidationError('API rate limit must be at least 10 requests per minute');
  if (!Number.isInteger(config.bot.port) || config.bot.port < 1 || config.bot.port > 65535) throw new ValidationError('Invalid Minecraft port');
  if (config.bot.reconnect.maxAttempts < 0 || config.bot.reconnect.delayMs < 0) throw new ValidationError('Invalid reconnect policy');
  if (config.viewer.basePort < 1 || config.viewer.basePort > 65000) throw new ValidationError('Invalid viewer base port');
  if (!['json', 'sqlite'].includes(config.database.driver)) throw new ValidationError('MINEHIVE_DATABASE_DRIVER must be json or sqlite');
  if (config.semanticMemory.maxRecords < 100 || config.semanticMemory.dimensions < 16) throw new ValidationError('Invalid semantic memory limits');
  if (config.ml.minimumSamples < 2) throw new ValidationError('Invalid ML minimum sample count');
  if (config.hive.heartbeatTimeoutMs < 1000) throw new ValidationError('Invalid HiveMind heartbeat timeout');
  if (config.autonomy.intervalMs < 5000 || config.autonomy.maxActionsPerHour < 1) throw new ValidationError('Invalid autonomy limits');
  if (!['development', 'test', 'staging', 'production'].includes(config.profile)) throw new ValidationError('Invalid MINEHIVE_PROFILE');
  if (config.profile === 'production' && !config.api.token) throw new ValidationError('MINEHIVE_API_TOKEN is required in production');
  return Object.freeze(config);
}
