import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /live command - Check live match status
 */
export const liveCommand = {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Check if you are currently in a live match'),

  async execute(interaction, opendotaClient, messageFormatter, accountId) {
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
      const liveMatches = await opendotaClient.getLiveMatches();

      if (!liveMatches || liveMatches.length === 0) {
        await interaction.editReply('No live matches found.');
        return;
      }

      // Check if player is in any live match
      const accountIdNum = parseInt(accountId);
      const playerMatch = liveMatches.find(match => 
        match.players?.some(player => player.account_id === accountIdNum)
      );

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

