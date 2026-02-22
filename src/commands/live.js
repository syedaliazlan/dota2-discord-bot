import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * /live command - Check if any tracked player is in a live match
 * Checks main account and all friends
 */
export const liveCommand = {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Check if any tracked player is currently in a live match'),

  async execute(interaction, stratzClient, messageFormatter, accountId, friendsManager) {
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
      logger.debug(`/live: fetching live matches`);
      const liveMatches = await stratzClient.getLiveMatches();

      if (!liveMatches || liveMatches.length === 0) {
        logger.debug(`/live: no live matches on STRATZ`);
        await interaction.editReply('No live matches found on STRATZ right now.');
        return;
      }

      logger.debug(`/live: ${liveMatches.length} total live matches on STRATZ`);

      const playersToCheck = friendsManager
        ? friendsManager.getAllFriends()
        : [{ name: 'You', ids: [accountId] }];

      logger.debug(`/live: checking ${playersToCheck.length} player(s)`);
      const foundLive = [];

      for (const player of playersToCheck) {
        for (const id of player.ids) {
          const idNum = parseInt(id);
          const match = liveMatches.find(m =>
            m.players?.some(p => p.steamAccountId === idNum)
          );

          if (match) {
            // Find this player's data in the match
            const playerData = match.players.find(p => p.steamAccountId === idNum);
            foundLive.push({
              name: player.name,
              match,
              playerData
            });
            break; // Found this player, move to next
          }
        }
      }

      if (foundLive.length === 0) {
        logger.debug(`/live: no tracked players found in live matches`);
        await interaction.editReply('No tracked players are currently in a live match.');
        return;
      }

      logger.info(`/live: found ${foundLive.length} player(s) in live matches: [${foundLive.map(l => l.name).join(', ')}]`);

      const embed = new EmbedBuilder()
        .setTitle(`🔴 ${foundLive.length} Live Match${foundLive.length > 1 ? 'es' : ''} Found`)
        .setColor(0xFF0000)
        .setTimestamp();

      for (const live of foundLive) {
        const hero = live.playerData?.heroId
          ? messageFormatter.getHeroName(live.playerData.heroId)
          : 'Unknown';
        const team = live.playerData?.isRadiant ? 'Radiant' : 'Dire';
        const gameTime = live.match.gameTime != null
          ? `${Math.floor(live.match.gameTime / 60)}:${String(live.match.gameTime % 60).padStart(2, '0')}`
          : '??:??';
        const avgRank = live.match.averageRank
          ? messageFormatter.getRankText(live.match.averageRank)
          : 'Unknown';

        embed.addFields({
          name: `🎮 ${live.name}`,
          value: `**Hero:** ${hero}\n**Team:** ${team}\n**Game Time:** ${gameTime}\n**Avg Rank:** ${avgRank}\n**Match ID:** ${live.match.matchId}`,
          inline: foundLive.length > 1
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing live command:', error);
      await interaction.editReply('An error occurred while checking live matches.');
    }
  }
};
