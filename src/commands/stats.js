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
      // Fetch player data, win/loss, and recent matches for averages
      const [playerData, winLossData, recentMatches] = await Promise.all([
        stratzClient.getPlayerTotals(accountId),
        stratzClient.getPlayerWinLoss(accountId),
        stratzClient.getRecentMatches(accountId, 20) // Get 20 recent matches for averages
      ]);

      // Use the enhanced stats processor that calculates averages from recent matches
      const stats = dataProcessor.processPlayerStatsWithMatches(playerData, winLossData, recentMatches);
      const embed = messageFormatter.formatStats(stats);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing stats command:', error);
      await interaction.editReply('An error occurred while fetching statistics.');
    }
  }
};
