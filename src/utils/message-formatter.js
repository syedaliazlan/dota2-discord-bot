import { EmbedBuilder } from 'discord.js';
import { getHeroName } from './hero-names.js';
import { getHeroNameFromAPI } from './hero-loader.js';

/**
 * Message formatter utility to convert data into Discord embeds
 */
export class MessageFormatter {
  constructor(heroMap = null, mainAccountName = null) {
    this.heroMap = heroMap; // Store API-loaded hero map
    this.mainAccountName = mainAccountName; // Store main account name for sorting
  }

  /**
   * Get hero name - use API map if available, fallback to static
   */
  getHeroName(heroId) {
    if (this.heroMap) {
      const apiName = getHeroNameFromAPI(heroId, this.heroMap);
      if (apiName) return apiName;
    }
    return getHeroName(heroId); // Fallback to static mapping
  }
  /**
   * Format player profile embed
   */
  formatProfile(profile) {
    const embed = new EmbedBuilder()
      .setTitle(`👤 ${profile.name}'s Profile`)
      .setColor(0x00AE86) // Dota 2 green
      .setTimestamp();

    if (profile.avatar) {
      embed.setThumbnail(profile.avatar);
    }

    const fields = [];

    if (profile.mmr) {
      fields.push({
        name: 'MMR',
        value: profile.mmr.toString(),
        inline: true
      });
    }

    if (profile.rankTier) {
      const rankText = this.getRankText(profile.rankTier);
      fields.push({
        name: 'Rank',
        value: rankText,
        inline: true
      });
    }

    if (profile.leaderboardRank) {
      fields.push({
        name: 'Leaderboard Rank',
        value: `#${profile.leaderboardRank}`,
        inline: true
      });
    }

    if (fields.length > 0) {
      embed.addFields(fields);
    }

    return embed;
  }

  /**
   * Format recent matches embed
   */
  formatRecentMatches(matches, limit = 5) {
    const embed = new EmbedBuilder()
      .setTitle('🎮 Recent Matches')
      .setColor(0x00AE86)
      .setTimestamp();

    if (matches.length === 0) {
      embed.setDescription('No recent matches found.');
      return embed;
    }

    const displayMatches = matches.slice(0, limit);
    
    // Format each match with more details
    const matchList = displayMatches.map((match, index) => {
      const result = match.win ? '✅ **Win**' : '❌ **Loss**';
      const duration = this.formatDuration(match.duration);
      const heroName = this.getHeroName(match.heroId);
      const kdaParts = match.kda ? match.kda.split('/') : ['0', '0', '0'];
      const kdaDisplay = `${kdaParts[0]}/${kdaParts[1]}/${kdaParts[2]}`;
      
      return `${index + 1}. ${result} | **${heroName}** | ${kdaDisplay} KDA | ${duration}`;
    }).join('\n');

    embed.setDescription(matchList);

    // Add summary stats
    const wins = displayMatches.filter(m => m.win).length;
    const losses = displayMatches.length - wins;
    const winRate = displayMatches.length > 0 
      ? ((wins / displayMatches.length) * 100).toFixed(1) 
      : '0';

    embed.addFields({
      name: '📊 Summary',
      value: `**Wins:** ${wins} | **Losses:** ${losses} | **Win Rate:** ${winRate}%`,
      inline: false
    });

    return embed;
  }

  /**
   * Format player statistics embed
   */
  formatStats(stats) {
    const embed = new EmbedBuilder()
      .setTitle('📊 Player Statistics')
      .setColor(0x00AE86)
      .setTimestamp();

    const fields = [
      {
        name: 'Win/Loss',
        value: `${stats.wins}W - ${stats.losses}L`,
        inline: true
      },
      {
        name: 'Win Rate',
        value: `${stats.winRate}%`,
        inline: true
      },
      {
        name: 'Total Matches',
        value: stats.totalMatches.toString(),
        inline: true
      }
    ];

    if (stats.avgKills) {
      fields.push({
        name: 'Avg Kills',
        value: stats.avgKills,
        inline: true
      });
    }

    if (stats.avgDeaths) {
      fields.push({
        name: 'Avg Deaths',
        value: stats.avgDeaths,
        inline: true
      });
    }

    if (stats.avgAssists) {
      fields.push({
        name: 'Avg Assists',
        value: stats.avgAssists,
        inline: true
      });
    }

    if (stats.avgGPM) {
      fields.push({
        name: 'Avg GPM',
        value: stats.avgGPM,
        inline: true
      });
    }

    if (stats.avgXPM) {
      fields.push({
        name: 'Avg XPM',
        value: stats.avgXPM,
        inline: true
      });
    }

    embed.addFields(fields);
    return embed;
  }

