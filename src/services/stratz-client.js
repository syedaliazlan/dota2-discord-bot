import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logger } from '../utils/logger.js';

/**
 * STRATZ GraphQL API client
 * Provides all Dota 2 data through a single, fast API
 * 
 * Rate Limits (Free Tier):
 * - 20 calls/second
 * - 250 calls/minute
 * - 2,000 calls/hour
 * - 10,000 calls/day
 * 
 * Proxy Failover:
 * - Supports multiple residential proxies for reliability
 * - Automatically switches to next proxy on failure (403, timeout, connection error)
 * - Failed proxies are temporarily marked as bad and retried after cooldown
 */
export class StratzClient {
  constructor(apiToken, proxies = []) {
    this.baseUrl = 'https://api.stratz.com/graphql';
    this.apiToken = apiToken;
    
    // Proxy configuration
    this.proxies = Array.isArray(proxies) ? proxies : (proxies ? [proxies] : []);
    this.currentProxyIndex = 0;
    this.badProxies = new Map(); // Map<proxyUrl, timestamp when marked bad>
    this.proxyCooldown = 5 * 60 * 1000; // 5 minutes before retrying a bad proxy
    
    // Rate limiting: 20 req/sec = 50ms between requests (being conservative)
    this.rateLimitDelay = 50;
    this.lastRequestTime = 0;

    // Base axios config (without proxy - added per-request)
    this.baseAxiosConfig = {
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
        'User-Agent': 'STRATZ_API'
      }
    };

