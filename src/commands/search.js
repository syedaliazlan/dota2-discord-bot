import { SlashCommandBuilder } from 'discord.js';
import { loadHeroesFromAPI } from '../utils/hero-loader.js';
import { logger } from '../utils/logger.js';

/**
 * /search command - Search for player's recent matches by ID or name
 */
export const searchCommand = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for a player\'s recent matches by ID or name')
    .addStringOption(option =>
      option.setName('player')
        .setDescription('Player name (from friends list), Steam Account ID, or Dota 2 Account ID')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('Number of matches to show (default: 5)')
        .setMinValue(1)
        .setMaxValue(10)
    ),

  async execute(interaction, opendotaClient, dataProcessor, messageFormatter, friendsManager) {
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
      const playerQuery = interaction.options.getString('player');
      const limit = interaction.options.getInteger('limit') || 5;

      // Find player using friends manager
      if (!friendsManager) {
        await interaction.editReply('Friends list not configured. Please configure FRIENDS_LIST in .env file.');
        return;
      }

      const player = friendsManager.findPlayer(playerQuery);
      if (!player) {
        await interaction.editReply(`Player "${playerQuery}" not found in friends list. Use /listfriends to see available players.`);
        return;
      }

      // Load heroes from API
      const heroMap = await loadHeroesFromAPI(opendotaClient);

      // Fetch matches
      const matchesData = await opendotaClient.getPlayerMatches(player.accountId, limit);

      if (!matchesData || matchesData.length === 0) {
        await interaction.editReply(`No recent matches found for **${player.name}**.`);
        return;
      }

      const accountIdNum = parseInt(player.accountId);
      
      // Process matches
      const matchesWithDetails = matchesData.slice(0, limit).map((match) => {
        if (match.players && Array.isArray(match.players) && match.players.length > 0) {
          const playerData = match.players.find(p => p.account_id === accountIdNum);
          
          if (playerData && playerData.hero_id !== undefined) {
            match.hero_id = playerData.hero_id;
            match.kills = playerData.kills ?? match.kills;
            match.deaths = playerData.deaths ?? match.deaths;
            match.assists = playerData.assists ?? match.assists;
          }
        }
        
        return match;
      });
      
      // If matches don't have players array, fetch full match details
      const needsDetails = matchesWithDetails.filter(m => !m.players || m.players.length === 0);
      if (needsDetails.length > 0) {
        await Promise.all(needsDetails.map(async (match) => {
          try {
            const fullMatch = await opendotaClient.getMatch(match.match_id);
            if (fullMatch?.players?.length > 0) {
              const playerData = fullMatch.players.find(p => p.account_id === accountIdNum);
              if (playerData?.hero_id !== undefined) {
                match.hero_id = playerData.hero_id;
                match.kills = playerData.kills ?? match.kills;
                match.deaths = playerData.deaths ?? match.deaths;
                match.assists = playerData.assists ?? match.assists;
              }
            }
          } catch (error) {
            // Silently handle errors
          }
        }));
      }

      const matches = dataProcessor.processRecentMatches(matchesWithDetails);
      const embed = messageFormatter.formatRecentMatches(matches, limit);
      
      // Update embed title to include player name
      embed.setTitle(`🎮 Recent Matches - ${player.name}`);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing search command:', error);
      await interaction.editReply('An error occurred while searching for matches.');
    }
  }
};


