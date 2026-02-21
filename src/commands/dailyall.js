import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /dailyall command - Show daily summary for all players
 * Uses STRATZ API - Shows previous day (UK time)
 */
export const dailyallCommand = {
  data: new SlashCommandBuilder()
    .setName('dailyall')
    .setDescription('Show daily summary for all tracked players (previous day UK time)'),

  /**
   * Get the previous day's time range in UK time (Europe/London)
   */
  getPreviousDayRange() {
    const now = new Date();
    
    const ukFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    const ukParts = ukFormatter.formatToParts(now);
    const ukYear = parseInt(ukParts.find(p => p.type === 'year').value);
    const ukMonth = parseInt(ukParts.find(p => p.type === 'month').value) - 1;
    const ukDay = parseInt(ukParts.find(p => p.type === 'day').value);
    
    const yesterdayUK = new Date(Date.UTC(ukYear, ukMonth, ukDay - 1));
    
    const startOfYesterday = new Date(yesterdayUK);
    startOfYesterday.setUTCHours(0, 0, 0, 0);
    
    const ukString = startOfYesterday.toLocaleString('en-GB', { timeZone: 'Europe/London', timeZoneName: 'short' });
    const ukOffset = ukString.includes('BST') ? 60 : 0;
    startOfYesterday.setTime(startOfYesterday.getTime() - ukOffset * 60 * 1000);
    
    const endOfYesterday = new Date(startOfYesterday);
    endOfYesterday.setTime(endOfYesterday.getTime() + (24 * 60 * 60 * 1000) - 1000);
    
    // Format date from the correctly-rolled-back yesterdayUK date
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateString = `${yesterdayUK.getUTCDate()}-${months[yesterdayUK.getUTCMonth()]}-${yesterdayUK.getUTCFullYear()}`;
    
    return {
      startTimestamp: Math.floor(startOfYesterday.getTime() / 1000),
      endTimestamp: Math.floor(endOfYesterday.getTime() / 1000),
      dateString
    };
  },

  async execute(interaction, stratzClient, dataProcessor, messageFormatter, friendsManager) {
    try {
      await interaction.deferReply();
    } catch (error) {
      if (error.code === 10062) {
        logger.error('Interaction expired before deferReply could complete');
        return;
      }
      throw error;
    }

    try {
      if (!friendsManager) {
        await interaction.editReply('Friends list not configured. Please configure FRIENDS_LIST in .env file.');
        return;
      }

      const { startTimestamp, endTimestamp, dateString } = this.getPreviousDayRange();
      await interaction.editReply(`⏳ Generating daily summary for ${dateString} (UK time)... This may take a moment.`);

      const playerSummaries = [];
      const allRampages = [];

      const friends = friendsManager.getAllFriends();

      if (friends.length === 0) {
        await interaction.editReply('No friends found in the friends list.');
        return;
      }

      logger.detailInfo(`\n=== Processing ${friends.length} players for daily summary ===`);
      logger.detailInfo(`Time range: ${dateString} UK time`);
      
      for (const friend of friends) {
        try {
          logger.detailInfo(`Checking player: ${friend.name}`);
          
          let bestAccountId = friend.ids[0];
          let recentMatches = [];
          
          if (friend.ids.length > 1) {
            let bestMatchCount = 0;
            let bestAccountMatches = [];
            
            for (const accountId of friend.ids) {
              try {
                const matchesData = await stratzClient.getPlayerMatchesSince(accountId, startTimestamp, 50);
                const filteredMatches = matchesData.filter(m => 
                  m.startDateTime >= startTimestamp && m.startDateTime <= endTimestamp
                );
                
                if (filteredMatches.length > bestMatchCount) {
                  bestMatchCount = filteredMatches.length;
                  bestAccountId = accountId;
                  bestAccountMatches = filteredMatches;
                }
                
                await new Promise(resolve => setTimeout(resolve, 100));
              } catch (error) {
                logger.detail(`Error checking account ${accountId} for ${friend.name}:`, error.message);
              }
            }
            
            recentMatches = bestAccountMatches;
          } else {
            try {
              const matchesData = await stratzClient.getPlayerMatchesSince(bestAccountId, startTimestamp, 50);
              recentMatches = matchesData.filter(m => 
                m.startDateTime >= startTimestamp && m.startDateTime <= endTimestamp
              );
            } catch (error) {
              logger.detail(`Error fetching matches for ${friend.name}:`, error.message);
            }
          }
          
          if (recentMatches.length === 0) {
            logger.detailInfo(`No matches found for ${friend.name} on ${dateString}`);
            continue;
          }
          
          logger.detailInfo(`Found ${recentMatches.length} matches for ${friend.name}`);

          const summary = dataProcessor.processDailySummary(recentMatches);
          
          // Get match IDs from recent matches
          const matchIds = recentMatches.map(m => m.id);
          
          // Check feats for all multi-kills (rampages, ultra kills, triple kills)
          try {
            const feats = await stratzClient.getPlayerAchievements(bestAccountId, 200);
            const multiKillFeats = stratzClient.getMultiKillFeatsFromMatches(feats, matchIds);

            summary.rampages = multiKillFeats.filter(f => f.type === 'RAMPAGE').length;
            summary.ultraKills = multiKillFeats.filter(f => f.type === 'ULTRA_KILL').length;
            summary.tripleKills = multiKillFeats.filter(f => f.type === 'TRIPLE_KILL').length;

            for (const feat of multiKillFeats.filter(f => f.type === 'RAMPAGE')) {
              const matchData = recentMatches.find(m => m.id === feat.matchId);
              if (matchData) {
                const player = matchData.players?.[0];
                const win = player?.isRadiant === matchData.didRadiantWin;
                allRampages.push({
                  playerName: friend.name,
                  heroId: feat.heroId,
                  matchId: feat.matchId,
                  kills: player?.kills || 0,
                  deaths: player?.deaths || 0,
                  assists: player?.assists || 0,
                  win: win
                });
              }
            }

            if ((summary.rampages + summary.ultraKills + summary.tripleKills) > 0) {
              logger.info(`${friend.name} got ${summary.rampages} rampage(s), ${summary.ultraKills} ultra kill(s), ${summary.tripleKills} triple kill(s)!`);
            }
          } catch (error) {
            logger.warn(`Error fetching feats for ${friend.name}:`, error.message);
          }
          
          playerSummaries.push({
            name: friend.name,
            accountId: bestAccountId,
            summary
          });

          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error(`Error processing daily summary for ${friend.name}:`, error);
        }
      }

      // Send rampage info as part of the reply if any found
      let rampageInfo = '';
      if (allRampages.length > 0) {
        rampageInfo = `\n\n🔥 **${allRampages.length} Rampage(s) detected!** Check the channel for notifications.`;
      }

      if (playerSummaries.length === 0) {
        const embed = messageFormatter.formatMultiPlayerDailySummary([], dateString);
        try {
          await interaction.editReply({ content: null, embeds: [embed] });
        } catch (replyError) {
          if (replyError.code !== 10062) throw replyError;
        }
      } else {
        const embed = messageFormatter.formatMultiPlayerDailySummary(playerSummaries, dateString);
        try {
          await interaction.editReply({ content: rampageInfo || null, embeds: [embed] });
        } catch (replyError) {
          if (replyError.code !== 10062) throw replyError;
        }
      }
    } catch (error) {
      logger.error('Error executing dailyall command:', error);
      
      if (error.code !== 10062) {
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply('An error occurred while generating the daily summary.');
          } else {
            await interaction.reply({ content: 'An error occurred while generating the daily summary.', ephemeral: true });
          }
        } catch (replyError) {
          if (replyError.code !== 10062) {
            logger.error('Failed to send error message:', replyError);
          }
        }
      }
    }
  }
};
