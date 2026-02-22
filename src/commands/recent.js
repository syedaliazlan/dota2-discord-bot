import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /recent command - Show recent matches
 * Uses STRATZ API
 */
export const recentCommand = {
  data: new SlashCommandBuilder()
    .setName('recent')
    .setDescription('Show your recent matches')
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('Number of matches to show (default: 5)')
        .setMinValue(1)
        .setMaxValue(10)
    ),

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
      const limit = interaction.options.getInteger('limit') || 5;
      logger.debug(`/recent: fetching ${limit} matches for account ${accountId}`);

      const matchesData = await stratzClient.getRecentMatches(accountId, limit);

      if (!matchesData || matchesData.length === 0) {
        logger.debug(`/recent: no matches returned`);
        await interaction.editReply('No recent matches found.');
        return;
      }

      const matches = dataProcessor.processRecentMatches(matchesData);
      logger.debug(`/recent: processed ${matches.length} matches`);
      const embed = messageFormatter.formatRecentMatches(matches, limit);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing recent command:', error);
      await interaction.editReply('An error occurred while fetching recent matches.');
    }
  }
};
