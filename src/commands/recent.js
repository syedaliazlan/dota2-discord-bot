import { SlashCommandBuilder } from 'discord.js';
import { loadHeroesFromAPI, getHeroNameFromAPI } from '../utils/hero-loader.js';
import { logger } from '../utils/logger.js';

/**
 * /recent command - Show recent matches
 */
export const recentCommand = {
  data: new SlashCommandBuilder()
    .setName('recent')
    .setDescription('Show your recent matches')
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('Number of matches to show (default: 5)')
        .setMinValue(1)
        .setMaxValue(10)
    ),

  async execute(interaction, opendotaClient, dataProcessor, messageFormatter, accountId) {
    await interaction.deferReply();

    try {
      const limit = interaction.options.getInteger('limit') || 5;
      
      // Load heroes from API to get correct mapping
      const heroMap = await loadHeroesFromAPI(opendotaClient);
      
      // Use /matches endpoint per OpenDota docs: 
      // https://docs.opendota.com/#tag/players/operation/get_players_by_account_id_select_matches
      const matchesData = await opendotaClient.getPlayerMatches(accountId, limit);

      if (!matchesData || matchesData.length === 0) {
        await interaction.editReply('No recent matches found.');
        return;
      }

      const accountIdNum = parseInt(accountId);
      
      // Process matches - check if /matches endpoint includes players array
      const matchesWithDetails = matchesData.slice(0, limit).map((match) => {
        // If match includes players array, extract player data from it
        if (match.players && Array.isArray(match.players) && match.players.length > 0) {
          const player = match.players.find(p => p.account_id === accountIdNum);
          
          if (player && player.hero_id !== undefined) {
            match.hero_id = player.hero_id;
            match.kills = player.kills ?? match.kills;
            match.deaths = player.deaths ?? match.deaths;
            match.assists = player.assists ?? match.assists;
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
              const player = fullMatch.players.find(p => p.account_id === accountIdNum);
              if (player?.hero_id !== undefined) {
                match.hero_id = player.hero_id;
                match.kills = player.kills ?? match.kills;
                match.deaths = player.deaths ?? match.deaths;
                match.assists = player.assists ?? match.assists;
              }
            }
          } catch (error) {
            // Silently handle errors - will use original match data
          }
        }));
      }

      const matches = dataProcessor.processRecentMatches(matchesWithDetails);
      const embed = messageFormatter.formatRecentMatches(matches, limit);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing recent command:', error);
      await interaction.editReply('An error occurred while fetching recent matches.');
    }
  }
};

