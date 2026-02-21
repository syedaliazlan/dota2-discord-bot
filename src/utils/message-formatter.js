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
   * Calculate KDA ratio
   */
  calculateKDA(kills, deaths, assists) {
    if (deaths === 0) {
      return (kills + assists).toFixed(2);
    }
    return ((kills + assists) / deaths).toFixed(2);
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
   * @param {Object} summary - The summary data
   * @param {string} dateString - Optional date string to display
   */
  formatDailySummary(summary, dateString = null) {
    const title = dateString 
      ? `📊 Daily Summary (${dateString})`
      : '📊 Daily Summary (Yesterday)';
    
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x00AE86)
      .setTimestamp();

    if (summary.totalMatches === 0) {
      const noMatchesText = dateString 
        ? `No matches played on ${dateString}.`
        : 'No matches played yesterday.';
      embed.setDescription(noMatchesText);
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

    // Add multi-kill stats if any
    if (summary.rampages > 0) {
      fields.push({
        name: '🔥 Rampages',
        value: `**${summary.rampages}** Rampage${summary.rampages > 1 ? 's' : ''}`,
        inline: true
      });
    }

    if (summary.ultraKills > 0) {
      fields.push({
        name: '⚡ Ultra Kills',
        value: `**${summary.ultraKills}** Ultra Kill${summary.ultraKills > 1 ? 's' : ''}`,
        inline: true
      });
    }

    if (summary.tripleKills > 0) {
      fields.push({
        name: '💥 Triple Kills',
        value: `**${summary.tripleKills}** Triple Kill${summary.tripleKills > 1 ? 's' : ''}`,
        inline: true
      });
    }

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
   * @param {Array} playerSummaries - Array of player summaries
   * @param {string} dateString - Optional date string to display (e.g., "11/1/2026")
   */
  formatMultiPlayerDailySummary(playerSummaries, dateString = null) {
    const title = dateString 
      ? `📊 Daily Summary (${dateString})`
      : '📊 Daily Summary (Yesterday)';
    
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x00AE86)
      .setTimestamp();

    if (playerSummaries.length === 0) {
      const noMatchesText = dateString 
        ? `No matches played on ${dateString} by any tracked players.`
        : 'No matches played yesterday by any tracked players.';
      embed.setDescription(noMatchesText);
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

      // Multi-kill stats line
      let multiKillLine = '';
      const multiKillParts = [];
      if (summary.rampages > 0) {
        multiKillParts.push(`🔥 **${summary.rampages}** Rampage${summary.rampages > 1 ? 's' : ''}`);
      }
      if (summary.ultraKills > 0) {
        multiKillParts.push(`⚡ **${summary.ultraKills}** Ultra Kill${summary.ultraKills > 1 ? 's' : ''}`);
      }
      if (summary.tripleKills > 0) {
        multiKillParts.push(`💥 **${summary.tripleKills}** Triple Kill${summary.tripleKills > 1 ? 's' : ''}`);
      }
      if (multiKillParts.length > 0) {
        multiKillLine = '\n' + multiKillParts.join(' | ');
      }

      // Use larger, more prominent player icon and name
      // Discord embed field names are automatically bold, so we make the name stand out with spacing and emoji
      return {
        name: `🎮  ${name.toUpperCase()}`,
        value: `\n📊 **${summary.totalMatches}** matches | ${summary.wins}W-${summary.losses}L | ${winRateEmoji} **${summary.winRate}%** WR\n` +
               `⚔️ Avg KDA: **${summary.avgKDA}** | Total: ${summary.totalKills}/${summary.totalDeaths}/${summary.totalAssists}\n` +
               `🎯 Most Played: **${mostPlayedHero}**${multiKillLine}${bestMatchInfo}`,
        inline: false
      };
    });

    embed.addFields(playerFields);

    return embed;
  }

  /**
   * Format rampage notification - enhanced with more details
   */
  formatRampageNotification(playerName, heroId, matchId, kills, deaths, assists, win, matchData = null) {
    const heroName = this.getHeroName(heroId);
    const kda = this.calculateKDA(kills, deaths, assists);
    const winEmoji = win ? '✅' : '❌';
    const winText = win ? 'VICTORY' : 'DEFEAT';
    
    // Dramatic messages based on performance
    const dramaticMessages = [
      'has unleashed DEVASTATION!',
      'just OBLITERATED the enemy team!',
      'went on a KILLING SPREE!',
      'showed NO MERCY!',
      'is UNSTOPPABLE!',
      'has achieved PERFECTION!'
    ];
    const randomMessage = dramaticMessages[Math.floor(Math.random() * dramaticMessages.length)];

    const embed = new EmbedBuilder()
      .setTitle('🔥💀 R A M P A G E ! 💀🔥')
      .setDescription(
        `# ${playerName.toUpperCase()}\n` +
        `### ${randomMessage}\n\n` +
        `**5 KILLS** in rapid succession as **${heroName}**!`
      )
      .setColor(0xFF4500) // Orange-red for rampage
      .setTimestamp();

    // Add hero thumbnail from Dota 2 CDN
    const heroShortName = this.getHeroShortName(heroId);
    if (heroShortName) {
      embed.setThumbnail(`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${heroShortName}.png`);
    }

    // Main stats
    embed.addFields(
      {
        name: '🎮 Hero',
        value: `**${heroName}**`,
        inline: true
      },
      {
        name: '⚔️ Final KDA',
        value: `**${kills}/${deaths}/${assists}** (${kda})`,
        inline: true
      },
      {
        name: `${winEmoji} Result`,
        value: `**${winText}**`,
        inline: true
      }
    );

    // Add extra stats if match data is available
    if (matchData) {
      const player = matchData.players?.find(p => p.heroId === heroId) || matchData.players?.[0];
      
      if (player) {
        const extraStats = [];
        
        if (player.goldPerMinute) {
          extraStats.push(`💰 GPM: **${player.goldPerMinute}**`);
        }
        if (player.experiencePerMinute) {
          extraStats.push(`📈 XPM: **${player.experiencePerMinute}**`);
        }
        if (player.heroDamage) {
          extraStats.push(`⚔️ Hero Damage: **${player.heroDamage.toLocaleString()}**`);
        }
        if (player.towerDamage) {
          extraStats.push(`🏰 Tower Damage: **${player.towerDamage.toLocaleString()}**`);
        }
        
        if (extraStats.length > 0) {
          embed.addFields({
            name: '📊 Performance',
            value: extraStats.join('\n'),
            inline: false
          });
        }
      }
      
      // Match duration
      if (matchData.durationSeconds) {
        const mins = Math.floor(matchData.durationSeconds / 60);
        const secs = matchData.durationSeconds % 60;
        embed.addFields({
          name: '⏱️ Match Duration',
          value: `${mins}:${secs.toString().padStart(2, '0')}`,
          inline: true
        });
      }
    }

    return embed;
  }

  /**
   * Format ultra kill notification
   */
  formatUltraKillNotification(playerName, heroId, matchId, kills, deaths, assists, win, count = 1, matchData = null) {
    const heroName = this.getHeroName(heroId);
    const kda = this.calculateKDA(kills, deaths, assists);
    const winEmoji = win ? '✅' : '❌';
    const winText = win ? 'VICTORY' : 'DEFEAT';
    
    const dramaticMessages = [
      'is on FIRE!',
      'is DOMINATING!',
      'cannot be stopped!',
      'is CRUSHING it!'
    ];
    const randomMessage = dramaticMessages[Math.floor(Math.random() * dramaticMessages.length)];

    const countText = count > 1 ? ` (x${count})` : '';
    
    const embed = new EmbedBuilder()
      .setTitle(`⚡💀 U L T R A  K I L L ! 💀⚡${countText}`)
      .setDescription(
        `## ${playerName.toUpperCase()}\n` +
        `### ${randomMessage}\n\n` +
        `**4 KILLS** in rapid succession as **${heroName}**!`
      )
      .setColor(0x9932CC) // Purple for ultra kill
      .setTimestamp();

    const heroShortName = this.getHeroShortName(heroId);
    if (heroShortName) {
      embed.setThumbnail(`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${heroShortName}.png`);
    }

    embed.addFields(
      { name: '🎮 Hero', value: `**${heroName}**`, inline: true },
      { name: '⚔️ Final KDA', value: `**${kills}/${deaths}/${assists}** (${kda})`, inline: true },
      { name: `${winEmoji} Result`, value: `**${winText}**`, inline: true }
    );

    if (matchData?.durationSeconds) {
      const mins = Math.floor(matchData.durationSeconds / 60);
      const secs = matchData.durationSeconds % 60;
      embed.addFields({
        name: '⏱️ Duration',
        value: `${mins}:${secs.toString().padStart(2, '0')}`,
        inline: true
      });
    }

    return embed;
  }

  /**
   * Format triple kill notification
   */
  formatTripleKillNotification(playerName, heroId, matchId, kills, deaths, assists, win, count = 1, matchData = null) {
    const heroName = this.getHeroName(heroId);
    const kda = this.calculateKDA(kills, deaths, assists);
    const winEmoji = win ? '✅' : '❌';
    const winText = win ? 'VICTORY' : 'DEFEAT';
    
    const dramaticMessages = [
      'got a clean sweep!',
      'is picking them off!',
      'scored a hat trick!'
    ];
    const randomMessage = dramaticMessages[Math.floor(Math.random() * dramaticMessages.length)];

    const countText = count > 1 ? ` (x${count})` : '';
    
    const embed = new EmbedBuilder()
      .setTitle(`💥 T R I P L E  K I L L ! 💥${countText}`)
      .setDescription(
        `## ${playerName.toUpperCase()}\n` +
        `### ${randomMessage}\n\n` +
        `**3 KILLS** in rapid succession as **${heroName}**!`
      )
      .setColor(0x00BFFF) // Deep sky blue for triple kill
      .setTimestamp();

    const heroShortName = this.getHeroShortName(heroId);
    if (heroShortName) {
      embed.setThumbnail(`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${heroShortName}.png`);
    }

    embed.addFields(
      { name: '🎮 Hero', value: `**${heroName}**`, inline: true },
      { name: '⚔️ Final KDA', value: `**${kills}/${deaths}/${assists}** (${kda})`, inline: true },
      { name: `${winEmoji} Result`, value: `**${winText}**`, inline: true }
    );

    if (matchData?.durationSeconds) {
      const mins = Math.floor(matchData.durationSeconds / 60);
      const secs = matchData.durationSeconds % 60;
      embed.addFields({
        name: '⏱️ Duration',
        value: `${mins}:${secs.toString().padStart(2, '0')}`,
        inline: true
      });
    }

    return embed;
  }

  /**
   * Format rank change notification
   */
  formatRankChangeNotification(playerName, oldRank, newRank, oldLeaderboardRank = null, newLeaderboardRank = null) {
    const isRankUp = newRank > oldRank;
    const oldRankText = this.getRankText(oldRank);
    const newRankText = this.getRankText(newRank);
    
    const embed = new EmbedBuilder()
      .setTimestamp();

    if (isRankUp) {
      embed
        .setTitle('🎉📈 R A N K  U P ! 📈🎉')
        .setDescription(
          `# ${playerName.toUpperCase()}\n` +
          `### has ranked up!\n\n` +
          `**${oldRankText}** → **${newRankText}**`
        )
        .setColor(0x00FF00); // Green for rank up
    } else {
      embed
        .setTitle('📉 Rank Changed 📉')
        .setDescription(
          `## ${playerName.toUpperCase()}\n\n` +
          `**${oldRankText}** → **${newRankText}**`
        )
        .setColor(0xFF6347); // Tomato red for rank down
    }

    // Add leaderboard info if applicable
    if (newLeaderboardRank) {
      let leaderboardText = `**#${newLeaderboardRank}** on leaderboard`;
      if (oldLeaderboardRank && oldLeaderboardRank !== newLeaderboardRank) {
        const diff = oldLeaderboardRank - newLeaderboardRank;
        if (diff > 0) {
          leaderboardText += ` ↑${diff}`;
        } else {
          leaderboardText += ` ↓${Math.abs(diff)}`;
        }
      }
      embed.addFields({
        name: '🏆 Leaderboard',
        value: leaderboardText,
        inline: false
      });
    }

    return embed;
  }

  /**
   * Format hero meta statistics embed
   */
  formatHeroMeta(heroStats, rankBracket = 'all') {
    const bracketNames = {
      'all': 'All Ranks',
      'herald_guardian': 'Herald/Guardian',
      'crusader_archon': 'Crusader/Archon',
      'legend_ancient': 'Legend/Ancient',
      'divine_immortal': 'Divine/Immortal'
    };
    
    const bracketName = bracketNames[rankBracket] || 'All Ranks';
    
    const embed = new EmbedBuilder()
      .setTitle(`📊 Hero Meta - ${bracketName}`)
      .setColor(0x00AE86)
      .setTimestamp();

    if (!heroStats || heroStats.length === 0) {
      embed.setDescription('No hero statistics available.');
      return embed;
    }

    // Top 10 heroes by win rate (with minimum games)
    const topWinRate = [...heroStats]
      .filter(h => h.matchCount >= 100) // Minimum games threshold
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 10);

    // Top 10 most picked heroes
    const topPicked = [...heroStats]
      .sort((a, b) => b.matchCount - a.matchCount)
      .slice(0, 10);

    if (topWinRate.length > 0) {
      const winRateList = topWinRate.map((hero, i) => {
        const winRateEmoji = hero.winRate >= 55 ? '🔥' : hero.winRate >= 52 ? '✅' : '⚠️';
        return `${i + 1}. **${hero.heroName}** - ${winRateEmoji} ${hero.winRate.toFixed(1)}% (${hero.matchCount.toLocaleString()} games)`;
      }).join('\n');

      embed.addFields({
        name: '🏆 Highest Win Rate',
        value: winRateList,
        inline: false
      });
    }

    if (topPicked.length > 0) {
      const pickedList = topPicked.map((hero, i) => {
        const winRateEmoji = hero.winRate >= 55 ? '🔥' : hero.winRate >= 52 ? '✅' : '⚠️';
        return `${i + 1}. **${hero.heroName}** - ${hero.matchCount.toLocaleString()} games (${winRateEmoji} ${hero.winRate.toFixed(1)}%)`;
      }).join('\n');

      embed.addFields({
        name: '📈 Most Picked',
        value: pickedList,
        inline: false
      });
    }

    return embed;
  }

  /**
   * Get hero short name for CDN URLs
   */
  getHeroShortName(heroId) {
    // Map of hero IDs to their short names used in CDN URLs
    const heroShortNames = {
      1: 'antimage', 2: 'axe', 3: 'bane', 4: 'bloodseeker', 5: 'crystal_maiden',
      6: 'drow_ranger', 7: 'earthshaker', 8: 'juggernaut', 9: 'mirana', 10: 'morphling',
      11: 'nevermore', 12: 'phantom_lancer', 13: 'puck', 14: 'pudge', 15: 'razor',
      16: 'sand_king', 17: 'storm_spirit', 18: 'sven', 19: 'tiny', 20: 'vengefulspirit',
      21: 'windrunner', 22: 'zuus', 23: 'kunkka', 25: 'lina', 26: 'lion',
      27: 'shadow_shaman', 28: 'slardar', 29: 'tidehunter', 30: 'witch_doctor',
      31: 'lich', 32: 'riki', 33: 'enigma', 34: 'tinker', 35: 'sniper',
      36: 'necrolyte', 37: 'warlock', 38: 'beastmaster', 39: 'queenofpain', 40: 'venomancer',
      41: 'faceless_void', 42: 'skeleton_king', 43: 'death_prophet', 44: 'phantom_assassin',
      45: 'pugna', 46: 'templar_assassin', 47: 'viper', 48: 'luna', 49: 'dragon_knight',
      50: 'dazzle', 51: 'rattletrap', 52: 'leshrac', 53: 'furion', 54: 'life_stealer',
      55: 'dark_seer', 56: 'clinkz', 57: 'omniknight', 58: 'enchantress', 59: 'huskar',
      60: 'night_stalker', 61: 'broodmother', 62: 'bounty_hunter', 63: 'weaver',
      64: 'jakiro', 65: 'batrider', 66: 'chen', 67: 'spectre', 68: 'ancient_apparition',
      69: 'doom_bringer', 70: 'ursa', 71: 'spirit_breaker', 72: 'gyrocopter',
      73: 'alchemist', 74: 'invoker', 75: 'silencer', 76: 'obsidian_destroyer',
      77: 'lycan', 78: 'brewmaster', 79: 'shadow_demon', 80: 'lone_druid',
      81: 'chaos_knight', 82: 'meepo', 83: 'treant', 84: 'ogre_magi',
      85: 'undying', 86: 'rubick', 87: 'disruptor', 88: 'nyx_assassin',
      89: 'naga_siren', 90: 'keeper_of_the_light', 91: 'wisp', 92: 'visage',
      93: 'slark', 94: 'medusa', 95: 'troll_warlord', 96: 'centaur',
      97: 'magnataur', 98: 'shredder', 99: 'bristleback', 100: 'tusk',
      101: 'skywrath_mage', 102: 'abaddon', 103: 'elder_titan', 104: 'legion_commander',
      105: 'techies', 106: 'ember_spirit', 107: 'earth_spirit', 108: 'abyssal_underlord',
      109: 'terrorblade', 110: 'phoenix', 111: 'oracle', 112: 'winter_wyvern',
      113: 'arc_warden', 114: 'monkey_king', 119: 'dark_willow', 120: 'pangolier',
      121: 'grimstroke', 123: 'hoodwink', 126: 'void_spirit', 128: 'snapfire',
      129: 'mars', 131: 'ringmaster', 135: 'dawnbreaker', 136: 'marci', 137: 'primal_beast',
      138: 'muerta', 145: 'kez'
    };
    
    return heroShortNames[heroId] || null;
  }
}

