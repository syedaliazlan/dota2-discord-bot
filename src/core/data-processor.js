import { logger } from '../utils/logger.js';

/**
 * Data processor to normalize STRATZ API data for Discord display
 */
export class DataProcessor {
  constructor(stateCache, accountId) {
    this.stateCache = stateCache;
    this.accountId = accountId;
  }

  /**
   * Process player profile data from STRATZ
   */
  processPlayerProfile(playerData) {
    if (!playerData) return null;

    const steamAccount = playerData.steamAccount || {};
    
    const profile = {
      accountId: playerData.steamAccountId || steamAccount.id,
      name: steamAccount.name || 'Unknown',
      avatar: steamAccount.avatar,
      steamId: steamAccount.id,
      // STRATZ uses seasonRank (e.g., 62 = Ancient 2)
      rankTier: steamAccount.seasonRank || null,
      leaderboardRank: steamAccount.seasonLeaderboardRank || null,
      matchCount: playerData.matchCount || 0,
      winCount: playerData.winCount || 0,
      behaviorScore: playerData.behaviorScore || null
    };

    return profile;
  }

  /**
   * Process recent matches from STRATZ format
   * STRATZ match format:
   * - id (match ID)
   * - didRadiantWin (boolean)
   * - durationSeconds
   * - startDateTime (unix timestamp)
   * - players[0] (filtered to current player):
   *   - heroId, isRadiant, kills, deaths, assists, etc.
   */
  processRecentMatches(matches) {
    if (!matches || !Array.isArray(matches)) {
      return [];
    }

    return matches.map((match) => {
      // STRATZ returns players filtered to the requested account
      const player = match.players?.[0] || {};
      
      const heroId = player.heroId;
      const kills = player.kills ?? 0;
      const deaths = player.deaths ?? 0;
      const assists = player.assists ?? 0;
      
      // Determine win: player's team (isRadiant) matches didRadiantWin
      const isRadiant = player.isRadiant;
      const win = isRadiant === match.didRadiantWin;
      
      return {
        matchId: match.id,
        heroId: heroId,
        kills,
        deaths,
        assists,
        win,
        duration: match.durationSeconds,
        startTime: match.startDateTime,
        gameMode: match.gameMode,
        lobbyType: match.lobbyType,
        goldPerMinute: player.goldPerMinute,
        experiencePerMinute: player.experiencePerMinute,
        lastHits: player.numLastHits,
        denies: player.numDenies,
        kda: `${kills}/${deaths}/${assists} (${this.calculateKDA(kills, deaths, assists)})`
      };
    });
  }

  /**
   * Calculate KDA ratio
   */
  calculateKDA(kills, deaths, assists) {
    if (deaths === 0) {
      return (kills + assists).toFixed(2);
    }
    return ((kills + assists) / deaths).toFixed(2);
  }

  /**
   * Process player statistics from STRATZ
   */
  processPlayerStats(playerData, winLossData = null) {
    // STRATZ provides matchCount and winCount directly
    const wins = winLossData?.win ?? playerData?.winCount ?? 0;
    const losses = winLossData?.lose ?? (playerData?.matchCount - playerData?.winCount) ?? 0;
    
    const stats = {
      wins,
      losses,
      totalMatches: wins + losses,
      winRate: 0
    };

    if (stats.totalMatches > 0) {
      stats.winRate = ((stats.wins / stats.totalMatches) * 100).toFixed(2);
    }

    // Note: STRATZ doesn't provide average stats in the basic query
    // These will be calculated from recent matches if needed
    stats.avgKills = null;
    stats.avgDeaths = null;
    stats.avgAssists = null;
    stats.avgGPM = null;
    stats.avgXPM = null;

    return stats;
  }

