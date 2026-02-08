import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /meta command - Show current hero meta statistics
 */
export const metaCommand = {
  data: new SlashCommandBuilder()
    .setName('meta')
    .setDescription('Show current hero meta - win rates and pick rates')
    .addStringOption(option =>
      option.setName('bracket')
        .setDescription('Filter by rank bracket')
        .setRequired(false)
        .addChoices(
          { name: 'All Ranks', value: 'all' },
          { name: 'Herald/Guardian', value: 'herald_guardian' },
          { name: 'Crusader/Archon', value: 'crusader_archon' },
          { name: 'Legend/Ancient', value: 'legend_ancient' },
          { name: 'Divine/Immortal', value: 'divine_immortal' }
        )),

  async execute(interaction, stratzClient, dataProcessor, messageFormatter) {
    await interaction.deferReply();

    try {
      const bracket = interaction.options.getString('bracket') || 'all';
      
      logger.info(`Fetching hero meta stats for bracket: ${bracket}`);
      
      // Fetch hero meta stats from STRATZ
      const bracketParam = bracket === 'all' ? null : bracket;
      const heroStats = await stratzClient.getHeroMetaStats(bracketParam);

      if (!heroStats || heroStats.length === 0) {
        await interaction.editReply('No hero statistics available at this time.');
        return;
      }

      // Format and send the embed
      const embed = messageFormatter.formatHeroMeta(heroStats, bracket);
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error('Error fetching hero meta:', error);
      
      if (error.code === 10062) {
        return; // Interaction expired
      }
      
      try {
        await interaction.editReply('Failed to fetch hero meta statistics. Please try again later.');
      } catch (replyError) {
        if (replyError.code !== 10062) {
          logger.error('Failed to send error message:', replyError);
        }
      }
    }
  }
};
