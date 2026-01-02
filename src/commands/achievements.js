import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /achievements command - Display achievements
 */
export const achievementsCommand = {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('Display your achievements'),

  async execute(interaction, dotabuffScraper, messageFormatter, accountId) {
    await interaction.deferReply();

    try {
      const achievements = await dotabuffScraper.getPlayerAchievements(accountId);

      const embed = messageFormatter.formatAchievements(achievements);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing achievements command:', error);
      await interaction.editReply('An error occurred while fetching achievements. Note: Achievements may not be available from Dotabuff.');
    }
  }
};

