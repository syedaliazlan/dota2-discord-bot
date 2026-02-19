import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * State cache manager to track last known state and prevent duplicate notifications
 */
export class StateCache {
  constructor(cacheFile) {
    this.cacheFile = cacheFile;
    this.cache = {
      lastMatchId: null,
      lastChecked: null,
      playerStats: null,
      achievements: null,
      lastLiveMatchId: null,
      lastDailySummary: null,
      dailyMatches: [],
      detectedRampages: [], // Track detected rampages to avoid duplicates
      detectedMultiKills: [] // Track all multi-kills (triple, ultra, rampage) to avoid duplicates
    };
  }

  /**
   * Load cache from file
   */
  async load() {
    try {
      const dir = path.dirname(this.cacheFile);
      await fs.mkdir(dir, { recursive: true });
      
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      this.cache = JSON.parse(data);
      logger.info('State cache loaded from file');
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('No existing cache file found, starting fresh');
      } else {
        logger.warn('Failed to load cache file:', error.message);
      }
    }
  }

  /**
   * Save cache to file
   */
  async save() {
    try {
      const dir = path.dirname(this.cacheFile);
      await fs.mkdir(dir, { recursive: true });
      
      this.cache.lastChecked = new Date().toISOString();
      await fs.writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      logger.error('Failed to save cache file:', error.message);
    }
  }

  /**
   * Get last known match ID
   */
  getLastMatchId() {
    return this.cache.lastMatchId;
  }

  /**
   * Update last match ID
   */
  setLastMatchId(matchId) {
    this.cache.lastMatchId = matchId;
  }

  /**
   * Get cached player stats
   */
  getPlayerStats() {
    return this.cache.playerStats;
  }

  /**
   * Update cached player stats
   */
  setPlayerStats(stats) {
    this.cache.playerStats = stats;
  }

  /**
   * Get cached achievements
   */
  getAchievements() {
    return this.cache.achievements;
  }

  /**
   * Update cached achievements
   */
  setAchievements(achievements) {
    this.cache.achievements = achievements;
  }

  /**
   * Check if match is new (not in cache)
   */
  isNewMatch(matchId) {
    return this.cache.lastMatchId === null || matchId > this.cache.lastMatchId;
  }

  /**
   * Compare stats and return changes
   */
  compareStats(newStats) {
    const oldStats = this.cache.playerStats;
    if (!oldStats) return { changed: true, changes: [] };

    const changes = [];
    
    // Compare key stats
    const statKeys = ['wins', 'losses', 'win_rate', 'mmr', 'rank_tier'];
    for (const key of statKeys) {
      if (oldStats[key] !== newStats[key]) {
        changes.push({
          key,
          old: oldStats[key],
          new: newStats[key]
        });
      }
    }

    return {
      changed: changes.length > 0,
      changes
    };
  }

  /**
   * Get last daily summary timestamp
   */
  getLastDailySummary() {
    return this.cache.lastDailySummary;
  }

  /**
   * Set last daily summary timestamp
   */
  setLastDailySummary(timestamp) {
    this.cache.lastDailySummary = timestamp;
  }

  /**
   * Add match to daily tracking
   */
  addDailyMatch(match) {
    if (!this.cache.dailyMatches) {
      this.cache.dailyMatches = [];
    }
    this.cache.dailyMatches.push(match);
  }

  /**
   * Get daily matches
   */
  getDailyMatches() {
    return this.cache.dailyMatches || [];
  }

  /**
   * Clear daily matches (after summary sent)
   */
  clearDailyMatches() {
    this.cache.dailyMatches = [];
  }

  /**
   * Generic getter
   */
  get(key) {
    return this.cache[key];
  }

  /**
   * Generic setter
   */
  set(key, value) {
    this.cache[key] = value;
  }

  /**
   * Check if rampage was already detected
   */
  isRampageDetected(matchId, accountId) {
    if (!this.cache.detectedRampages) {
      this.cache.detectedRampages = [];
    }
    return this.cache.detectedRampages.some(
      r => r.matchId === matchId && r.accountId === accountId
    );
  }

  /**
   * Mark rampage as detected
   */
  markRampageDetected(matchId, accountId, playerName) {
    if (!this.cache.detectedRampages) {
      this.cache.detectedRampages = [];
    }
    this.cache.detectedRampages.push({
      matchId,
      accountId,
      playerName,
      detectedAt: new Date().toISOString()
    });
    
    // Keep only last 100 rampages to prevent cache from growing too large
    if (this.cache.detectedRampages.length > 100) {
      this.cache.detectedRampages = this.cache.detectedRampages.slice(-100);
    }
  }

  /**
   * Check if a multi-kill was already detected
   */
  isMultiKillDetected(matchId, accountId, killType) {
    if (!this.cache.detectedMultiKills) {
      this.cache.detectedMultiKills = [];
    }
    return this.cache.detectedMultiKills.some(
      mk => mk.matchId === matchId && mk.accountId === accountId && mk.killType === killType
    );
  }

  /**
   * Mark a multi-kill as detected
   */
  markMultiKillDetected(matchId, accountId, playerName, killType) {
    if (!this.cache.detectedMultiKills) {
      this.cache.detectedMultiKills = [];
    }
    this.cache.detectedMultiKills.push({
      matchId,
      accountId,
      playerName,
      killType,
      detectedAt: new Date().toISOString()
    });

    // Keep only last 200 entries to prevent cache from growing too large
    if (this.cache.detectedMultiKills.length > 200) {
      this.cache.detectedMultiKills = this.cache.detectedMultiKills.slice(-200);
    }
  }
}

