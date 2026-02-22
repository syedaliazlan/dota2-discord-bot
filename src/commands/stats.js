import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /stats command - Display player statistics
 * Uses STRATZ API
 */
export const statsCommand = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Display your player statistics'),

  async execute(interaction, stratzClient, dataProcessor, messageFormatter, accountId) {
    // Defer immediately to prevent interaction timeout
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
      logger.debug(`/stats: fetching data for account ${accountId}`);
      const [playerData, winLossData, recentMatches] = await Promise.all([
        stratzClient.getPlayerTotals(accountId),
        stratzClient.getPlayerWinLoss(accountId),
        stratzClient.getRecentMatches(accountId, 20)
      ]);

      const stats = dataProcessor.processPlayerStatsWithMatches(playerData, winLossData, recentMatches);
      logger.debug(`/stats: W=${stats.wins}, L=${stats.losses}, WR=${stats.winRate}%`);
      const embed = messageFormatter.formatStats(stats);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing stats command:', error);
      await interaction.editReply('An error occurred while fetching statistics.');
    }
  }
};
