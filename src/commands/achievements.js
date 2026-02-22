import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /achievements command - Display achievements (feats)
 * Uses STRATZ API feats endpoint
 */
export const achievementsCommand = {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('Display your achievements'),

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
      logger.debug(`/achievements: fetching feats for account ${accountId}`);
      const feats = await stratzClient.getPlayerAchievements(accountId);

      const achievements = dataProcessor.processAchievements(feats);
      logger.debug(`/achievements: processed ${achievements.length} achievements`);
      const embed = messageFormatter.formatAchievements(achievements);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing achievements command:', error);
      await interaction.editReply('An error occurred while fetching achievements.');
    }
  }
};
