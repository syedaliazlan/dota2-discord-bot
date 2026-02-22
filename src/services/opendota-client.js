import axios from 'axios';
import { logger } from '../utils/logger.js';

/**
 * OpenDota REST API client
 * Used primarily for multi-kill detection via the parsed match `multi_kills` field
 *
 * Rate Limits (Free Tier):
 * - 60 requests/minute
 * - 50,000 requests/month
 *
 * Parse requests count as 10 API calls for rate limiting
 */
export class OpenDotaClient {
  constructor(apiKey = null) {
    this.baseUrl = 'https://api.opendota.com/api';
    this.apiKey = apiKey;
    // 60 req/min = 1 req/sec, use 1.1s to be safe
    this.rateLimitDelay = 1100;
    this.lastRequestTime = 0;
  }

  /**
   * Rate limiting helper
   */
  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Make an API request with rate limiting and retries
   */
  async request(method, endpoint, retries = 2) {
    await this.waitForRateLimit();

    const url = `${this.baseUrl}${endpoint}`;
    const params = this.apiKey ? { api_key: this.apiKey } : {};

    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios({
          method,
          url,
          params,
          timeout: 15000,
          headers: { 'Accept': 'application/json' }
        });
        return response.data;
      } catch (error) {
        if (error.response?.status === 429) {
          logger.warn('OpenDota rate limited, waiting 5s...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        if (error.response?.status === 404) {
          return null; // Match not found
        }
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  /**
   * Get match details from OpenDota
   * Returns full match data including multi_kills for parsed matches
   */
  async getMatch(matchId) {
    try {
      logger.debug(`OpenDota: Fetching match ${matchId}`);
      const data = await this.request('get', `/matches/${matchId}`);
      if (data) {
        const parsed = this.isMatchParsed(data);
        logger.debug(`OpenDota: getMatch(${matchId}): found, parsed=${parsed}, players=${data.players?.length}`);
      } else {
        logger.debug(`OpenDota: getMatch(${matchId}): not found (null)`);
      }
      return data;
    } catch (error) {
      logger.warn(`OpenDota getMatch failed for ${matchId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Request match parsing on OpenDota
   * Parsed matches will have multi_kills, kills_log, etc.
   * Note: costs 10 API calls for rate limiting purposes
   */
  async requestParse(matchId) {
    try {
      logger.debug(`OpenDota: Requesting parse for match ${matchId}`);
      const result = await this.request('post', `/request/${matchId}`);
      if (result) {
        logger.info(`OpenDota: Parse requested for match ${matchId}`);
      }
      return result;
    } catch (error) {
      logger.warn(`OpenDota parse request failed for ${matchId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if a match is parsed on OpenDota
   * A match is considered parsed if the version field exists or players have multi_kills data
   */
  isMatchParsed(matchData) {
    if (!matchData) return false;

    // version field is set for parsed matches
    if (matchData.version != null) return true;

    // Check if any player has parsed-only fields
    if (matchData.players?.some(p => p.multi_kills !== undefined || p.kills_log !== undefined)) {
      return true;
    }

    return false;
  }

  /**
   * Get multi-kill data for a specific player from an OpenDota match
   * Returns { tripleKills, ultraKills, rampages, parsed } or null if data unavailable
   *
   * multi_kills field format: { "2": count, "3": count, "4": count, "5": count }
   *   2 = Double Kill, 3 = Triple Kill, 4 = Ultra Kill, 5 = Rampage
   */
  getMultiKillsForPlayer(matchData, accountId) {
    if (!matchData?.players) return null;

    const accountIdNum = parseInt(accountId, 10);
    const player = matchData.players.find(p => {
      const pId = typeof p.account_id === 'string' ? parseInt(p.account_id, 10) : p.account_id;
      return pId === accountIdNum;
    });

    if (!player) {
      logger.debug(`Player ${accountId} not found in OpenDota match. Available IDs: ${matchData.players?.map(p => p.account_id).join(', ')}`);
      return null;
    }

    // Check if match is parsed
    const isParsed = this.isMatchParsed(matchData);

    if (!isParsed) {
      logger.debug(`OpenDota: match not parsed yet, multi_kills unavailable for player ${accountId}`);
      return null;
    }

    // Match is parsed - read multi_kills (may be empty object {} if no multi-kills)
    const multiKills = player.multi_kills || {};
    logger.debug(`OpenDota: getMultiKillsForPlayer(${accountId}): multi_kills=${JSON.stringify(multiKills)}, hero=${player.hero_id}`);

    return {
      tripleKills: multiKills['3'] || 0,
      ultraKills: multiKills['4'] || 0,
      rampages: multiKills['5'] || 0,
      parsed: true,
      heroId: player.hero_id,
      kills: player.kills || 0,
      deaths: player.deaths || 0,
      assists: player.assists || 0,
      win: player.player_slot < 128 ? matchData.radiant_win : !matchData.radiant_win
    };
  }

  /**
   * Get player rank from OpenDota as fallback for stale STRATZ data
   */
  async getPlayerRank(accountId) {
    try {
      logger.debug(`OpenDota: Fetching rank for account ${accountId}`);
      const data = await this.request('get', `/players/${accountId}`);
      if (!data) return null;

      return {
        rank: data.rank_tier,
        leaderboardRank: data.leaderboard_rank || null
      };
    } catch (error) {
      logger.debug(`OpenDota rank fetch failed for ${accountId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Test API connectivity
   */
  async testConnection() {
    try {
      const data = await this.request('get', '/health');
      return true;
    } catch (error) {
      // /health might not exist, try a simple endpoint
      try {
        const heroes = await this.request('get', '/heroes');
        return heroes && heroes.length > 0;
      } catch (e) {
        return false;
      }
    }
  }
}
