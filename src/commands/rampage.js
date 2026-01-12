import { SlashCommandBuilder } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /rampage command - Show rampages for all tracked players
 * Optionally filter by a specific day
 */
export const rampageCommand = {
  data: new SlashCommandBuilder()
    .setName('rampage')
    .setDescription('Show rampages for all tracked players')
    .addStringOption(option =>
      option.setName('day')
        .setDescription('Specific day to check (e.g., "11-Jan-2026" or "1" for yesterday, "2" for 2 days ago)')
        .setRequired(false)),

  /**
   * Parse day parameter and return start/end timestamps for that day (UK time)
   * Returns null if no day specified (show all rampages)
   */
  parseDayParameter(dayParam) {
    if (!dayParam) return null;

    const now = new Date();
    let targetDate;
    let dateString;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Check if it's a number (days ago, 0 = today)
    const daysAgo = parseInt(dayParam);
    if (!isNaN(daysAgo) && daysAgo >= 0) {
      // Get current UK date
      const ukFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      
      const ukParts = ukFormatter.formatToParts(now);
      const ukYear = parseInt(ukParts.find(p => p.type === 'year').value);
      const ukMonth = parseInt(ukParts.find(p => p.type === 'month').value) - 1;
      const ukDay = parseInt(ukParts.find(p => p.type === 'day').value);
      
      // Create the target date properly
      targetDate = new Date(Date.UTC(ukYear, ukMonth, ukDay - daysAgo));
      
      // Format the date string from the target date
      const targetDay = targetDate.getUTCDate();
      const targetMonth = targetDate.getUTCMonth();
      const targetYear = targetDate.getUTCFullYear();
      dateString = `${targetDay}-${months[targetMonth]}-${targetYear}`;
    } else {
      // Try to parse as date string (e.g., "11-Jan-2026")
      const match = dayParam.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
      if (!match) {
        return { error: 'Invalid date format. Use "11-Jan-2026" or a number like "1" for yesterday.' };
      }
      
      const day = parseInt(match[1]);
      const monthStr = match[2];
      const year = parseInt(match[3]);
      
      const monthIndex = months.findIndex(m => m.toLowerCase() === monthStr.toLowerCase());
      
      if (monthIndex === -1) {
        return { error: 'Invalid month. Use 3-letter format like "Jan", "Feb", etc.' };
      }
      
      targetDate = new Date(Date.UTC(year, monthIndex, day));
      dateString = dayParam;
    }

    // Calculate start and end of day in UK time
    const startOfDay = new Date(targetDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    
    // Adjust for UK timezone offset
    const ukString = startOfDay.toLocaleString('en-GB', { timeZone: 'Europe/London', timeZoneName: 'short' });
    const ukOffset = ukString.includes('BST') ? 60 : 0;
    startOfDay.setTime(startOfDay.getTime() - ukOffset * 60 * 1000);
    
    const endOfDay = new Date(startOfDay);
    endOfDay.setTime(endOfDay.getTime() + (24 * 60 * 60 * 1000) - 1000);

    return {
      startTimestamp: Math.floor(startOfDay.getTime() / 1000),
      endTimestamp: Math.floor(endOfDay.getTime() / 1000),
      dateString
    };
  },

  async execute(interaction, stratzClient, dataProcessor, messageFormatter, friendsManager, heroMap) {
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
      if (!friendsManager) {
        await interaction.editReply('Friends list not configured.');
        return;
      }

      const dayParam = interaction.options.getString('day');
      const dayRange = this.parseDayParameter(dayParam);

      if (dayRange?.error) {
        await interaction.editReply(dayRange.error);
        return;
      }

      const friends = friendsManager.getAllFriends();
      const allRampages = [];

      if (dayRange) {
        // Filter by specific day - need to get matches and check which rampages fall in range
        await interaction.editReply(`🔍 Searching for rampages on ${dayRange.dateString}...`);
        
        for (const friend of friends) {
          try {
            const accountId = friend.ids[0];
            
            // Get matches for this day
            const matchesData = await stratzClient.getPlayerMatchesSince(accountId, dayRange.startTimestamp, 50);
            const dayMatches = matchesData.filter(m => 
              m.startDateTime >= dayRange.startTimestamp && m.startDateTime <= dayRange.endTimestamp
            );
            
            if (dayMatches.length === 0) continue;
            
            const matchIds = dayMatches.map(m => m.id);
            
            // Get feats and filter for rampages in these matches
            const feats = await stratzClient.getPlayerAchievements(accountId, 200);
            const rampageFeats = stratzClient.getRampageFeatsFromMatches(feats, matchIds);
            
            for (const feat of rampageFeats) {
              const matchData = dayMatches.find(m => m.id === feat.matchId);
              const player = matchData?.players?.[0];
              
              allRampages.push({
                playerName: friend.name,
                heroId: feat.heroId,
                matchId: feat.matchId,
                kills: player?.kills || 0,
                deaths: player?.deaths || 0,
                assists: player?.assists || 0,
                win: player?.isRadiant === matchData?.didRadiantWin,
                matchData: matchData, // Store for enhanced display
                gpm: player?.goldPerMinute || 0,
                xpm: player?.experiencePerMinute || 0
              });
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            logger.warn(`Error fetching rampages for ${friend.name}:`, error.message);
          }
        }

        // Build response for specific day
        if (allRampages.length === 0) {
          const embed = new EmbedBuilder()
            .setColor(0xFF4500)
            .setTitle(`🔥 Rampages on ${dayRange.dateString}`)
            .setDescription('No rampages found for any tracked players on this day.')
            .setTimestamp();
          await interaction.editReply({ content: null, embeds: [embed] });
        } else {
          // Send enhanced rampage notification for each one
          const embeds = [];
          
          for (const rampage of allRampages) {
            const embed = messageFormatter.formatRampageNotification(
              rampage.playerName,
              rampage.heroId,
              rampage.matchId,
              rampage.kills,
              rampage.deaths,
              rampage.assists,
              rampage.win,
              rampage.matchData
            );
            embeds.push(embed);
          }
          
          // Discord allows max 10 embeds per message
          if (embeds.length <= 10) {
            await interaction.editReply({ 
              content: `🔥 Found **${allRampages.length}** rampage(s) on ${dayRange.dateString}!`, 
              embeds: embeds 
            });
          } else {
            // Send first 10, then follow up with rest
            await interaction.editReply({ 
              content: `🔥 Found **${allRampages.length}** rampage(s) on ${dayRange.dateString}! (showing first 10)`, 
              embeds: embeds.slice(0, 10) 
            });
          }
        }

      } else {
        // No day specified - show all recent rampages
        await interaction.editReply('🔍 Searching for recent rampages...');

        for (const friend of friends) {
          try {
            const accountId = friend.ids[0];
            
            // Fetch player feats (rampages are tracked here)
            const feats = await stratzClient.getPlayerAchievements(accountId, 100);
            
            // Filter for rampages only
            const rampageFeats = feats.filter(f => f.type === 'RAMPAGE');
            
            for (const feat of rampageFeats) {
              allRampages.push({
                playerName: friend.name,
                heroId: feat.heroId,
                matchId: feat.matchId
              });
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            logger.warn(`Error fetching rampages for ${friend.name}:`, error.message);
          }
        }

        if (allRampages.length === 0) {
          await interaction.editReply('No rampages found for any tracked players.');
          return;
        }

        // Sort by match ID (most recent first)
        allRampages.sort((a, b) => b.matchId - a.matchId);

        // Take top 10 most recent
        const recentRampages = allRampages.slice(0, 10);

        const embed = new EmbedBuilder()
          .setColor(0xFF4500)
          .setTitle('🔥💀 Recent Rampages 💀🔥')
          .setDescription(`Found **${allRampages.length}** total rampages across all players\n\n*Use \`/rampage day:1\` for detailed view of yesterday's rampages*`)
          .setTimestamp();

        let rampageList = '';
        for (const rampage of recentRampages) {
          const heroName = heroMap?.[rampage.heroId] || `Hero ${rampage.heroId}`;
          const stratzUrl = `https://stratz.com/matches/${rampage.matchId}`;
          rampageList += `🔥 **${rampage.playerName}** - ${heroName}\n`;
          rampageList += `└ [Match ${rampage.matchId}](${stratzUrl})\n`;
        }

        embed.addFields({
          name: '🏆 Top 10 Most Recent',
          value: rampageList || 'None found'
        });

        await interaction.editReply({ content: null, embeds: [embed] });
      }
      
    } catch (error) {
      logger.error('Error executing rampage command:', error);
      try {
        await interaction.editReply('An error occurred while fetching rampages.');
      } catch (e) {
        // Ignore
      }
    }
  }
};