  /**
   * Format hero statistics embed
   */
  formatHeroes(heroes, limit = 10) {
    const embed = new EmbedBuilder()
      .setTitle('⚔️ Top Heroes')
      .setColor(0x00AE86)
      .setTimestamp();

    if (heroes.length === 0) {
      embed.setDescription('No hero statistics available.');
      return embed;
    }

    const displayHeroes = heroes.slice(0, limit);
    
    // Format heroes with better display
    const heroList = displayHeroes.map((hero, index) => {
      const heroName = this.getHeroName(hero.heroId);
      const winEmoji = parseFloat(hero.winRate) >= 60 ? '🔥' : parseFloat(hero.winRate) >= 50 ? '✅' : '⚠️';
      const winLoss = `${hero.wins}W-${hero.losses}L`;
      
      return `${index + 1}. **${heroName}** | ${hero.games} games | ${winEmoji} ${hero.winRate}% WR | ${winLoss}`;
    }).join('\n');

    embed.setDescription(heroList);
    
    // Add footer with total games
    const totalGames = displayHeroes.reduce((sum, h) => sum + h.games, 0);
    embed.setFooter({ text: `Total games shown: ${totalGames}` });
    
    return embed;
  }

  /**
   * Format match details embed
   */
  formatMatch(match) {
    if (!match || !match.player) {
      return new EmbedBuilder()
        .setTitle('Match Not Found')
        .setColor(0xFF0000)
        .setDescription('Could not find match details or player data.');
    }

    const embed = new EmbedBuilder()
      .setTitle(`Match ${match.matchId}`)
      .setColor(match.player.win ? 0x00FF00 : 0xFF0000)
      .setTimestamp(new Date(match.startTime * 1000));

    const result = match.player.win ? '✅ Victory' : '❌ Defeat';
    const duration = this.formatDuration(match.duration);

    embed.addFields(
      {
        name: 'Result',
        value: result,
        inline: true
      },
      {
        name: 'Duration',
        value: duration,
        inline: true
      },
      {
        name: 'KDA',
        value: `${match.player.kills}/${match.player.deaths}/${match.player.assists} (${match.player.kda})`,
        inline: true
      },
      {
        name: 'GPM / XPM',
        value: `${match.player.goldPerMin} / ${match.player.xpPerMin}`,
        inline: true
      },
      {
        name: 'Last Hits / Denies',
        value: `${match.player.lastHits} / ${match.player.denies}`,
        inline: true
      }
    );

    return embed;
  }

  /**
   * Format live match notification
   */
  formatLiveMatch(liveMatch) {
    const embed = new EmbedBuilder()
      .setTitle('🔴 Live Match Detected')
      .setColor(0xFF0000)
      .setTimestamp();

    embed.setDescription('A live match is currently in progress!');
    return embed;
  }

  /**
   * Format new match notification
   */
  formatNewMatch(match) {
    const result = match.win ? '✅ Victory' : '❌ Defeat';
    const duration = this.formatDuration(match.duration);

    const embed = new EmbedBuilder()
      .setTitle('🎮 New Match Completed')
      .setColor(match.win ? 0x00FF00 : 0xFF0000)
      .setTimestamp();

    embed.addFields(
      {
        name: 'Result',
        value: result,
        inline: true
      },
      {
        name: 'KDA',
        value: `${match.kills}/${match.deaths}/${match.assists} (${match.kda})`,
        inline: true
      },
      {
        name: 'Duration',
        value: duration,
        inline: true
      }
    );

    return embed;
  }

  /**
   * Format achievements embed
   */
  formatAchievements(achievements) {
    const embed = new EmbedBuilder()
      .setTitle('Achievements')
      .setColor(0xFFD700)
      .setTimestamp();

    if (!achievements || achievements.length === 0) {
      embed.setDescription('No achievements data available.');
      return embed;
    }

    const achievementList = achievements
      .slice(0, 10)
      .map((ach, index) => {
        const status = ach.unlocked ? '✅' : '❌';
        return `${index + 1}. ${status} ${ach.name || 'Unknown'}`;
      })
      .join('\n');

    embed.setDescription(achievementList);
    return embed;
  }

