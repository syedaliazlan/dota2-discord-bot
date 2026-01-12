import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /search command - Search for a player by name
 * Uses STRATZ API
 */
export const searchCommand = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for a player by name')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Player name to search for')
        .setRequired(true)
    ),

  async execute(interaction, stratzClient, dataProcessor, messageFormatter, friendsManager) {
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
      const searchName = interaction.options.getString('name');
      
      // First check if it's in friends list
      if (friendsManager) {
        const friend = friendsManager.getFriend(searchName);
        if (friend) {
          const accountId = friend.ids[0];
          const playerData = await stratzClient.getPlayer(accountId);
          
          if (playerData) {
            const profile = dataProcessor.processPlayerProfile(playerData);
            const embed = messageFormatter.formatProfile(profile);
            embed.setTitle(`👤 ${friend.name}'s Profile`);
            await interaction.editReply({ embeds: [embed] });
            return;
          }
        }
      }
      
      // If not in friends list, try to search by account ID if it's a number
      if (!isNaN(searchName)) {
        const playerData = await stratzClient.getPlayer(searchName);
        
        if (playerData) {
          const profile = dataProcessor.processPlayerProfile(playerData);
          const embed = messageFormatter.formatProfile(profile);
          await interaction.editReply({ embeds: [embed] });
          return;
        }
      }
      
      await interaction.editReply(`Could not find player "${searchName}". Try using their Steam Account ID or add them to your friends list.`);
    } catch (error) {
      logger.error('Error executing search command:', error);
      await interaction.editReply('An error occurred while searching for the player.');
    }
  }
};
