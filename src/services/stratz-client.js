import axios from 'axios';
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
 */
export class StratzClient {
  constructor(apiToken) {
    this.baseUrl = 'https://api.stratz.com/graphql';
    this.apiToken = apiToken;
    
    // Rate limiting: 20 req/sec = 50ms between requests (being conservative)
    this.rateLimitDelay = 50;
    this.lastRequestTime = 0;

    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
        'User-Agent': 'Dota2DiscordBot/1.0'
      }
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
   * Execute GraphQL query
   */
  async query(queryString, variables = {}, retries = 3) {
    await this.waitForRateLimit();

    const startTime = Date.now();
    
    for (let i = 0; i < retries; i++) {
      try {
        const response = await this.client.post('', {
          query: queryString,
          variables
        });

        const duration = Date.now() - startTime;
        
        if (response.data.errors) {
          const errorMessages = response.data.errors.map(e => e.message).join(', ');
          logger.warn(`GraphQL errors: ${errorMessages}`);
        }
        
        logger.debug(`STRATZ query completed (${duration}ms)`);
        return response.data.data;
      } catch (error) {
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
    return data?.player;
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
    
    return data?.player?.matches || [];
  }

  /**
   * Get player matches for a specific time range (for daily summaries)
   * Fetches recent matches and filters by timestamp in code for reliability
   */
  async getPlayerMatchesSince(accountId, sinceTimestamp, limit = 50) {
    logger.debug(`Fetching matches since ${new Date(sinceTimestamp * 1000).toISOString()} for account ${accountId}`);
    
    // Fetch more matches than needed, then filter by timestamp
    // This is more reliable than using startDateTime in the GraphQL query
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
      take: limit
    });
    
    const matches = data?.player?.matches || [];
    
    // Filter matches to only include those after sinceTimestamp
    return matches.filter(match => match.startDateTime >= sinceTimestamp);
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
      return {
        win: data.player.winCount,
        lose: data.player.matchCount - data.player.winCount
      };
    }
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
    return data?.player?.heroesPerformance || [];
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
    return data?.match;
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
    return data?.matches || [];
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
    return data?.live?.matches || [];
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
    return data?.player?.feats || [];
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
        switch (feat.type) {
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
    
    return result;
  }

  /**
   * Get rampage feats for specific match IDs (for notifications)
   */
  getRampageFeatsFromMatches(feats, matchIds) {
    if (!feats || !matchIds || matchIds.length === 0) return [];
    
    const matchIdSet = new Set(matchIds.map(id => parseInt(id)));
    
    return feats.filter(feat => 
      feat.type === 'RAMPAGE' && matchIdSet.has(feat.matchId)
    );
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
    return data?.match;
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
