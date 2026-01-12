import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /heroes command - Show hero performance
 * Uses STRATZ API
 */
export const heroesCommand = {
  data: new SlashCommandBuilder()
    .setName('heroes')
    .setDescription('Show your top heroes by games played')
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('Number of heroes to show (default: 10)')
        .setMinValue(1)
        .setMaxValue(20)
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
      const limit = interaction.options.getInteger('limit') || 10;
      
      // Fetch hero stats from STRATZ
      const heroesData = await stratzClient.getPlayerHeroes(accountId);

      if (!heroesData || heroesData.length === 0) {
        await interaction.editReply('No hero statistics available.');
        return;
      }

      const heroes = dataProcessor.processHeroStats(heroesData);
      const embed = messageFormatter.formatHeroes(heroes, limit);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing heroes command:', error);
      await interaction.editReply('An error occurred while fetching hero statistics.');
    }
  }
};
