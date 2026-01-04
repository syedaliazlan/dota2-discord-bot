import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /profile command - Display player profile overview
 */
export const profileCommand = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Display your Dota 2 profile overview'),

  async execute(interaction, opendotaClient, dotabuffScraper, dataProcessor, messageFormatter, accountId) {
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
      // Fetch data from both sources
      const [opendotaData, dotabuffData] = await Promise.all([
        opendotaClient.getPlayer(accountId),
        dotabuffScraper.getPlayerProfile(accountId).catch(() => null)
      ]);

      if (!opendotaData) {
        await interaction.editReply('Failed to fetch profile data. Please try again later.');
        return;
      }

      // Process and format
      const profile = dataProcessor.processPlayerProfile(opendotaData, dotabuffData);
      const embed = messageFormatter.formatProfile(profile);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing profile command:', error);
      await interaction.editReply('An error occurred while fetching your profile.');
    }
  }
};

