import { logger } from '../utils/logger.js';

/**
 * Data processor to normalize and merge data from OpenDota and Dotabuff
 */
export class DataProcessor {
  constructor(stateCache, accountId) {
    this.stateCache = stateCache;
    this.accountId = accountId;
  }

  /**
   * Process player profile data
   */
  processPlayerProfile(opendotaData, dotabuffData = null) {
    const profile = {
      accountId: opendotaData.profile?.account_id || opendotaData.account_id,
      name: opendotaData.profile?.personaname || opendotaData.personaname || 'Unknown',
      avatar: opendotaData.profile?.avatarfull || opendotaData.avatarfull,
      steamId: opendotaData.profile?.steamid || opendotaData.steamid,
      mmr: opendotaData.solo_competitive_rank || opendotaData.competitive_rank || null,
      rankTier: opendotaData.rank_tier || null,
      leaderboardRank: opendotaData.leaderboard_rank || null
    };

    // Merge Dotabuff data if available
    if (dotabuffData) {
      if (dotabuffData.name) profile.name = dotabuffData.name;
      if (dotabuffData.mmr) profile.mmr = dotabuffData.mmr;
      if (dotabuffData.rank) profile.rankText = dotabuffData.rank;
    }

    return profile;
  }

  /**
   * Process recent matches
   * Note: hero_id should already be corrected by fetching full match details
   */
  processRecentMatches(matches) {
    if (!matches || !Array.isArray(matches)) {
      return [];
    }

    return matches.map((match) => {
      // hero_id should be correct if full match details were fetched
      // Otherwise, use the hero_id from recentMatches (may have issues)
      const heroId = match.hero_id;
      const kills = match.kills ?? 0;
      const deaths = match.deaths ?? 0;
      const assists = match.assists ?? 0;
      const playerSlot = match.player_slot;
      
      return {
        matchId: match.match_id,
        heroId: heroId,
        kills,
        deaths,
        assists,
        win: match.radiant_win === (playerSlot < 128),
        duration: match.duration,
        startTime: match.start_time,
        gameMode: match.game_mode,
        lobbyType: match.lobby_type,
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
   * Process player statistics
   */
  processPlayerStats(totalsData, winLossData) {
    const stats = {
      wins: winLossData?.win || 0,
      losses: winLossData?.lose || 0,
      totalMatches: (winLossData?.win || 0) + (winLossData?.lose || 0),
      winRate: 0
    };

    if (stats.totalMatches > 0) {
      stats.winRate = ((stats.wins / stats.totalMatches) * 100).toFixed(2);
    }

    // Process totals if available
    if (totalsData && Array.isArray(totalsData)) {
      totalsData.forEach(total => {
        if (total.field === 'kills') stats.avgKills = (total.sum / total.n).toFixed(2);
        if (total.field === 'deaths') stats.avgDeaths = (total.sum / total.n).toFixed(2);
        if (total.field === 'assists') stats.avgAssists = (total.sum / total.n).toFixed(2);
        if (total.field === 'gold_per_min') stats.avgGPM = (total.sum / total.n).toFixed(0);
        if (total.field === 'xp_per_min') stats.avgXPM = (total.sum / total.n).toFixed(0);
      });
    }

    return stats;
  }

  /**
   * Process hero statistics
   */
  processHeroStats(heroesData) {
    if (!heroesData || !Array.isArray(heroesData)) {
      return [];
    }

    return heroesData
      .map(hero => {
        // OpenDota heroes endpoint doesn't provide avg_kills/deaths/assists
        // These would need to be calculated from match data which is expensive
        // For now, we'll show games, wins, and win rate only
        return {
          heroId: hero.hero_id,
          games: hero.games || 0,
          wins: hero.win || 0,
          losses: (hero.games || 0) - (hero.win || 0),
          winRate: hero.games > 0 ? ((hero.win / hero.games) * 100).toFixed(2) : '0.00',
          lastPlayed: hero.last_played || null
        };
      })
      .sort((a, b) => b.games - a.games); // Sort by games played
  }

  /**
   * Process match details
   */
  processMatchDetails(matchData) {
    if (!matchData) {
      return null;
    }

    // Find player in match
    const playerSlot = matchData.players?.findIndex(p => 
      p.account_id === parseInt(this.accountId)
    );

    const player = playerSlot >= 0 ? matchData.players[playerSlot] : null;

    return {
      matchId: matchData.match_id,
      duration: matchData.duration,
      startTime: matchData.start_time,
      gameMode: matchData.game_mode,
      lobbyType: matchData.lobby_type,
      radiantWin: matchData.radiant_win,
      player: player ? {
        heroId: player.hero_id,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        kda: this.calculateKDA(player.kills, player.deaths, player.assists),
        goldPerMin: player.gold_per_min,
        xpPerMin: player.xp_per_min,
        lastHits: player.last_hits,
        denies: player.denies,
        win: matchData.radiant_win === (player.player_slot < 128)
      } : null
    };
  }

  /**
   * Detect new matches by comparing with cache
   */
  detectNewMatches(matches) {
    if (!matches || !Array.isArray(matches) || matches.length === 0) {
      return [];
    }

    const lastMatchId = this.stateCache.getLastMatchId();
    if (!lastMatchId) {
      // First run, cache the latest match
      this.stateCache.setLastMatchId(matches[0].match_id);
      return [];
    }

    // Find matches newer than last cached
    const newMatches = matches.filter(match => match.match_id > lastMatchId);
    
    if (newMatches.length > 0) {
      // Update cache with latest match ID
      this.stateCache.setLastMatchId(newMatches[0].match_id);
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
        totalAssists: 0
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
      totalAssists
    };
  }
}

