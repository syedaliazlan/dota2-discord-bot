import dotenv from 'dotenv';
import { logger } from './logger.js';

dotenv.config();

/**
 * Load and validate configuration
 */
export function loadConfig() {
  const required = [
    'DISCORD_BOT_TOKEN',
    'DISCORD_CHANNEL_ID',
    'STEAM_ACCOUNT_ID'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Parse friends list from JSON string in .env
  let friendsList = {};
  if (process.env.FRIENDS_LIST) {
    try {
      friendsList = JSON.parse(process.env.FRIENDS_LIST);
    } catch (error) {
      logger.warn('Failed to parse FRIENDS_LIST, using empty object:', error.message);
    }
  }

  // Add the main account to friends list if not already present
  const mainAccountId = process.env.STEAM_ACCOUNT_ID;
  const mainAccountName = process.env.MAIN_ACCOUNT_NAME || 'You';
  
  if (mainAccountId && !Object.values(friendsList).some(ids => Array.isArray(ids) && ids.includes(mainAccountId))) {
    if (!friendsList[mainAccountName]) {
      friendsList[mainAccountName] = [mainAccountId];
    } else if (!friendsList[mainAccountName].includes(mainAccountId)) {
      friendsList[mainAccountName].push(mainAccountId);
    }
  }

  // Parse daily summary times (format: "HH:MM" in 24-hour format, UK timezone)
  const parseTime = (timeStr, defaultHour, defaultMinute) => {
    if (!timeStr) return { hour: defaultHour, minute: defaultMinute };
    const parts = timeStr.split(':');
    if (parts.length === 2) {
      const hour = parseInt(parts[0], 10);
      const minute = parseInt(parts[1], 10);
      if (!isNaN(hour) && !isNaN(minute) && hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
        return { hour, minute };
      }
    }
    return { hour: defaultHour, minute: defaultMinute };
  };

  const weekdayTime = parseTime(process.env.DAILY_SUMMARY_WEEKDAY_TIME, 3, 0);
  const weekendTime = parseTime(process.env.DAILY_SUMMARY_WEEKEND_TIME, 22, 0);

  const config = {
    discord: {
      token: process.env.DISCORD_BOT_TOKEN,
      channelId: process.env.DISCORD_CHANNEL_ID
    },
    steam: {
      accountId: process.env.STEAM_ACCOUNT_ID
    },
    stratz: {
      apiToken: process.env.STRATZ_API_TOKEN || null
    },
    polling: {
      interval: parseInt(process.env.POLLING_INTERVAL || '5', 10) // minutes
    },
    cache: {
      file: process.env.CACHE_FILE || './data/state-cache.json'
    },
    friends: friendsList,
    dailySummary: {
      weekdayTime: weekdayTime,
      weekendTime: weekendTime,
      mainAccountName: mainAccountName
    }
  };

  logger.info('Configuration loaded successfully');
  logger.info(`Loaded ${Object.keys(friendsList).length} friends from configuration`);
  
  // Log logging configuration
  const logLevel = process.env.LOG_LEVEL || 'INFO';
  const isDetailed = logLevel.toUpperCase().includes('_DETAILED') || logLevel.toUpperCase() === 'DEBUG';
  const logMode = isDetailed ? 'detailed' : 'minimal';
  logger.info(`Log level: ${logLevel} (${logMode} mode)`);
  
  return config;
}

