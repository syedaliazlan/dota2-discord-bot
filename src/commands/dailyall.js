import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /dailyall command - Show daily summary for all players
 */
export const dailyallCommand = {
  data: new SlashCommandBuilder()
    .setName('dailyall')
    .setDescription('Show daily summary for all tracked players (last 24 hours)'),

  async execute(interaction, opendotaClient, dataProcessor, messageFormatter, friendsManager) {
    await interaction.deferReply();

    try {
      if (!friendsManager) {
        await interaction.editReply('Friends list not configured. Please configure FRIENDS_LIST in .env file.');
        return;
      }

      await interaction.editReply('⏳ Generating daily summary for all players... This may take a moment.');

      const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
      const playerSummaries = [];
      const playersChecked = [];
      const playersWithNoMatches = [];

      // Get all friends
      const friends = friendsManager.getAllFriends();

      if (friends.length === 0) {
        await interaction.editReply('No friends found in the friends list.');
        return;
      }

      // Process each friend
      logger.detailInfo(`\n=== Processing ${friends.length} players for daily summary ===`);
      logger.detailInfo(`Time range: Last 24 hours (since ${new Date(twentyFourHoursAgo * 1000).toISOString()})`);
      
      for (const friend of friends) {
        try {
          // Track players checked
          playersChecked.push(friend.name);
          
          logger.detailInfo(`\n[${playersChecked.length}/${friends.length}] Checking player: ${friend.name}`);
          logger.detail(`  Account IDs: ${friend.ids.join(', ')}`);
          
          let bestAccountId = friend.ids[0];
          let recentMatches = [];
          
          // Helper function to validate account ID (already converted to Dota 2 Account ID)
          const validateAccountId = async (accountId) => {
            try {
              logger.detail(`      → Validating account ID: ${accountId}`);
              const playerData = await opendotaClient.getPlayer(accountId);
              
              if (!playerData || !playerData.profile) {
                logger.detail(`      ✗ Invalid account ID ${accountId}: No player profile found`);
                return { valid: false, accountId: null };
              }
              
              const playerName = playerData.profile.personaname || playerData.profile.name || 'Unknown';
              logger.detail(`      ✓ Valid account ID ${accountId}: Player name = "${playerName}"`);
              return { valid: true, accountId: accountId };
            } catch (error) {
              logger.detail(`      ✗ Error validating account ID ${accountId}:`, error.message);
              return { valid: false, accountId: null };
            }
          };
          
          // For players with multiple IDs, check all accounts to find matches
          if (friend.ids.length > 1) {
            logger.detailInfo(`  Multiple accounts detected, checking all ${friend.ids.length} accounts...`);
            // Check all accounts to find the one with most matches
            let bestMatchCount = 0;
            let bestAccountMatches = [];
            const validAccountIds = [];
            
            // Validate all account IDs (already converted by getAllFriends)
            for (let i = 0; i < friend.ids.length; i++) {
              const accountId = friend.ids[i]; // Already converted to Dota 2 Account ID
              const validation = await validateAccountId(accountId);
              if (validation.valid && validation.accountId) {
                validAccountIds.push(validation.accountId);
              }
              // Rate limiting between validation checks
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            if (validAccountIds.length === 0) {
              logger.detailInfo(`  ✗ No valid account IDs found for ${friend.name}`);
              playersWithNoMatches.push(friend.name);
              continue;
            }
            
            logger.detailInfo(`  Found ${validAccountIds.length}/${friend.ids.length} valid account(s), checking matches...`);
            
            // Now check matches for valid accounts
            for (let i = 0; i < validAccountIds.length; i++) {
              const accountId = validAccountIds[i];
              try {
                logger.detail(`    [${i + 1}/${validAccountIds.length}] Checking account ID: ${accountId}`);
                const matchesData = await opendotaClient.getPlayerMatches(accountId, 50);
                
                if (!matchesData || matchesData.length === 0) {
                  logger.detail(`      → No matches found in recent 50 matches`);
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  continue;
                }
                
                logger.detail(`      → Found ${matchesData.length} total matches in recent 50`);
                
                const accountMatches = (matchesData || []).filter(match => {
                  const isRecent = match.start_time >= twentyFourHoursAgo;
                  if (isRecent && logger.isDetailed()) {
                    const matchTime = new Date(match.start_time * 1000).toISOString();
                    logger.detail(`        ✓ Match ${match.match_id} at ${matchTime}`);
                  }
                  return isRecent;
                });
                
                logger.detail(`      → ${accountMatches.length} matches in last 24 hours`);
                
                if (accountMatches.length > bestMatchCount) {
                  bestMatchCount = accountMatches.length;
                  bestAccountId = accountId;
                  bestAccountMatches = accountMatches;
                  logger.detail(`      → New best account! (${bestMatchCount} matches)`);
                }
                
                // Rate limiting between account checks
                await new Promise(resolve => setTimeout(resolve, 1000));
              } catch (error) {
                logger.detail(`      ✗ Error checking account ${accountId} for ${friend.name}:`, error.message);
              }
            }
            
            recentMatches = bestAccountMatches;
            logger.detailInfo(`  Best account: ${bestAccountId} with ${bestMatchCount} matches`);
          } else {
            // Single account - validate first, then fetch matches (already converted by getAllFriends)
            logger.detailInfo(`  Single account, validating ID: ${bestAccountId}`);
            const validation = await validateAccountId(bestAccountId);
            
            if (!validation.valid || !validation.accountId) {
              logger.detailInfo(`  ✗ Invalid account ID for ${friend.name}: ${bestAccountId}`);
              playersWithNoMatches.push(friend.name);
              continue;
            }
            
            // Use the validated account ID
            bestAccountId = validation.accountId;
            logger.detailInfo(`  Account validated, checking matches...`);
            try {
              const matchesData = await opendotaClient.getPlayerMatches(bestAccountId, 50);
              
              if (!matchesData || matchesData.length === 0) {
                logger.detail(`    → No matches found in recent 50 matches`);
              } else {
                logger.detail(`    → Found ${matchesData.length} total matches in recent 50`);
              }
              
              recentMatches = (matchesData || []).filter(match => {
                const isRecent = match.start_time >= twentyFourHoursAgo;
                if (isRecent && logger.isDetailed()) {
                  const matchTime = new Date(match.start_time * 1000).toISOString();
                  logger.detail(`      ✓ Match ${match.match_id} at ${matchTime}`);
                }
                return isRecent;
              });
              
              logger.detail(`    → ${recentMatches.length} matches in last 24 hours`);
            } catch (error) {
              logger.detail(`    ✗ Error fetching matches:`, error.message);
            }
          }
          
          // Skip if no matches
          if (recentMatches.length === 0) {
            logger.detailInfo(`  ✗ No matches found for ${friend.name} in last 24 hours`);
            playersWithNoMatches.push(friend.name);
            continue;
          }
          
          logger.detailInfo(`  ✓ Found ${recentMatches.length} matches for ${friend.name}, processing...`);

          // Process matches to get accurate hero_id
          const accountIdNum = parseInt(bestAccountId);
          const processedMatches = recentMatches.map((match) => {
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

          // Process daily summary for this player
          const summary = dataProcessor.processDailySummary(processedMatches);
          playerSummaries.push({
            name: friend.name,
            accountId: bestAccountId,
            summary
          });

          // Rate limiting: wait 1 second between requests (free tier: 60 calls/min)
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(`Error processing daily summary for ${friend.name}:`, error);
          // Continue with other friends even if one fails
        }
      }

      // Send combined summary
      if (playerSummaries.length === 0) {
        const embed = messageFormatter.formatMultiPlayerDailySummary([]);
        await interaction.editReply({ embeds: [embed] });
      } else {
        const embed = messageFormatter.formatMultiPlayerDailySummary(playerSummaries);
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      logger.error('Error executing dailyall command:', error);
      await interaction.editReply('An error occurred while generating the daily summary.');
    }
  }
};

