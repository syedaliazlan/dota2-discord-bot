import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /match command - Get specific match details
 * Uses STRATZ API
 */
export const matchCommand = {
  data: new SlashCommandBuilder()
    .setName('match')
    .setDescription('Get details for a specific match')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('Match ID')
        .setRequired(true)
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
      const matchId = interaction.options.getString('id');
      
      if (!matchId || isNaN(matchId)) {
        await interaction.editReply('Invalid match ID. Please provide a valid numeric match ID.');
        return;
      }

      // Fetch match from STRATZ
      const matchData = await stratzClient.getMatch(matchId);

      if (!matchData) {
        await interaction.editReply('Match not found. Please check the match ID.');
        return;
      }

      const match = dataProcessor.processMatchDetails(matchData);
      const embed = messageFormatter.formatMatch(match);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing match command:', error);
      await interaction.editReply('An error occurred while fetching match details.');
    }
  }
};
