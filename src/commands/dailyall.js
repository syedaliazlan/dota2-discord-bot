import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /dailyall command - Show daily summary for all players
 * Uses STRATZ API - Shows previous day (UK time)
 */
export const dailyallCommand = {
  data: new SlashCommandBuilder()
    .setName('dailyall')
    .setDescription('Show daily summary for all tracked players (last 20 hours)'),

  /**
   * Get the time range for the last 20 hours from current time
   */
  getLast20HoursRange() {
    const now = new Date();
    const endTimestamp = Math.floor(now.getTime() / 1000);
    const startTimestamp = endTimestamp - (20 * 60 * 60); // 20 hours ago

    const dateString = 'Last 20 hours';

    return {
      startTimestamp,
      endTimestamp,
      dateString
    };
  },

  async execute(interaction, stratzClient, dataProcessor, messageFormatter, friendsManager) {
    try {
      await interaction.deferReply();
    } catch (error) {
      if (error.code === 10062) {
        logger.error('/dailyall: interaction expired before deferReply');
        return;
      }
      throw error;
    }

    try {
      if (!friendsManager) {
        logger.warn('/dailyall: no friendsManager configured');
        await interaction.editReply('Friends list not configured. Please configure FRIENDS_LIST in .env file.');
        return;
      }

      const { startTimestamp, endTimestamp, dateString } = this.getLast20HoursRange();
      logger.info(`/dailyall: date=${dateString}, range=${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()}`);
      await interaction.editReply(`⏳ Generating daily summary for ${dateString}... This may take a moment.`);

      const playerSummaries = [];
      const allRampages = [];

      const friends = friendsManager.getAllFriends();

      if (friends.length === 0) {
        logger.warn('/dailyall: friends list is empty');
        await interaction.editReply('No friends found in the friends list.');
        return;
      }

      logger.info(`/dailyall: processing ${friends.length} players: [${friends.map(f => `${f.name}(${f.ids.join('/')})`).join(', ')}]`);

      for (const friend of friends) {
        try {
          logger.info(`/dailyall: --- checking ${friend.name} (IDs: [${friend.ids.join(', ')}]) ---`);

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

                logger.debug(`/dailyall: ${friend.name} account ${accountId} -> ${matchesData.length} since start, ${filteredMatches.length} in range`);

                if (filteredMatches.length > bestMatchCount) {
                  bestMatchCount = filteredMatches.length;
                  bestAccountId = accountId;
                  bestAccountMatches = filteredMatches;
                }

                await new Promise(resolve => setTimeout(resolve, 100));
              } catch (error) {
                logger.warn(`/dailyall: Error checking account ${accountId} for ${friend.name}: ${error.message}`);
              }
            }

            recentMatches = bestAccountMatches;
          } else {
            try {
              const matchesData = await stratzClient.getPlayerMatchesSince(bestAccountId, startTimestamp, 50);
              recentMatches = matchesData.filter(m =>
                m.startDateTime >= startTimestamp && m.startDateTime <= endTimestamp
              );
              logger.debug(`/dailyall: ${friend.name} account ${bestAccountId} -> ${matchesData.length} since start, ${recentMatches.length} in range`);
            } catch (error) {
              logger.warn(`/dailyall: Error fetching matches for ${friend.name}: ${error.message}`);
            }
          }

          if (recentMatches.length === 0) {
            logger.info(`/dailyall: ${friend.name}: NO MATCHES on ${dateString} - skipping`);
            continue;
          }

          logger.info(`/dailyall: ${friend.name}: ${recentMatches.length} match(es) [IDs: ${recentMatches.map(m => m.id).join(', ')}]`);

          const summary = dataProcessor.processDailySummary(recentMatches);
          logger.debug(`/dailyall: ${friend.name}: summary -> ${summary.totalMatches} matches, ${summary.wins}W/${summary.losses}L, WR=${summary.winRate}%`);

          const matchIds = recentMatches.map(m => m.id);

          try {
            logger.debug(`/dailyall: ${friend.name}: fetching feats for account ${bestAccountId}`);
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
              logger.info(`/dailyall: ${friend.name} got ${summary.rampages} rampage(s), ${summary.ultraKills} ultra kill(s), ${summary.tripleKills} triple kill(s)!`);
            }
          } catch (error) {
            logger.warn(`/dailyall: Error fetching feats for ${friend.name}: ${error.message}`);
          }

          logger.info(`/dailyall: ${friend.name}: ADDED to summary (${summary.totalMatches} matches, ${summary.wins}W-${summary.losses}L)`);
          playerSummaries.push({
            name: friend.name,
            accountId: bestAccountId,
            summary
          });

          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error(`/dailyall: Error processing ${friend.name}: ${error.message}`, error.stack);
        }
      }

      // Log final results
      logger.info(`/dailyall: === RESULTS: ${playerSummaries.length}/${friends.length} players had matches ===`);
      if (playerSummaries.length > 0) {
        logger.info(`/dailyall: Players in summary: [${playerSummaries.map(p => `${p.name}(${p.summary.totalMatches})`).join(', ')}]`);
      }
      const skippedPlayers = friends.filter(f => !playerSummaries.some(p => p.name === f.name));
      if (skippedPlayers.length > 0) {
        logger.info(`/dailyall: Players skipped (no matches): [${skippedPlayers.map(f => f.name).join(', ')}]`);
      }

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
      logger.info(`/dailyall: command complete`);
    } catch (error) {
      logger.error('/dailyall: command failed:', error);

      if (error.code !== 10062) {
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply('An error occurred while generating the daily summary.');
          } else {
            await interaction.reply({ content: 'An error occurred while generating the daily summary.', ephemeral: true });
          }
        } catch (replyError) {
          if (replyError.code !== 10062) {
            logger.error('/dailyall: failed to send error message:', replyError);
          }
        }
      }
    }
  }
};
