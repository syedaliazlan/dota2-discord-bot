import cron from 'node-cron';
import { logger } from '../utils/logger.js';

/**
 * Polling service to check for updates at regular intervals
 * Uses STRATZ API for all data
 *
 * Checks all tracked players (main + friends) for:
 * - New matches
 * - Multi-kills (triple, ultra, rampage) via STRATZ feats API
 * - Rank changes via seasonRank
 * - Live matches
 */
export class PollingService {
  constructor(stratzClient, dataProcessor, stateCache, discordBot, messageFormatter, accountId, intervalMinutes, friendsManager = null, dailySummaryConfig = null) {
    this.stratzClient = stratzClient;
    this.dataProcessor = dataProcessor;
    this.stateCache = stateCache;
    this.discordBot = discordBot;
    this.messageFormatter = messageFormatter;
    this.accountId = accountId;
    this.intervalMinutes = intervalMinutes;
    this.friendsManager = friendsManager;
    this.dailySummaryConfig = dailySummaryConfig || {
      weekdayTime: { hour: 3, minute: 0 },
      weekendTime: { hour: 22, minute: 0 }
    };
    this.isRunning = false;
    this.cronJob = null;
    this.dailySummaryJob = null;
  }

  /**
   * Start polling service
   */
  start() {
    if (this.isRunning) {
      logger.warn('Polling service is already running');
      return;
    }

    // Convert minutes to cron expression (every X minutes)
    const cronExpression = `*/${this.intervalMinutes} * * * *`;

    this.cronJob = cron.schedule(cronExpression, async () => {
      await this.checkForUpdates();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.isRunning = true;
    logger.info(`Polling service started (checking every ${this.intervalMinutes} minutes)`);

    // Skip immediate poll - let the cron job handle it to avoid overwhelming API on startup
    logger.info('Skipping initial poll - first check will run in ' + this.intervalMinutes + ' minutes');

    // Setup daily summary with configurable times
    // node-cron: 0=Sunday, 1=Monday, ..., 6=Saturday
    const weekdayHour = this.dailySummaryConfig.weekdayTime.hour;
    const weekdayMinute = this.dailySummaryConfig.weekdayTime.minute;
    const weekendHour = this.dailySummaryConfig.weekendTime.hour;
    const weekendMinute = this.dailySummaryConfig.weekendTime.minute;

    // Weekdays: Monday-Friday
    cron.schedule(`${weekdayMinute} ${weekdayHour} * * 1-5`, async () => {
      await this.sendDailySummary();
    }, {
      scheduled: true,
      timezone: 'Europe/London'
    });

    // Weekends: Saturday-Sunday
    cron.schedule(`${weekendMinute} ${weekendHour} * * 0,6`, async () => {
      await this.sendDailySummary();
    }, {
      scheduled: true,
      timezone: 'Europe/London'
    });

    logger.info(`Daily summary scheduled: ${weekdayHour.toString().padStart(2, '0')}:${weekdayMinute.toString().padStart(2, '0')} UK time (Mon-Fri), ${weekendHour.toString().padStart(2, '0')}:${weekendMinute.toString().padStart(2, '0')} UK time (Sat-Sun)`);
  }

  /**
   * Stop polling service
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    if (this.dailySummaryJob) {
      this.dailySummaryJob.stop();
      this.dailySummaryJob = null;
    }
    this.isRunning = false;
    logger.info('Polling service stopped');
  }

  /**
   * Get all players to check (main account + friends)
   */
  getAllPlayers() {
    if (this.friendsManager) {
      return this.friendsManager.getAllFriends();
    }
    return [{ name: 'You', ids: [this.accountId] }];
  }

  /**
   * Check for updates (new matches, stat changes, etc.) for ALL tracked players
   */
  async checkForUpdates() {
    try {
      const players = this.getAllPlayers();

      for (const player of players) {
        const accountId = player.ids[0]; // Use primary account ID
        const playerName = player.name;

        try {
          // Check for new matches for this player
          await this.checkNewMatchesForPlayer(accountId, playerName);

          // Small delay between players to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          logger.error(`Error checking updates for ${playerName}:`, error.message);
        }
      }

      // Check rank changes for main account
      await this.checkRankChanges();

      // Check for live matches (main account only - STRATZ live search is expensive)
      await this.checkLiveMatches();

      // Save cache after checks
      await this.stateCache.save();
    } catch (error) {
      logger.error('Error during update check:', error);
    }
  }

  /**
   * Check for new matches for a specific player using STRATZ API
   */
  async checkNewMatchesForPlayer(accountId, playerName) {
    try {
      // Get recent matches from STRATZ
      const matchesData = await this.stratzClient.getRecentMatches(accountId, 10);

      if (!matchesData || matchesData.length === 0) {
        return;
      }

      const processed = this.dataProcessor.processRecentMatches(matchesData);
      const cacheKey = `lastMatchId_${accountId}`;
      const lastMatchId = this.stateCache.get(cacheKey) || (accountId === this.accountId ? this.stateCache.getLastMatchId() : null);

      // Find new matches
      let newMatches;
      if (!lastMatchId) {
        // First run for this player, cache the latest match
        if (processed.length > 0) {
          this.stateCache.set(cacheKey, processed[0].matchId);
          if (accountId === this.accountId) {
            this.stateCache.setLastMatchId(processed[0].matchId);
          }
        }
        return;
      }

      newMatches = processed.filter(match => match.matchId > lastMatchId);

      if (newMatches.length > 0) {
        // Update cache with latest match ID
        this.stateCache.set(cacheKey, newMatches[0].matchId);
        if (accountId === this.accountId) {
          this.stateCache.setLastMatchId(newMatches[0].matchId);
        }

        logger.info(`Found ${newMatches.length} new match(es) for ${playerName}`);

        // Collect new match IDs for feat checking
        const newMatchIds = newMatches.map(m => m.matchId);

        // Send notification for each new match (oldest first)
        for (const match of newMatches.reverse()) {
          const embed = this.messageFormatter.formatNewMatch(match, playerName);
          await this.discordBot.sendNotification(null, embed);

          // Small delay between notifications
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Check for multi-kills (triple, ultra, rampage) using feats API
        await this.checkMultiKillsForMatches(accountId, playerName, newMatchIds, matchesData);
      }
    } catch (error) {
      logger.error(`Error checking new matches for ${playerName}:`, error);
    }
  }

  /**
   * Check for multi-kills (triple, ultra, rampage) using STRATZ feats API
   * This is more reliable than manual kill event analysis
   */
  async checkMultiKillsForMatches(accountId, playerName, matchIds, matchesData) {
    try {
      // Fetch player feats (achievements) from STRATZ
      const feats = await this.stratzClient.getPlayerAchievements(accountId, 200);

      if (!feats || feats.length === 0) {
        // Feats not available yet (replay may not be parsed), fall back to kill events
        await this.checkMultiKillsFromKillEvents(accountId, playerName, matchIds);
        return;
      }

      const matchIdSet = new Set(matchIds.map(id => parseInt(id)));

      // Filter feats to only those from our new matches
      const relevantFeats = feats.filter(feat => matchIdSet.has(feat.matchId));

      if (relevantFeats.length === 0) {
        // No feats found for these matches yet, fall back to kill events
        await this.checkMultiKillsFromKillEvents(accountId, playerName, matchIds);
        return;
      }

      // Process each feat type
      for (const feat of relevantFeats) {
        const cacheKey = `${feat.type}_${feat.matchId}_${accountId}`;

        // Skip if already notified
        if (this.stateCache.isMultiKillDetected(feat.matchId, accountId, feat.type)) {
          continue;
        }

        // Find match data for context
        const matchData = matchesData?.find(m => m.id === feat.matchId || m.id === parseInt(feat.matchId));
        const player = matchData?.players?.[0];
        const win = player ? (player.isRadiant === matchData.didRadiantWin) : false;

        switch (feat.type) {
          case 'RAMPAGE':
            logger.info(`🔥 RAMPAGE detected for ${playerName} in match ${feat.matchId} (via feats)`);
            this.stateCache.markMultiKillDetected(feat.matchId, accountId, playerName, 'RAMPAGE');
            await this.sendMultiKillNotification(playerName, feat, 'RAMPAGE', player, win, matchData);
            break;

          case 'ULTRA_KILL':
            logger.info(`⚡ ULTRA KILL detected for ${playerName} in match ${feat.matchId} (via feats)`);
            this.stateCache.markMultiKillDetected(feat.matchId, accountId, playerName, 'ULTRA_KILL');
            await this.sendMultiKillNotification(playerName, feat, 'ULTRA_KILL', player, win, matchData);
            break;

          case 'TRIPLE_KILL':
            logger.info(`💥 TRIPLE KILL detected for ${playerName} in match ${feat.matchId} (via feats)`);
            this.stateCache.markMultiKillDetected(feat.matchId, accountId, playerName, 'TRIPLE_KILL');
            await this.sendMultiKillNotification(playerName, feat, 'TRIPLE_KILL', player, win, matchData);
            break;
        }

        // Small delay between notifications
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      logger.error(`Error checking multi-kills via feats for ${playerName}:`, error.message);
      // Fall back to kill events analysis
      await this.checkMultiKillsFromKillEvents(accountId, playerName, matchIds);
    }
  }

  /**
   * Fallback: Check for multi-kills using kill event analysis
   * Used when feats are not yet available (replay not parsed)
   */
  async checkMultiKillsFromKillEvents(accountId, playerName, matchIds) {
    for (const matchId of matchIds) {
      try {
        // Skip if already checked via feats
        if (this.stateCache.isMultiKillDetected(matchId, accountId, 'RAMPAGE') ||
            this.stateCache.isMultiKillDetected(matchId, accountId, 'ULTRA_KILL') ||
            this.stateCache.isMultiKillDetected(matchId, accountId, 'TRIPLE_KILL')) {
          continue;
        }

        // Also skip legacy rampage detection
        if (this.stateCache.isRampageDetected(matchId, accountId)) {
          continue;
        }

        const matchData = await this.stratzClient.getMatchWithKillEvents(matchId);

        if (!matchData?.players) continue;

        const accountIdNum = parseInt(accountId);
        const player = matchData.players.find(p => p.steamAccountId === accountIdNum);

        if (!player?.stats?.killEvents) continue;

        const multiKills = this.stratzClient.detectMultiKillsFromKillEvents(player.stats.killEvents);
        const win = player.isRadiant === matchData.didRadiantWin;

        if (multiKills.rampages > 0) {
          logger.info(`🔥 RAMPAGE detected for ${playerName} in match ${matchId} (via kill events)`);
          this.stateCache.markMultiKillDetected(matchId, accountId, playerName, 'RAMPAGE');
          // Also mark in legacy cache for backwards compatibility
          this.stateCache.markRampageDetected(matchId, accountId, playerName);

          const embed = this.messageFormatter.formatRampageNotification(
            playerName, player.heroId, matchId,
            player.kills || 0, player.deaths || 0, player.assists || 0,
            win, matchData
          );
          await this.discordBot.sendNotification(null, embed);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (multiKills.ultraKills > 0) {
          logger.info(`⚡ ULTRA KILL detected for ${playerName} in match ${matchId} (via kill events)`);
          this.stateCache.markMultiKillDetected(matchId, accountId, playerName, 'ULTRA_KILL');

          const embed = this.messageFormatter.formatMultiKillNotification(
            playerName, player.heroId, matchId,
            player.kills || 0, player.deaths || 0, player.assists || 0,
            win, 'ULTRA_KILL', matchData
          );
          await this.discordBot.sendNotification(null, embed);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (multiKills.tripleKills > 0) {
          logger.info(`💥 TRIPLE KILL detected for ${playerName} in match ${matchId} (via kill events)`);
          this.stateCache.markMultiKillDetected(matchId, accountId, playerName, 'TRIPLE_KILL');

          const embed = this.messageFormatter.formatMultiKillNotification(
            playerName, player.heroId, matchId,
            player.kills || 0, player.deaths || 0, player.assists || 0,
            win, 'TRIPLE_KILL', matchData
          );
          await this.discordBot.sendNotification(null, embed);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        logger.error(`Error checking kill events for match ${matchId}:`, error.message);
      }
    }
  }

  /**
   * Send a multi-kill notification (triple, ultra, or rampage)
   */
  async sendMultiKillNotification(playerName, feat, killType, player, win, matchData) {
    try {
      const kills = player?.kills || 0;
      const deaths = player?.deaths || 0;
      const assists = player?.assists || 0;
      const heroId = feat.heroId || player?.heroId;

      let embed;
      if (killType === 'RAMPAGE') {
        embed = this.messageFormatter.formatRampageNotification(
          playerName, heroId, feat.matchId,
          kills, deaths, assists, win, matchData
        );
      } else {
        embed = this.messageFormatter.formatMultiKillNotification(
          playerName, heroId, feat.matchId,
          kills, deaths, assists, win, killType, matchData
        );
      }

      await this.discordBot.sendNotification(null, embed);
    } catch (error) {
      logger.error(`Error sending ${killType} notification:`, error.message);
    }
  }

  /**
   * Check for rank changes using STRATZ seasonRank
   */
  async checkRankChanges() {
    try {
      const players = this.getAllPlayers();

      for (const player of players) {
        const accountId = player.ids[0];
        const playerName = player.name;

        try {
          const playerData = await this.stratzClient.getPlayer(accountId);

          if (!playerData?.steamAccount?.seasonRank) continue;

          const currentRank = playerData.steamAccount.seasonRank;
          const currentLeaderboard = playerData.steamAccount.seasonLeaderboardRank;
          const cacheKey = `rank_${accountId}`;
          const cachedRank = this.stateCache.get(cacheKey);

          if (cachedRank === null || cachedRank === undefined) {
            // First time seeing this player's rank, cache it
            this.stateCache.set(cacheKey, currentRank);
            this.stateCache.set(`leaderboard_${accountId}`, currentLeaderboard);
            continue;
          }

          if (currentRank !== cachedRank) {
            const oldRank = cachedRank;
            const rankUp = currentRank > oldRank;

            logger.info(`🏅 Rank change for ${playerName}: ${oldRank} → ${currentRank} (${rankUp ? 'UP' : 'DOWN'})`);

            // Update cache
            this.stateCache.set(cacheKey, currentRank);
            this.stateCache.set(`leaderboard_${accountId}`, currentLeaderboard);

            // Send rank change notification
            const embed = this.messageFormatter.formatRankChange(
              playerName, oldRank, currentRank, currentLeaderboard
            );
            await this.discordBot.sendNotification(null, embed);
          }

          // Small delay between players
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          logger.error(`Error checking rank for ${playerName}:`, error.message);
        }
      }
    } catch (error) {
      logger.error('Error checking rank changes:', error);
    }
  }

  /**
   * Check for live matches using STRATZ API
   */
  async checkLiveMatches() {
    try {
      const liveMatch = await this.stratzClient.getPlayerLiveMatch(this.accountId);

      if (liveMatch) {
        // Check if we've already notified about this live match
        const lastLiveMatchId = this.stateCache.cache.lastLiveMatchId;

        if (lastLiveMatchId !== liveMatch.matchId) {
          logger.info('Player is in a live match');
          const embed = this.messageFormatter.formatLiveMatch(liveMatch);
          await this.discordBot.sendNotification(null, embed);

          this.stateCache.cache.lastLiveMatchId = liveMatch.matchId;
        }
      }
    } catch (error) {
      logger.error('Error checking for live matches:', error);
    }
  }

  /**
   * Manually trigger an update check
   */
  async triggerUpdate() {
    await this.checkForUpdates();
  }

  /**
   * Get the previous day's time range in UK time (Europe/London)
   * Returns { startTimestamp, endTimestamp, dateString } in Unix seconds
   */
  getPreviousDayRange() {
    // Get current date in UK time
    const now = new Date();

    // Create formatter for UK timezone to get the current date parts
    const ukFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    // Parse the UK date
    const ukParts = ukFormatter.formatToParts(now);
    const ukYear = parseInt(ukParts.find(p => p.type === 'year').value);
    const ukMonth = parseInt(ukParts.find(p => p.type === 'month').value) - 1; // 0-indexed
    const ukDay = parseInt(ukParts.find(p => p.type === 'day').value);

    // Create yesterday's date in UK time
    const yesterdayUK = new Date(Date.UTC(ukYear, ukMonth, ukDay - 1));

    // Calculate start of yesterday (00:00:00 UK time)
    // UK timezone offset varies (GMT/BST), so we need to account for it
    const startOfYesterday = new Date(yesterdayUK);
    startOfYesterday.setUTCHours(0, 0, 0, 0);

    // Adjust for UK timezone offset
    // Get the offset for yesterday's date
    const ukOffset = this.getUKOffset(startOfYesterday);
    startOfYesterday.setTime(startOfYesterday.getTime() - ukOffset * 60 * 1000);

    // End of yesterday (23:59:59 UK time)
    const endOfYesterday = new Date(startOfYesterday);
    endOfYesterday.setTime(endOfYesterday.getTime() + (24 * 60 * 60 * 1000) - 1000);

    // Format date as "11-Jan-2026"
    const dateString = this.formatDateString(ukDay - 1, ukMonth, ukYear);

    return {
      startTimestamp: Math.floor(startOfYesterday.getTime() / 1000),
      endTimestamp: Math.floor(endOfYesterday.getTime() / 1000),
      dateString
    };
  }

  /**
   * Format date as "11-Jan-2026"
   */
  formatDateString(day, month, year) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${day}-${months[month]}-${year}`;
  }

  /**
   * Get UK timezone offset in minutes for a given date
   */
  getUKOffset(date) {
    // Create a date string in UK timezone and parse the offset
    const ukString = date.toLocaleString('en-GB', { timeZone: 'Europe/London', timeZoneName: 'short' });
    // BST = British Summer Time (UTC+1), GMT = Greenwich Mean Time (UTC+0)
    if (ukString.includes('BST')) {
      return 60; // UTC+1
    }
    return 0; // GMT = UTC+0
  }

  /**
   * Send daily summary for the previous day (UK time) for all friends
   */
  async sendDailySummary() {
    try {
      logger.info('Generating daily summary for all friends...');

      // Get previous day range in UK time
      const { startTimestamp, endTimestamp, dateString } = this.getPreviousDayRange();
      logger.info(`Time range: Previous day (${dateString} UK time)`);
      logger.detailInfo(`From: ${new Date(startTimestamp * 1000).toISOString()} To: ${new Date(endTimestamp * 1000).toISOString()}`);

      const playerSummaries = [];
      const allMultiKills = []; // Collect all multi-kills for separate notifications

      // Get all friends or just the main account if no friends manager
      const friends = this.friendsManager
        ? this.friendsManager.getAllFriends()
        : [{ name: 'You', ids: [this.accountId] }];

      logger.detailInfo(`Processing ${friends.length} player(s)...`);

      // Process each friend
      for (const friend of friends) {
        logger.detailInfo(`Checking player: ${friend.name}`);
        try {
          let bestAccountId = friend.ids[0];
          let recentMatches = [];

          // For players with multiple IDs, check all accounts to find matches
          if (friend.ids.length > 1 && this.friendsManager) {
            let bestMatchCount = 0;
            let bestAccountMatches = [];

            for (const accountId of friend.ids) {
              try {
                // Use STRATZ's time-based query for efficiency
                const matchesData = await this.stratzClient.getPlayerMatchesSince(accountId, startTimestamp, 50);

                // Filter matches to only include those within the previous day
                const filteredMatches = matchesData.filter(m =>
                  m.startDateTime >= startTimestamp && m.startDateTime <= endTimestamp
                );

                if (filteredMatches.length > bestMatchCount) {
                  bestMatchCount = filteredMatches.length;
                  bestAccountId = accountId;
                  bestAccountMatches = filteredMatches;
                }

                // Small delay between account checks
                await new Promise(resolve => setTimeout(resolve, 100));
              } catch (error) {
                logger.warn(`Error checking account ${accountId} for ${friend.name}:`, error.message);
              }
            }

            recentMatches = bestAccountMatches;
          } else {
            // Single account - use time-based query
            const matchesData = await this.stratzClient.getPlayerMatchesSince(bestAccountId, startTimestamp, 50);
            // Filter to only previous day
            recentMatches = matchesData.filter(m =>
              m.startDateTime >= startTimestamp && m.startDateTime <= endTimestamp
            );
          }

          // Skip if no matches
          if (recentMatches.length === 0) {
            logger.detailInfo(`No matches found for ${friend.name} on ${dateString}`);
            continue;
          }

          logger.detailInfo(`Found ${recentMatches.length} matches for ${friend.name}`);

          // Process daily summary for this player
          const summary = this.dataProcessor.processDailySummary(recentMatches);

          // Get match IDs from recent matches
          const matchIds = recentMatches.map(m => m.id);

          // Check feats for all multi-kills (triple, ultra, rampage)
          try {
            const feats = await this.stratzClient.getPlayerAchievements(bestAccountId, 200);
            const multiKillFeats = this.stratzClient.getMultiKillFeatsFromMatches(feats, matchIds);

            summary.rampages = multiKillFeats.filter(f => f.type === 'RAMPAGE').length;
            summary.ultraKills = multiKillFeats.filter(f => f.type === 'ULTRA_KILL').length;
            summary.tripleKills = multiKillFeats.filter(f => f.type === 'TRIPLE_KILL').length;

            for (const feat of multiKillFeats) {
              const matchData = recentMatches.find(m => m.id === feat.matchId);
              if (matchData) {
                const player = matchData.players?.[0];
                const win = player?.isRadiant === matchData.didRadiantWin;
                allMultiKills.push({
                  playerName: friend.name,
                  heroId: feat.heroId,
                  matchId: feat.matchId,
                  kills: player?.kills || 0,
                  deaths: player?.deaths || 0,
                  assists: player?.assists || 0,
                  win: win,
                  type: feat.type,
                  matchData: matchData
                });
              }
            }

            if (multiKillFeats.length > 0) {
              logger.info(`${friend.name} got ${multiKillFeats.length} multi-kill feat(s)!`);
            }
          } catch (error) {
            logger.warn(`Error fetching feats for ${friend.name}:`, error.message);
          }

          playerSummaries.push({
            name: friend.name,
            accountId: bestAccountId,
            summary
          });

          // Small delay between players
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error(`Error processing daily summary for ${friend.name}:`, error);
        }
      }

      // First, send multi-kill notifications (separate messages)
      if (allMultiKills.length > 0) {
        logger.info(`🔥 Sending ${allMultiKills.length} multi-kill notification(s)...`);
        for (const mk of allMultiKills) {
          // Skip if already notified
          if (this.stateCache.isMultiKillDetected(mk.matchId, mk.playerName, mk.type)) {
            continue;
          }
          // Also check legacy rampage cache
          if (mk.type === 'RAMPAGE' && this.stateCache.isRampageDetected(mk.matchId, mk.playerName)) {
            continue;
          }

          let embed;
          if (mk.type === 'RAMPAGE') {
            embed = this.messageFormatter.formatRampageNotification(
              mk.playerName, mk.heroId, mk.matchId,
              mk.kills, mk.deaths, mk.assists, mk.win, mk.matchData
            );
          } else {
            embed = this.messageFormatter.formatMultiKillNotification(
              mk.playerName, mk.heroId, mk.matchId,
              mk.kills, mk.deaths, mk.assists, mk.win, mk.type, mk.matchData
            );
          }

          await this.discordBot.sendNotification(null, embed);
          this.stateCache.markMultiKillDetected(mk.matchId, mk.playerName, mk.playerName, mk.type);

          // Small delay between notifications
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Then send the daily summary
      if (playerSummaries.length === 0) {
        logger.info(`No matches on ${dateString} for any friend`);
        const embed = this.messageFormatter.formatMultiPlayerDailySummary([], dateString);
        await this.discordBot.sendNotification(null, embed);
      } else {
        const embed = this.messageFormatter.formatMultiPlayerDailySummary(playerSummaries, dateString);
        await this.discordBot.sendNotification(null, embed);
        logger.info(`Daily summary sent for ${playerSummaries.length} player(s)`);
      }

      // Update last daily summary timestamp
      this.stateCache.setLastDailySummary(new Date().toISOString());
      await this.stateCache.save();
    } catch (error) {
      logger.error('Error sending daily summary:', error);
    }
  }
}