  /**
   * Process player statistics with recent matches for averages
   */
  processPlayerStatsWithMatches(playerData, winLossData, recentMatches) {
    const stats = this.processPlayerStats(playerData, winLossData);
    
    // Calculate averages from recent matches
    if (recentMatches && recentMatches.length > 0) {
      const processed = this.processRecentMatches(recentMatches);
      
      let totalKills = 0, totalDeaths = 0, totalAssists = 0;
      let totalGPM = 0, totalXPM = 0;
      let gpmCount = 0, xpmCount = 0;
      
      processed.forEach(match => {
        totalKills += match.kills;
        totalDeaths += match.deaths;
        totalAssists += match.assists;
        
        if (match.goldPerMinute) {
          totalGPM += match.goldPerMinute;
          gpmCount++;
        }
        if (match.experiencePerMinute) {
          totalXPM += match.experiencePerMinute;
          xpmCount++;
        }
      });
      
      const count = processed.length;
      stats.avgKills = (totalKills / count).toFixed(2);
      stats.avgDeaths = (totalDeaths / count).toFixed(2);
      stats.avgAssists = (totalAssists / count).toFixed(2);
      
      if (gpmCount > 0) {
        stats.avgGPM = (totalGPM / gpmCount).toFixed(0);
      }
      if (xpmCount > 0) {
        stats.avgXPM = (totalXPM / xpmCount).toFixed(0);
      }
    }
    
    return stats;
  }

  /**
   * Process hero statistics from STRATZ heroesPerformance
   */
  processHeroStats(heroesData) {
    if (!heroesData || !Array.isArray(heroesData)) {
      return [];
    }

    return heroesData
      .map(hero => {
        const games = hero.matchCount || 0;
        const wins = hero.winCount || 0;
        
        return {
          heroId: hero.heroId,
          games,
          wins,
          losses: games - wins,
          winRate: games > 0 ? ((wins / games) * 100).toFixed(2) : '0.00',
          lastPlayed: hero.lastPlayedDateTime || null,
          imp: hero.imp || null // STRATZ impact score
        };
      })
      .sort((a, b) => b.games - a.games); // Sort by games played
  }

  /**
   * Process match details from STRATZ
   */
  processMatchDetails(matchData) {
    if (!matchData) {
      return null;
    }

    // Find player in match
    const accountIdNum = parseInt(this.accountId);
    const player = matchData.players?.find(p => 
      p.steamAccountId === accountIdNum
    );

    return {
      matchId: matchData.id,
      duration: matchData.durationSeconds,
      startTime: matchData.startDateTime,
      gameMode: matchData.gameMode,
      lobbyType: matchData.lobbyType,
      radiantWin: matchData.didRadiantWin,
      player: player ? {
        heroId: player.heroId,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        kda: this.calculateKDA(player.kills, player.deaths, player.assists),
        goldPerMin: player.goldPerMinute,
        xpPerMin: player.experiencePerMinute,
        lastHits: player.numLastHits,
        denies: player.numDenies,
        win: player.isRadiant === matchData.didRadiantWin
      } : null
    };
  }

  /**
   * Detect new matches by comparing with cache
   * @param {Array} matches - Processed matches
   * @param {string} accountId - Optional account ID for per-player tracking
   */
  detectNewMatches(matches, accountId = null) {
    if (!matches || !Array.isArray(matches) || matches.length === 0) {
      return [];
    }

    // Use per-player tracking if accountId provided, otherwise fall back to global
    const lastMatchId = accountId 
      ? this.stateCache.getLastMatchIdForPlayer(accountId)
      : this.stateCache.getLastMatchId();
    
    if (!lastMatchId) {
      // First run, cache the latest match
      if (accountId) {
        this.stateCache.setLastMatchIdForPlayer(accountId, matches[0].matchId);
      } else {
        this.stateCache.setLastMatchId(matches[0].matchId);
      }
      return [];
    }

    // Find matches newer than last cached
    const newMatches = matches.filter(match => match.matchId > lastMatchId);
    
    if (newMatches.length > 0) {
      // Update cache with latest match ID
      if (accountId) {
        this.stateCache.setLastMatchIdForPlayer(accountId, newMatches[0].matchId);
      } else {
        this.stateCache.setLastMatchId(newMatches[0].matchId);
      }
    }

    return newMatches;
  }

