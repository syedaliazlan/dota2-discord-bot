import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /listfriends command - List all players in the friends list
 */
export const listfriendsCommand = {
  data: new SlashCommandBuilder()
    .setName('listfriends')
    .setDescription('List all players in the friends list'),

  async execute(interaction, friendsManager) {
    await interaction.deferReply();

    try {
      if (!friendsManager) {
        await interaction.editReply('Friends list not configured. Please configure FRIENDS_LIST in .env file.');
        return;
      }

      const friends = friendsManager.getAllFriends();

      if (friends.length === 0) {
        await interaction.editReply('No friends found in the friends list.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('👥 Friends List')
        .setColor(0x00AE86)
        .setTimestamp();

      const friendList = friends.map((friend, index) => {
        // Format all IDs for this player
        const idsDisplay = friend.ids.length > 1
          ? friend.ids.map((id, idx) => `ID ${idx + 1}: ${id}`).join('\n   ')
          : `ID: ${friend.ids[0]}`;
        return `${index + 1}. **${friend.name}**\n   ${idsDisplay}`;
      }).join('\n\n');

      embed.setDescription(friendList);
      embed.setFooter({ text: `Total: ${friends.length} player(s)` });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing listfriends command:', error);
      await interaction.editReply('An error occurred while listing friends.');
    }
  }
};


