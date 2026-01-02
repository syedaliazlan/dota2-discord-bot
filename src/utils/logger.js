/**
 * Simple logger utility for the bot
 */

const logLevels = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Load LOG_LEVEL from env, default to INFO
// Note: This is read at module load time, so dotenv must be configured first
// Supports: ERROR, WARN, INFO, DEBUG (minimal mode)
//           ERROR_DETAILED, WARN_DETAILED, INFO_DETAILED, DEBUG_DETAILED (detailed mode)
//           Or just DEBUG automatically enables detailed mode
const logLevelEnv = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
const isDetailedMode = logLevelEnv.includes('_DETAILED') || logLevelEnv === 'DEBUG';
const currentLevel = logLevelEnv.replace('_DETAILED', '');

function log(level, message, ...args) {
  if (logLevels[level] <= logLevels[currentLevel]) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;
    console.log(prefix, message, ...args);
  }
}

export const logger = {
  error: (message, ...args) => log('ERROR', message, ...args),
  warn: (message, ...args) => log('WARN', message, ...args),
  info: (message, ...args) => log('INFO', message, ...args),
  debug: (message, ...args) => log('DEBUG', message, ...args),
  
  // Check if detailed logging is enabled
  isDetailed: () => isDetailedMode,
  
  // Detailed logging methods (only log if detailed mode is enabled)
  detail: (message, ...args) => {
    if (isDetailedMode) {
      log('DEBUG', message, ...args);
    }
  },
  
  detailInfo: (message, ...args) => {
    if (isDetailedMode) {
      log('INFO', message, ...args);
    }
  }
};