  /**
   * Format duration in seconds to MM:SS
   */
  formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get rank text from rank tier
   */
  getRankText(rankTier) {
    const ranks = {
      10: 'Herald',
      20: 'Guardian',
      30: 'Crusader',
      40: 'Archon',
      50: 'Legend',
      60: 'Ancient',
      70: 'Divine',
      80: 'Immortal'
    };

    const tier = Math.floor(rankTier / 10) * 10;
    const star = rankTier % 10;
    const rankName = ranks[tier] || 'Unknown';
    
    return star > 0 ? `${rankName} ${star}⭐` : rankName;
  }

  /**
   * Format daily summary embed
   */
  formatDailySummary(summary) {
    const embed = new EmbedBuilder()
      .setTitle('📊 Daily Summary (Last 24 Hours)')
      .setColor(0x00AE86)
      .setTimestamp();

    if (summary.totalMatches === 0) {
      embed.setDescription('No matches played in the last 24 hours.');
      return embed;
    }

    const heroName = summary.mostPlayedHero 
      ? this.getHeroName(summary.mostPlayedHero)
      : 'N/A';

    const fields = [
      {
        name: '📈 Overview',
        value: `**Matches:** ${summary.totalMatches}\n**Wins:** ${summary.wins} | **Losses:** ${summary.losses}\n**Win Rate:** ${summary.winRate}%`,
        inline: false
      },
      {
        name: '⚔️ Performance',
        value: `**Avg KDA:** ${summary.avgKDA}\n**Total:** ${summary.totalKills}/${summary.totalDeaths}/${summary.totalAssists}`,
        inline: true
      },
      {
        name: '🎯 Most Played Hero',
        value: heroName,
        inline: true
      }
    ];

    if (summary.bestMatch) {
      const bestHeroName = this.getHeroName(summary.bestMatch.heroId);
      fields.push({
        name: '🏆 Best Match',
        value: `**${bestHeroName}**\n${summary.bestMatch.win ? '✅ Win' : '❌ Loss'}\nKDA: ${summary.bestMatch.kda}`,
        inline: true
      });
    }

    if (summary.worstMatch) {
      const worstHeroName = this.getHeroName(summary.worstMatch.heroId);
      fields.push({
        name: '📉 Worst Match',
        value: `**${worstHeroName}**\n${summary.worstMatch.win ? '✅ Win' : '❌ Loss'}\nKDA: ${summary.worstMatch.kda}`,
        inline: true
      });
    }

    embed.addFields(fields);
    return embed;
  }

  /**
   * Format multi-player daily summary embed with modern Discord UI
   */
  formatMultiPlayerDailySummary(playerSummaries) {
    const embed = new EmbedBuilder()
      .setTitle('📊 Daily Summary (Last 24 Hours)')
      .setColor(0x00AE86)
      .setTimestamp();

    if (playerSummaries.length === 0) {
      embed.setDescription('No matches played in the last 24 hours by any tracked players.');
      return embed;
    }

    // Sort players: main account (Blur) first, then by total matches (descending)
    const mainAccountName = this.mainAccountName || 'Blur';
    playerSummaries.sort((a, b) => {
      // Main account always first
      if (a.name === mainAccountName) return -1;
      if (b.name === mainAccountName) return 1;
      // Others sorted by total matches
      return b.summary.totalMatches - a.summary.totalMatches;
    });

    // Create a field for each player with improved formatting
    const playerFields = playerSummaries.map(({ name, summary }) => {
      const winRateEmoji = parseFloat(summary.winRate) >= 60 ? '🔥' : parseFloat(summary.winRate) >= 50 ? '✅' : '⚠️';
      const mostPlayedHero = summary.mostPlayedHero 
        ? this.getHeroName(summary.mostPlayedHero)
        : 'N/A';
      
      const bestMatchInfo = summary.bestMatch 
        ? `\n🏆 **Best Match:** ${this.getHeroName(summary.bestMatch.heroId)} (${summary.bestMatch.win ? '✅ Win' : '❌ Loss'}) - ${summary.bestMatch.kda} KDA`
        : '';

      // Use larger, more prominent player icon and name
      // Discord embed field names are automatically bold, so we make the name stand out with spacing and emoji
      return {
        name: `🎮  ${name.toUpperCase()}`,
        value: `\n📊 **${summary.totalMatches}** matches | ${summary.wins}W-${summary.losses}L | ${winRateEmoji} **${summary.winRate}%** WR\n` +
               `⚔️ Avg KDA: **${summary.avgKDA}** | Total: ${summary.totalKills}/${summary.totalDeaths}/${summary.totalAssists}\n` +
               `🎯 Most Played: **${mostPlayedHero}**${bestMatchInfo}`,
        inline: false
      };
    });

    embed.addFields(playerFields);

    // Footer removed as requested

    return embed;
  }
}

