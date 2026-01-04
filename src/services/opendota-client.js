import axios from 'axios';
import { logger } from '../utils/logger.js';

/**
 * OpenDota API client
 * Handles all API requests to OpenDota with rate limiting
 */
export class OpenDotaClient {
  constructor(baseUrl, apiKey = null) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.apiKeyValid = apiKey !== null && apiKey !== ''; // Track if API key is valid
    // Free tier: 60 calls/min, Premium: 3000 calls/min
    // Without key: 1 req/sec (60/min), with key: can go faster
    this.rateLimitDelay = (this.apiKeyValid) ? 20 : 1000; // 20ms = 50 req/sec, 1000ms = 1 req/sec
    this.lastRequestTime = 0;

    // Create axios instance with default config
    // Reduced timeout to 8s to leave buffer for Discord's 3s response window
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 8000
    });
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
   * Make API request with error handling and retry logic
   */
  async request(endpoint, retries = 3) {
    await this.waitForRateLimit();

    // Add API key as query parameter if available and valid
    const separator = endpoint.includes('?') ? '&' : '?';
    const useApiKey = this.apiKeyValid && this.apiKey;
    const url = useApiKey ? `${endpoint}${separator}api_key=${this.apiKey}` : endpoint;

    for (let i = 0; i < retries; i++) {
      try {
        const response = await this.client.get(url);
        return response.data;
      } catch (error) {
        if (error.response) {
          // Check for invalid API key error
          if (error.response.status === 400 && 
              error.response.data && 
              typeof error.response.data === 'object' &&
              error.response.data.error &&
              error.response.data.error.includes('API key invalid')) {
            // API key is invalid, disable it and retry without key
            if (this.apiKeyValid) {
              logger.warn('API key is invalid, falling back to free tier (no API key)');
              this.apiKeyValid = false;
              this.rateLimitDelay = 1000; // Switch to free tier rate limit
              // Retry immediately without API key
              const urlWithoutKey = endpoint;
              try {
                const response = await this.client.get(urlWithoutKey);
                return response.data;
              } catch (retryError) {
                // If retry also fails, continue with normal error handling
                logger.error(`API request failed after API key fallback:`, retryError.message);
              }
            }
          }
          
          // API error
          if (error.response.status === 429) {
            // Rate limited, wait longer
            logger.warn('Rate limited, waiting...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
          if (error.response.status === 404) {
            logger.warn(`Resource not found: ${endpoint}`);
            return null;
          }
        }
        
        logger.error(`API request failed (attempt ${i + 1}/${retries}):`, error.message);
        
        if (i === retries - 1) {
          throw error;
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }
  }

  /**
   * Get player profile data
   */
  async getPlayer(accountId) {
    logger.debug(`Fetching player data for account ${accountId}`);
    return await this.request(`/players/${accountId}`);
  }

  /**
   * Get recent matches for a player using /recentMatches endpoint
   * Note: This endpoint sometimes returns incorrect hero_id
   */
  async getRecentMatches(accountId, limit = 10) {
    logger.debug(`Fetching recent matches for account ${accountId}`);
    return await this.request(`/players/${accountId}/recentMatches?limit=${limit}`);
  }

  /**
   * Get matches for a player using /matches endpoint with select
   * This endpoint may have more accurate data than /recentMatches
   * @param {string} accountId - Player account ID
   * @param {number} limit - Number of matches to return
   * @param {number} offset - Offset for pagination
   */
  async getPlayerMatches(accountId, limit = 10, offset = 0) {
    logger.debug(`Fetching matches for account ${accountId}`);
    // Using the /matches endpoint with select to get player-specific match data
    // This should include the players array with accurate hero_id
    return await this.request(`/players/${accountId}/matches?limit=${limit}&offset=${offset}`);
  }

  /**
   * Get player statistics totals
   */
  async getPlayerTotals(accountId) {
    logger.debug(`Fetching player totals for account ${accountId}`);
    return await this.request(`/players/${accountId}/totals`);
  }

  /**
   * Get hero statistics for a player
   */
  async getPlayerHeroes(accountId) {
    logger.debug(`Fetching hero stats for account ${accountId}`);
    return await this.request(`/players/${accountId}/heroes`);
  }

  /**
   * Get live matches
   */
  async getLiveMatches() {
    logger.debug('Fetching live matches');
    return await this.request('/live');
  }

  /**
   * Get match details
   */
  async getMatch(matchId) {
    logger.debug(`Fetching match ${matchId}`);
    return await this.request(`/matches/${matchId}`);
  }

  /**
   * Get player win/loss record
   */
  async getPlayerWinLoss(accountId) {
    logger.debug(`Fetching win/loss for account ${accountId}`);
    return await this.request(`/players/${accountId}/wl`);
  }

  /**
   * Get player rankings
   */
  async getPlayerRankings(accountId) {
    logger.debug(`Fetching rankings for account ${accountId}`);
    return await this.request(`/players/${accountId}/rankings`);
  }

  /**
   * Get all heroes list from OpenDota
   * This provides the authoritative hero_id to name mapping
   */
  async getHeroes() {
    logger.debug('Fetching heroes list');
    return await this.request('/heroes');
  }
}