    if (this.proxies.length > 0) {
      logger.info(`STRATZ client configured with ${this.proxies.length} residential proxies (failover enabled)`);
    } else {
      logger.warn('STRATZ client running without proxy - may be blocked on datacenter IPs');
    }
  }

  /**
   * Get the next available proxy URL, skipping bad ones
   * Returns null if no proxies available
   */
  getNextProxy() {
    if (this.proxies.length === 0) return null;

    const now = Date.now();
    let attempts = 0;
    
    while (attempts < this.proxies.length) {
      const proxyUrl = this.proxies[this.currentProxyIndex];
      const badSince = this.badProxies.get(proxyUrl);
      
      // Check if proxy was marked bad but cooldown has passed
      if (badSince && (now - badSince) > this.proxyCooldown) {
        this.badProxies.delete(proxyUrl);
        logger.debug(`Proxy ${this.currentProxyIndex + 1} cooldown expired, retrying`);
      }
      
      // If proxy is not bad, use it
      if (!this.badProxies.has(proxyUrl)) {
        return proxyUrl;
      }
      
      // Move to next proxy
      this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
      attempts++;
    }
    
    // All proxies are bad, clear the oldest one and use it
    logger.warn('All proxies marked as bad, clearing oldest and retrying');
    let oldestProxy = null;
    let oldestTime = Infinity;
    for (const [proxy, time] of this.badProxies) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestProxy = proxy;
      }
    }
    if (oldestProxy) {
      this.badProxies.delete(oldestProxy);
      return oldestProxy;
    }
    
    return this.proxies[0];
  }

  /**
   * Mark current proxy as bad and switch to next
   */
  markCurrentProxyBad() {
    if (this.proxies.length === 0) return;
    
    const badProxy = this.proxies[this.currentProxyIndex];
    this.badProxies.set(badProxy, Date.now());
    
    const oldIndex = this.currentProxyIndex;
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
    
    // Mask password in logs
    const maskedProxy = badProxy.replace(/:[^:@]+@/, ':***@');
    logger.warn(`Proxy ${oldIndex + 1} marked as bad (${maskedProxy}), switching to proxy ${this.currentProxyIndex + 1}`);
  }

  /**
   * Create axios config with current proxy
   */
  createAxiosConfig() {
    const config = { ...this.baseAxiosConfig };
    
    const proxyUrl = this.getNextProxy();
    if (proxyUrl) {
      const proxyAgent = new HttpsProxyAgent(proxyUrl);
      config.httpsAgent = proxyAgent;
      config.httpAgent = proxyAgent;
      config.proxy = false;
    }
    
    return config;
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
   * Check if an error is proxy-related and should trigger failover
   */
  isProxyError(error) {
    // 403 Forbidden - Cloudflare blocking
    if (error.response?.status === 403) return true;
    
    // Connection errors
    if (error.code === 'ECONNREFUSED') return true;
    if (error.code === 'ECONNRESET') return true;
    if (error.code === 'ENOTFOUND') return true;
    if (error.code === 'ETIMEDOUT') return true;
    
    // Proxy-specific errors
    if (error.message?.includes('proxy')) return true;
    if (error.message?.includes('socket hang up')) return true;
    
    return false;
  }

  /**
   * Execute GraphQL query with proxy failover
   */
  async query(queryString, variables = {}, retries = 3) {
    await this.waitForRateLimit();

    const startTime = Date.now();
    let proxyAttempts = 0;
    const maxProxyAttempts = Math.min(this.proxies.length, 5); // Try up to 5 different proxies
    
    for (let i = 0; i < retries; i++) {
      try {
        // Create axios instance with current proxy config
        const axiosConfig = this.createAxiosConfig();
        const client = axios.create(axiosConfig);
        
        const response = await client.post('', {
          query: queryString,
          variables
        });

        const duration = Date.now() - startTime;
        
        // Check if response is HTML (Cloudflare block page) instead of JSON
        if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE')) {
          logger.warn('Received HTML instead of JSON - likely Cloudflare block');
          if (this.proxies.length > 0 && proxyAttempts < maxProxyAttempts) {
            this.markCurrentProxyBad();
            proxyAttempts++;
            i--; // Don't count this as a regular retry
            continue;
          }
          throw new Error('STRATZ returned Cloudflare block page');
        }
        
        if (response.data.errors) {
          const errorMessages = response.data.errors.map(e => e.message).join(', ');
          logger.warn(`GraphQL errors: ${errorMessages}`);
        }
        
        logger.debug(`STRATZ query completed (${duration}ms)`);
        return response.data.data;
      } catch (error) {
        // Check if this is a proxy-related error
        if (this.isProxyError(error) && this.proxies.length > 0 && proxyAttempts < maxProxyAttempts) {
          logger.warn(`Proxy error detected: ${error.message}`);
          this.markCurrentProxyBad();
          proxyAttempts++;
          i--; // Don't count proxy failover as a regular retry
          continue;
        }
        
        if (error.response) {
          if (error.response.status === 429) {
            logger.warn('Rate limited by STRATZ, waiting...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
          if (error.response.status === 401) {
            logger.error('STRATZ API authentication failed - check your API token');
            throw error;
          }
        }
        
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
          logger.warn(`STRATZ request timed out (attempt ${i + 1}/${retries})`);
        } else {
          logger.error(`STRATZ request failed (attempt ${i + 1}/${retries}):`, error.message);
        }
        
        if (i === retries - 1) {
          throw error;
        }
        
        // Exponential backoff
        const backoffTime = Math.pow(2, i) * 1000;
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }

  // ==================== Player Queries ====================

  /**
   * Get player profile data
   */
  async getPlayer(accountId) {
    logger.debug(`Fetching player data for account ${accountId}`);
    
    const query = `
      query GetPlayer($steamAccountId: Long!) {
        player(steamAccountId: $steamAccountId) {
          steamAccountId
          steamAccount {
            id
            name
            avatar
            profileUri
            seasonRank
            seasonLeaderboardRank
            smurfFlag
            isAnonymous
          }
          matchCount
          winCount
          firstMatchDate
          lastMatchDate
          behaviorScore
        }
      }
    `;

    const data = await this.query(query, { steamAccountId: parseInt(accountId) });
    const player = data?.player;
    logger.debug(`getPlayer(${accountId}): ${player ? `name=${player.steamAccount?.name}, rank=${player.steamAccount?.seasonRank}` : 'null'}`);
    return player;
  }

  /**
   * Get player's recent matches
   */
  async getRecentMatches(accountId, limit = 10) {
    logger.debug(`Fetching recent matches for account ${accountId}`);
    
    const query = `
      query GetRecentMatches($steamAccountId: Long!, $take: Int!) {
        player(steamAccountId: $steamAccountId) {
          matches(request: { take: $take }) {
            id
            didRadiantWin
            durationSeconds
            startDateTime
            gameMode
            lobbyType
            players(steamAccountId: $steamAccountId) {
              steamAccountId
              heroId
              isRadiant
              kills
              deaths
              assists
              goldPerMinute
              experiencePerMinute
              numLastHits
              numDenies
              imp
              award
            }
          }
        }
      }
    `;

    const data = await this.query(query, {
      steamAccountId: parseInt(accountId),
      take: limit
    });

    const matches = data?.player?.matches || [];
    logger.debug(`getRecentMatches(${accountId}, limit=${limit}): returned ${matches.length} matches${matches.length > 0 ? `, IDs: [${matches.map(m => m.id).join(', ')}]` : ''}`);
    return matches;
  }

  /**
   * Get player matches for a specific time range (for daily summaries)
   * Fetches recent matches and filters by timestamp in code for reliability
   */
  async getPlayerMatchesSince(accountId, sinceTimestamp, limit = 50) {
    logger.debug(`Fetching matches since ${new Date(sinceTimestamp * 1000).toISOString()} for account ${accountId}`);

    // Fetch a large batch of recent matches and filter client-side by timestamp
    // Using take=200 to ensure we capture all matches within a 20-hour window
    const fetchLimit = Math.max(limit, 200);
    const query = `
      query GetMatchesSince($steamAccountId: Long!, $take: Int!) {
        player(steamAccountId: $steamAccountId) {
          matches(request: { take: $take }) {
            id
            didRadiantWin
            durationSeconds
            startDateTime
            gameMode
            lobbyType
            players(steamAccountId: $steamAccountId) {
              steamAccountId
              heroId
              isRadiant
              kills
              deaths
              assists
              goldPerMinute
              experiencePerMinute
              numLastHits
              numDenies
              imp
              award
            }
          }
        }
      }
    `;

    const data = await this.query(query, {
      steamAccountId: parseInt(accountId),
      take: fetchLimit
    });

    const allMatches = data?.player?.matches || [];
    const filtered = allMatches.filter(match => match.startDateTime >= sinceTimestamp);

    // Diagnostic logging: show what STRATZ returned vs what passed the filter
    logger.info(`getPlayerMatchesSince(${accountId}): STRATZ returned ${allMatches.length} total matches, ${filtered.length} match(es) after ${new Date(sinceTimestamp * 1000).toISOString()}`);
    if (allMatches.length > 0) {
      const oldest = allMatches[allMatches.length - 1];
      const newest = allMatches[0];
      logger.debug(`  STRATZ range: ${new Date(oldest.startDateTime * 1000).toISOString()} to ${new Date(newest.startDateTime * 1000).toISOString()}`);
    }
    if (filtered.length > 0) {
      logger.debug(`  Filtered match IDs: [${filtered.map(m => m.id).join(', ')}]`);
    }
    return filtered;
  }

  /**
   * Get player statistics totals
   */
  async getPlayerTotals(accountId) {
    logger.debug(`Fetching player totals for account ${accountId}`);
    
    const query = `
      query GetPlayerTotals($steamAccountId: Long!) {
        player(steamAccountId: $steamAccountId) {
          matchCount
          winCount
          simpleSummary {
            matchCount
          }
        }
      }
    `;

    const data = await this.query(query, { steamAccountId: parseInt(accountId) });
    logger.debug(`getPlayerTotals(${accountId}): matchCount=${data?.player?.matchCount}, winCount=${data?.player?.winCount}`);
    return data?.player;
  }

  /**
   * Get player win/loss record
   */
  async getPlayerWinLoss(accountId) {
    logger.debug(`Fetching win/loss for account ${accountId}`);
    
    const query = `
      query GetWinLoss($steamAccountId: Long!) {
        player(steamAccountId: $steamAccountId) {
          matchCount
          winCount
        }
      }
    `;

    const data = await this.query(query, { steamAccountId: parseInt(accountId) });

    if (data?.player) {
      const result = {
        win: data.player.winCount,
        lose: data.player.matchCount - data.player.winCount
      };
      logger.debug(`getPlayerWinLoss(${accountId}): W=${result.win}, L=${result.lose}`);
      return result;
    }
    logger.debug(`getPlayerWinLoss(${accountId}): no data returned`);
    return null;
  }

  /**
   * Get hero statistics for a player
   */
  async getPlayerHeroes(accountId) {
    logger.debug(`Fetching hero stats for account ${accountId}`);
    
    const query = `
      query GetPlayerHeroes($steamAccountId: Long!) {
        player(steamAccountId: $steamAccountId) {
          heroesPerformance {
            heroId
            matchCount
            winCount
            imp
            lastPlayedDateTime
          }
        }
      }
    `;

    const data = await this.query(query, { steamAccountId: parseInt(accountId) });
    const heroes = data?.player?.heroesPerformance || [];
    logger.debug(`getPlayerHeroes(${accountId}): returned ${heroes.length} heroes`);
    return heroes;
  }

  /**
   * Get player rankings
   */
  async getPlayerRankings(accountId) {
    logger.debug(`Fetching rankings for account ${accountId}`);
    
    const query = `
      query GetPlayerRankings($steamAccountId: Long!) {
        player(steamAccountId: $steamAccountId) {
          steamAccount {
            seasonRank
            seasonLeaderboardRank
          }
          dotaPlus {
            heroId
            level
          }
        }
      }
    `;

    const data = await this.query(query, { steamAccountId: parseInt(accountId) });
    logger.debug(`getPlayerRankings(${accountId}): rank=${data?.player?.steamAccount?.seasonRank}, leaderboard=${data?.player?.steamAccount?.seasonLeaderboardRank}`);
    return data?.player;
  }

  // ==================== Match Queries ====================

  /**
   * Get match details
   */
  async getMatch(matchId) {
    logger.debug(`Fetching match ${matchId}`);
    
    const query = `
      query GetMatch($matchId: Long!) {
        match(id: $matchId) {
          id
          didRadiantWin
          durationSeconds
          startDateTime
          endDateTime
          gameMode
          lobbyType
          regionId
          rank
          players {
            steamAccountId
            heroId
            isRadiant
            playerSlot
            kills
            deaths
            assists
            goldPerMinute
            experiencePerMinute
            numLastHits
            numDenies
            heroDamage
            towerDamage
            heroHealing
            gold
            level
            imp
            award
            stats {
              killEvents {
                time
                target
                isRadiant
              }
            }
          }
        }
      }
    `;

    const data = await this.query(query, { matchId: parseInt(matchId) });
    const match = data?.match;
    logger.debug(`getMatch(${matchId}): ${match ? `found, players=${match.players?.length}, duration=${match.durationSeconds}s` : 'not found'}`);
    return match;
  }

  /**
   * Get multiple matches at once
   */
  async getMatches(matchIds) {
    if (!matchIds || matchIds.length === 0) return [];
    
    logger.debug(`Fetching ${matchIds.length} matches`);
    
    const query = `
      query GetMatches($matchIds: [Long]!) {
        matches(ids: $matchIds) {
          id
          didRadiantWin
          durationSeconds
          startDateTime
          gameMode
          lobbyType
          players {
            steamAccountId
            heroId
            isRadiant
            kills
            deaths
            assists
            goldPerMinute
            experiencePerMinute
          }
        }
      }
    `;

    const data = await this.query(query, { matchIds: matchIds.map(id => parseInt(id)) });
    const matches = data?.matches || [];
    logger.debug(`getMatches(${matchIds.length} IDs): returned ${matches.length} matches`);
    return matches;
  }

  // ==================== Live Queries ====================

  /**
   * Get live matches
   */
  async getLiveMatches() {
    logger.debug('Fetching live matches');
    
    const query = `
      query GetLiveMatches {
        live {
          matches {
            matchId
            createdDateTime
            gameTime
            averageRank
            players {
              steamAccountId
              heroId
              isRadiant
              name
            }
          }
        }
      }
    `;

    const data = await this.query(query);
    const matches = data?.live?.matches || [];
    logger.debug(`getLiveMatches(): returned ${matches.length} live matches`);
    return matches;
  }

  /**
   * Check if a specific player is in a live match
   */
  async getPlayerLiveMatch(accountId) {
    const liveMatches = await this.getLiveMatches();
    const accountIdNum = parseInt(accountId);
    
    return liveMatches.find(match => 
      match.players?.some(player => player.steamAccountId === accountIdNum)
    );
  }

  // ==================== Constants Queries ====================

  /**
   * Get all heroes
   */
  async getHeroes() {
    logger.debug('Fetching heroes list');
    
    const query = `
      query GetHeroes {
        constants {
          heroes {
            id
            name
            displayName
            shortName
            aliases
          }
        }
      }
    `;

    const data = await this.query(query);
    return data?.constants?.heroes || [];
  }

  /**
   * Get hero meta statistics (win rates, pick rates)
   * Note: Bracket filtering removed due to API enum issues - shows all ranks
   */
  async getHeroMetaStats(bracket = null) {
    logger.debug(`Fetching hero meta stats for bracket: ${bracket || 'all'}`);
    
    // Use winWeek query which is reliable across all brackets
    const query = `
      query GetHeroMetaStats {
        heroStats {
          winWeek(take: 150) {
            heroId
            matchCount
            winCount
          }
        }
      }
    `;
    
    try {
      const data = await this.query(query, {});
      const weekStats = data?.heroStats?.winWeek || [];
      
      if (weekStats.length === 0) {
        logger.warn('No hero stats returned from winWeek query');
        return [];
      }
      
      // Get hero names to enrich the data
      const heroes = await this.getHeroes();
      const heroMap = new Map(heroes.map(h => [h.id, h.displayName || h.name]));
      
      // Process and calculate win rates
      return weekStats.map(stat => ({
        heroId: stat.heroId,
        heroName: heroMap.get(stat.heroId) || `Hero ${stat.heroId}`,
        matchCount: stat.matchCount,
        winCount: stat.winCount,
        winRate: stat.matchCount > 0 ? (stat.winCount / stat.matchCount) * 100 : 0
      }));
    } catch (error) {
      logger.error(`Hero meta stats query failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get player's current rank
   */
  async getPlayerRank(accountId) {
    logger.debug(`Fetching rank for account ${accountId}`);
    
    const query = `
      query GetPlayerRank($steamAccountId: Long!) {
        player(steamAccountId: $steamAccountId) {
          steamAccountId
          steamAccount {
            seasonRank
            seasonLeaderboardRank
            name
          }
        }
      }
    `;

    const data = await this.query(query, { steamAccountId: parseInt(accountId) });
    const player = data?.player;

    if (!player?.steamAccount) {
      logger.debug(`getPlayerRank(${accountId}): no steam account data`);
      return null;
    }

    const result = {
      accountId: player.steamAccountId,
      name: player.steamAccount.name,
      rank: player.steamAccount.seasonRank,
      leaderboardRank: player.steamAccount.seasonLeaderboardRank
    };
    logger.debug(`getPlayerRank(${accountId}): name=${result.name}, rank=${result.rank}, leaderboard=${result.leaderboardRank}`);
    return result;
  }

  /**
   * Get game modes
   */
  async getGameModes() {
    logger.debug('Fetching game modes');
    
    const query = `
      query GetGameModes {
        constants {
          gameModes {
            id
            name
          }
        }
      }
    `;

    const data = await this.query(query);
    return data?.constants?.gameModes || [];
  }

  /**
   * Get lobby types
   */
  async getLobbyTypes() {
    logger.debug('Fetching lobby types');
    
    const query = `
      query GetLobbyTypes {
        constants {
          lobbyTypes {
            id
            name
          }
        }
      }
    `;

    const data = await this.query(query);
    return data?.constants?.lobbyTypes || [];
  }

  // ==================== Achievement/Feats Queries ====================

  /**
   * Get player achievements (feats) - includes multi-kills like Rampage, Ultra Kill, Triple Kill
   */
  async getPlayerAchievements(accountId, take = 100) {
    logger.debug(`Fetching achievements for account ${accountId}`);
    
    const query = `
      query GetPlayerAchievements($steamAccountId: Long!, $take: Int!) {
        player(steamAccountId: $steamAccountId) {
          feats(take: $take) {
            type
            value
            heroId
            matchId
          }
        }
      }
    `;

    const data = await this.query(query, { steamAccountId: parseInt(accountId), take });
    const feats = data?.player?.feats || [];

    // Log feat types for debugging multi-kill detection
    if (feats.length > 0) {
      const typeCounts = {};
      feats.forEach(f => {
        const key = `${f.type}(${typeof f.type})`;
        typeCounts[key] = (typeCounts[key] || 0) + 1;
      });
      logger.debug(`Feats for ${accountId}: ${feats.length} total, types: ${JSON.stringify(typeCounts)}`);
    }

    return feats;
  }

  /**
   * Get multi-kill counts from feats for specific match IDs
   * Returns { tripleKills, ultraKills, rampages }
   */
  getMultiKillsFromFeats(feats, matchIds) {
    const result = { tripleKills: 0, ultraKills: 0, rampages: 0 };

    if (!feats || !matchIds || matchIds.length === 0) return result;

    const matchIdSet = new Set(matchIds.map(id => parseInt(id)));

    feats.forEach(feat => {
      if (matchIdSet.has(feat.matchId)) {
        const normalizedType = this.normalizeFeatType(feat.type);
        switch (normalizedType) {
          case 'RAMPAGE':
            result.rampages++;
            break;
          case 'ULTRA_KILL':
            result.ultraKills++;
            break;
          case 'TRIPLE_KILL':
            result.tripleKills++;
            break;
        }
      }
    });

    logger.debug(`getMultiKillsFromFeats: checked ${feats.length} feats against ${matchIds.length} matches -> rampages=${result.rampages}, ultra=${result.ultraKills}, triple=${result.tripleKills}`);
    return result;
  }

  /**
   * Get rampage feats for specific match IDs (for notifications)
   */
  getRampageFeatsFromMatches(feats, matchIds) {
    if (!feats || !matchIds || matchIds.length === 0) return [];

    const matchIdSet = new Set(matchIds.map(id => parseInt(id)));

    return feats
      .map(feat => ({ ...feat, type: this.normalizeFeatType(feat.type) }))
      .filter(feat =>
        feat.type === 'RAMPAGE' && matchIdSet.has(feat.matchId)
      );
  }

  /**
   * Get all multi-kill feats (triple, ultra, rampage) for specific match IDs
   */
  getMultiKillFeatsFromMatches(feats, matchIds) {
    if (!feats || !matchIds || matchIds.length === 0) return [];

    const matchIdSet = new Set(matchIds.map(id => parseInt(id)));
    const multiKillTypes = new Set(['TRIPLE_KILL', 'ULTRA_KILL', 'RAMPAGE']);

    const result = feats
      .map(feat => ({ ...feat, type: this.normalizeFeatType(feat.type) }))
      .filter(feat =>
        multiKillTypes.has(feat.type) && matchIdSet.has(feat.matchId)
      );

    logger.debug(`getMultiKillFeatsFromMatches: checked ${feats.length} feats against ${matchIds.length} match IDs -> found ${result.length} multi-kill feats`);
    if (result.length > 0) {
      result.forEach(f => logger.debug(`  feat: type=${f.type}, matchId=${f.matchId}, heroId=${f.heroId}`));
    }
    return result;
  }

  // ==================== Feat Type Normalization ====================

  /**
   * Normalize STRATZ feat type to standard string format
   * Handles string enum values, numeric IDs, and case variations
   */
  normalizeFeatType(type) {
    if (type == null) return 'UNKNOWN';

    // If it's a string, normalize casing and underscores
    if (typeof type === 'string') {
      const upper = type.toUpperCase().replace(/ /g, '_');
      // Direct match
      const known = new Set([
        'RAMPAGE', 'ULTRA_KILL', 'TRIPLE_KILL', 'GODLIKE',
        'COURIER_KILL', 'MEGA_CREEPS', 'DIVINE_RAPIER', 'FIRST_BLOOD',
        'BEYOND_GODLIKE'
      ]);
      if (known.has(upper)) return upper;
      // Handle no-underscore variants
      if (upper === 'TRIPLEKILL' || upper === 'TRIPLE') return 'TRIPLE_KILL';
      if (upper === 'ULTRAKILL' || upper === 'ULTRA') return 'ULTRA_KILL';
      return upper;
    }

    // If it's a number, map known STRATZ FeatType enum IDs
    if (typeof type === 'number') {
      const numericMap = {
        0: 'FIRST_BLOOD',
        1: 'RAMPAGE',
        2: 'ULTRA_KILL',
        3: 'TRIPLE_KILL',
        4: 'GODLIKE',
        5: 'COURIER_KILL',
        6: 'MEGA_CREEPS',
        7: 'BEYOND_GODLIKE',
        8: 'DIVINE_RAPIER',
      };
      return numericMap[type] || `UNKNOWN_${type}`;
    }

    return `UNKNOWN_${type}`;
  }

  // ==================== Rampage Detection ====================

  /**
   * Get match with kill events for rampage detection
   */
  async getMatchWithKillEvents(matchId) {
    logger.debug(`Fetching match ${matchId} with kill events`);
    
    const query = `
      query GetMatchKillEvents($matchId: Long!) {
        match(id: $matchId) {
          id
          didRadiantWin
          players {
            steamAccountId
            heroId
            isRadiant
            kills
            deaths
            assists
            stats {
              killEvents {
                time
                target
              }
            }
          }
        }
      }
    `;

    const data = await this.query(query, { matchId: parseInt(matchId) });
    const match = data?.match;
    logger.debug(`getMatchWithKillEvents(${matchId}): ${match ? `found, ${match.players?.length} players` : 'not found'}`);
    return match;
  }

  /**
   * Detect multi-kills from kill events
   * - Triple Kill: 3 kills within 18 seconds
   * - Ultra Kill: 4 kills within 18 seconds
   * - Rampage: 5 kills within 18 seconds
   */
  detectMultiKillsFromKillEvents(killEvents) {
    const result = { tripleKills: 0, ultraKills: 0, rampages: 0 };
    
    if (!killEvents || killEvents.length < 3) return result;
    
    const sortedKills = [...killEvents].sort((a, b) => a.time - b.time);
    let i = 0;
    
    while (i < sortedKills.length) {
      // Check for rampage first (5 kills)
      if (i <= sortedKills.length - 5) {
        const timeWindow5 = sortedKills[i + 4].time - sortedKills[i].time;
        if (timeWindow5 <= 18) {
          result.rampages++;
          i += 5; // Skip past this rampage
          continue;
        }
      }
      
      // Check for ultra kill (4 kills)
      if (i <= sortedKills.length - 4) {
        const timeWindow4 = sortedKills[i + 3].time - sortedKills[i].time;
        if (timeWindow4 <= 18) {
          result.ultraKills++;
          i += 4; // Skip past this ultra kill
          continue;
        }
      }
      
      // Check for triple kill (3 kills)
      if (i <= sortedKills.length - 3) {
        const timeWindow3 = sortedKills[i + 2].time - sortedKills[i].time;
        if (timeWindow3 <= 18) {
          result.tripleKills++;
          i += 3; // Skip past this triple kill
          continue;
        }
      }
      
      // No multi-kill starting at this position, move to next
      i++;
    }
    
    return result;
  }

  /**
   * Detect rampages from kill events (legacy method for backwards compatibility)
   */
  detectRampagesFromKillEvents(killEvents) {
    const multiKills = this.detectMultiKillsFromKillEvents(killEvents);
    return multiKills.rampages;
  }

  // ==================== Test Connection ====================

  /**
   * Test API connectivity
   */
  async testConnection() {
    try {
      const query = `
        query TestConnection {
          constants {
            heroes {
              id
              displayName
            }
          }
        }
      `;
      
      const data = await this.query(query);
      // Check if we got heroes back
      return data?.constants?.heroes?.length > 0;
    } catch (error) {
      logger.error('STRATZ API connection test failed:', error.message);
      return false;
    }
  }
}