  /**
   * Detect stat changes
   */
  detectStatChanges(newStats) {
    const comparison = this.stateCache.compareStats(newStats);
    
    if (comparison.changed) {
      // Update cache
      this.stateCache.setPlayerStats(newStats);
    }

    return comparison;
  }

  /**
   * Process daily summary from matches
   * Note: Rampage stats are added separately by the polling service after fetching feats
   */
  processDailySummary(matches) {
    if (!matches || matches.length === 0) {
      return {
        totalMatches: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        bestMatch: null,
        worstMatch: null,
        mostPlayedHero: null,
        avgKDA: 0,
        totalKills: 0,
        totalDeaths: 0,
        totalAssists: 0,
        rampages: 0,
        ultraKills: 0,
        tripleKills: 0
      };
    }

    const processed = this.processRecentMatches(matches);
    const wins = processed.filter(m => m.win).length;
    const losses = processed.length - wins;
    const winRate = processed.length > 0 ? ((wins / processed.length) * 100).toFixed(2) : 0;

    // Find best and worst matches by KDA
    let bestMatch = null;
    let worstMatch = null;
    let bestKDA = -1;
    let worstKDA = Infinity;

    const heroCounts = {};
    let totalKills = 0;
    let totalDeaths = 0;
    let totalAssists = 0;

    processed.forEach(match => {
      // Extract KDA value from string like "12/3/8 (6.67)"
      const kdaMatch = match.kda.match(/\(([\d.]+)\)/);
      const kdaValue = kdaMatch ? parseFloat(kdaMatch[1]) : this.calculateKDA(match.kills, match.deaths, match.assists);
      
      if (kdaValue > bestKDA) {
        bestKDA = kdaValue;
        bestMatch = match;
      }
      if (kdaValue < worstKDA) {
        worstKDA = kdaValue;
        worstMatch = match;
      }

      // Count heroes
      if (match.heroId) {
        heroCounts[match.heroId] = (heroCounts[match.heroId] || 0) + 1;
      }

      totalKills += match.kills;
      totalDeaths += match.deaths;
      totalAssists += match.assists;
    });

    // Find most played hero
    let mostPlayedHero = null;
    let maxGames = 0;
    for (const [heroId, count] of Object.entries(heroCounts)) {
      if (count > maxGames) {
        maxGames = count;
        mostPlayedHero = parseInt(heroId);
      }
    }

    const avgKDA = totalDeaths > 0 
      ? ((totalKills + totalAssists) / totalDeaths).toFixed(2)
      : (totalKills + totalAssists).toFixed(2);

    return {
      totalMatches: processed.length,
      wins,
      losses,
      winRate,
      bestMatch,
      worstMatch,
      mostPlayedHero,
      avgKDA,
      totalKills,
      totalDeaths,
      totalAssists,
      rampages: 0,
      ultraKills: 0,
      tripleKills: 0
    };
  }

  /**
   * Process achievements/feats from STRATZ
   */
  processAchievements(feats) {
    if (!feats || !Array.isArray(feats)) {
      return [];
    }

    // STRATZ feats have: type, value, heroId, matchId
    // Map to achievement format
    return feats.map(feat => ({
      name: this.getFeatTypeName(feat.type),
      description: `Value: ${feat.value}`,
      heroId: feat.heroId,
      matchId: feat.matchId,
      unlocked: true
    }));
  }

  /**
   * Get human-readable feat type name
   */
  getFeatTypeName(type) {
    const featTypes = {
      'RAMPAGE': 'Rampage',
      'ULTRA_KILL': 'Ultra Kill',
      'TRIPLE_KILL': 'Triple Kill',
      'GODLIKE': 'Godlike Streak',
      'COURIER_KILL': 'Courier Sniper',
      'MEGA_CREEPS': 'Mega Creeps',
      'DIVINE_RAPIER': 'Rapier Carrier',
      'FIRST_BLOOD': 'First Blood',
      // Add more as needed
    };
    return featTypes[type] || type;
  }
}
