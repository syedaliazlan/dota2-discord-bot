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
    await interaction.deferReply();

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

