import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /live command - Check live match status
 * Uses STRATZ API
 */
export const liveCommand = {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Check if you are currently in a live match'),

  async execute(interaction, stratzClient, messageFormatter, accountId) {
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
      // Check for live match using STRATZ
      const playerMatch = await stratzClient.getPlayerLiveMatch(accountId);

      if (playerMatch) {
        const embed = messageFormatter.formatLiveMatch(playerMatch);
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply('You are not currently in a live match.');
      }
    } catch (error) {
      logger.error('Error executing live command:', error);
      await interaction.editReply('An error occurred while checking live matches.');
    }
  }
};
