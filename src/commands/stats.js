import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /stats command - Display player statistics
 */
export const statsCommand = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Display your player statistics'),

  async execute(interaction, opendotaClient, dataProcessor, messageFormatter, accountId) {
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
      const [totalsData, winLossData] = await Promise.all([
        opendotaClient.getPlayerTotals(accountId),
        opendotaClient.getPlayerWinLoss(accountId)
      ]);

      const stats = dataProcessor.processPlayerStats(totalsData, winLossData);
      const embed = messageFormatter.formatStats(stats);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing stats command:', error);
      await interaction.editReply('An error occurred while fetching statistics.');
    }
  }
};

