import cron from 'node-cron';
import { logger } from '../utils/logger.js';

/**
 * Polling service to check for updates at regular intervals
 * Uses STRATZ API for all data
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
   * Check for updates (new matches, stat changes, etc.)
   */
  async checkForUpdates() {
    try {
      // Check for new matches
      await this.checkNewMatches();

      // Check for stat changes
      await this.checkStatChanges();

      // Check for rank changes
      await this.checkRankChanges();

      // Live match notifications disabled
      // await this.checkLiveMatches();

      // Save cache after checks
      await this.stateCache.save();
    } catch (error) {
      logger.error('Error during update check:', error);
    }
  }

  /**
   * Check for new matches using STRATZ API
   * Checks main account and all friends for new matches and rampages
   */
  async checkNewMatches() {
    try {
      // Get all players to check (main account + friends)
      const playersToCheck = this.friendsManager 
        ? this.friendsManager.getAllFriends()
        : [{ name: 'You', ids: [this.accountId] }];

      for (const player of playersToCheck) {
        // Use primary account ID for each player
        const accountId = player.ids[0];
        const playerName = player.name;

        try {
          // Get recent matches from STRATZ
          const matchesData = await this.stratzClient.getRecentMatches(accountId, 5);
          
          if (!matchesData || matchesData.length === 0) {
            continue;
          }

          // Process and detect new matches for this player
          const processed = this.dataProcessor.processRecentMatches(matchesData, accountId);
          const newMatches = this.dataProcessor.detectNewMatches(processed, accountId);

          if (newMatches.length > 0) {
            logger.info(`Found ${newMatches.length} new match(es) for ${playerName}`);

            // Check for multi-kills (rampages, ultra kills, triple kills) in new matches
            // Uses feats API first (batch), with kill events as fallback
            const newMatchIds = newMatches.map(m => m.matchId);
            await this.checkMultiKillsForMatches(newMatchIds, accountId, playerName);
          }

          // Small delay between players to avoid API rate limits
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          logger.warn(`Error checking matches for ${playerName}:`, error.message);
        }
      }
    } catch (error) {
      logger.error('Error checking for new matches:', error);
    }
  }

  /**
   * Check for multi-kills in new matches using feats API first, kill events as fallback
   */
  async checkMultiKillsForMatches(matchIds, accountId, playerName) {
    try {
      // Try feats API first (more reliable - STRATZ pre-calculates these)
      const feats = await this.stratzClient.getPlayerAchievements(accountId, 200);
      const multiKillFeats = feats ? this.stratzClient.getMultiKillFeatsFromMatches(feats, matchIds) : [];

      if (multiKillFeats.length > 0) {
        for (const feat of multiKillFeats) {
          if (this.stateCache.isMultiKillDetected(feat.matchId, accountId)) continue;

          this.stateCache.markMultiKillDetected(feat.matchId, accountId, playerName);

          if (feat.type === 'RAMPAGE') {
            logger.info(`🔥 RAMPAGE detected for ${playerName} in match ${feat.matchId} (via feats)`);
            const embed = this.messageFormatter.formatRampageNotification(
              playerName, feat.heroId, feat.matchId, 0, 0, 0, false, null
            );
            await this.discordBot.sendNotification(null, embed);
          } else if (feat.type === 'ULTRA_KILL') {
            logger.info(`⚡ ULTRA KILL detected for ${playerName} in match ${feat.matchId} (via feats)`);
            const embed = this.messageFormatter.formatUltraKillNotification(
              playerName, feat.heroId, feat.matchId, 0, 0, 0, false, 1, null
            );
            await this.discordBot.sendNotification(null, embed);
          } else if (feat.type === 'TRIPLE_KILL') {
            logger.info(`💥 TRIPLE KILL detected for ${playerName} in match ${feat.matchId} (via feats)`);
            const embed = this.messageFormatter.formatTripleKillNotification(
              playerName, feat.heroId, feat.matchId, 0, 0, 0, false, 1, null
            );
            await this.discordBot.sendNotification(null, embed);
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        return; // Feats found, no need for kill event fallback
      }

      // Fallback: check kill events for each match
      for (const matchId of matchIds) {
        await this.checkMultiKillsFromKillEvents(matchId, accountId, playerName);
      }
    } catch (error) {
      // Feats failed, fall back to kill events
      logger.warn(`Feats check failed for ${playerName}, using kill events: ${error.message}`);
      for (const matchId of matchIds) {
        await this.checkMultiKillsFromKillEvents(matchId, accountId, playerName);
      }
    }
  }

  /**
   * Fallback: Check for multi-kills using kill event timestamp analysis
   */
  async checkMultiKillsFromKillEvents(matchId, accountId, playerName) {
    try {
      if (this.stateCache.isMultiKillDetected(matchId, accountId)) return;

      const matchData = await this.stratzClient.getMatchWithKillEvents(matchId);
      if (!matchData?.players) return;

      const accountIdNum = parseInt(accountId);
      const player = matchData.players.find(p => p.steamAccountId === accountIdNum);
      if (!player?.stats?.killEvents) return;

      const multiKills = this.stratzClient.detectMultiKillsFromKillEvents(player.stats.killEvents);
      this.stateCache.markMultiKillDetected(matchId, accountId, playerName);

      const win = player.isRadiant === matchData.didRadiantWin;

      if (multiKills.rampages > 0) {
        logger.info(`🔥 RAMPAGE detected for ${playerName} in match ${matchId} (via kill events)`);
        const embed = this.messageFormatter.formatRampageNotification(
          playerName, player.heroId, matchId,
          player.kills || 0, player.deaths || 0, player.assists || 0, win, matchData
        );
        await this.discordBot.sendNotification(null, embed);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (multiKills.ultraKills > 0) {
        logger.info(`⚡ ULTRA KILL detected for ${playerName} in match ${matchId} (via kill events)`);
        const embed = this.messageFormatter.formatUltraKillNotification(
          playerName, player.heroId, matchId,
          player.kills || 0, player.deaths || 0, player.assists || 0, win, multiKills.ultraKills, matchData
        );
        await this.discordBot.sendNotification(null, embed);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (multiKills.tripleKills > 0) {
        logger.info(`💥 TRIPLE KILL detected for ${playerName} in match ${matchId} (via kill events)`);
        const embed = this.messageFormatter.formatTripleKillNotification(
          playerName, player.heroId, matchId,
          player.kills || 0, player.deaths || 0, player.assists || 0, win, multiKills.tripleKills, matchData
        );
        await this.discordBot.sendNotification(null, embed);
      }
    } catch (error) {
      logger.error(`Error checking kill events for match ${matchId}:`, error.message);
    }
  }

  /**
   * Check for stat changes
   */
  async checkStatChanges() {
    try {
      const playerData = await this.stratzClient.getPlayerTotals(this.accountId);
      const winLossData = await this.stratzClient.getPlayerWinLoss(this.accountId);

      const newStats = this.dataProcessor.processPlayerStats(playerData, winLossData);
      const comparison = this.dataProcessor.detectStatChanges(newStats);

      if (comparison.changed && comparison.changes.length > 0) {
        logger.info('Detected stat changes:', comparison.changes);
        
        // Check for significant changes (MMR, rank)
        const significantChanges = comparison.changes.filter(change => 
          change.key === 'mmr' || change.key === 'rank_tier'
        );

        if (significantChanges.length > 0) {
          const embed = this.messageFormatter.formatStats(newStats);
          embed.setTitle('📊 Statistics Updated');
          await this.discordBot.sendNotification(null, embed);
        }
      }
    } catch (error) {
      logger.error('Error checking for stat changes:', error);
    }
  }

  /**
   * Check for rank changes for all tracked players
   */
  async checkRankChanges() {
    try {
      // Get all players to check
      const playersToCheck = this.friendsManager 
        ? this.friendsManager.getAllFriends()
        : [{ name: 'You', ids: [this.accountId] }];

      for (const player of playersToCheck) {
        const accountId = player.ids[0];
        const playerName = player.name;

        try {
          // Get current rank from STRATZ
          const rankData = await this.stratzClient.getPlayerRank(accountId);
          
          if (!rankData || !rankData.rank) {
            continue;
          }

          // Check if rank changed
          const oldRankData = this.stateCache.updatePlayerRank(
            accountId, 
            rankData.rank, 
            rankData.leaderboardRank
          );

          if (oldRankData && oldRankData.oldRank !== null) {
            // Rank changed - send notification
            logger.info(`📈 Rank change detected for ${playerName}: ${oldRankData.oldRank} -> ${rankData.rank}`);
            
            const embed = this.messageFormatter.formatRankChangeNotification(
              playerName,
              oldRankData.oldRank,
              rankData.rank,
              oldRankData.oldLeaderboardRank,
              rankData.leaderboardRank
            );
            
            await this.discordBot.sendNotification(null, embed);
          }

          // Small delay between players
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          logger.warn(`Error checking rank for ${playerName}:`, error.message);
        }
      }
    } catch (error) {
      logger.error('Error checking for rank changes:', error);
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
      const allRampages = []; // Collect all rampages for separate notifications

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
          
          // Check feats for all multi-kills (rampages, ultra kills, triple kills)
          try {
            const feats = await this.stratzClient.getPlayerAchievements(bestAccountId, 200);
            const multiKillFeats = this.stratzClient.getMultiKillFeatsFromMatches(feats, matchIds);

            // Count each type
            summary.rampages = multiKillFeats.filter(f => f.type === 'RAMPAGE').length;
            summary.ultraKills = multiKillFeats.filter(f => f.type === 'ULTRA_KILL').length;
            summary.tripleKills = multiKillFeats.filter(f => f.type === 'TRIPLE_KILL').length;

            // Collect rampages for separate notifications
            for (const feat of multiKillFeats.filter(f => f.type === 'RAMPAGE')) {
              const matchData = recentMatches.find(m => m.id === feat.matchId);
              if (matchData) {
                const player = matchData.players?.[0];
                const win = player?.isRadiant === matchData.didRadiantWin;
                allRampages.push({
                  playerName: friend.name,
                  heroId: feat.heroId,
                  matchId: feat.matchId,
                  kills: player?.kills || 0,
                  deaths: player?.deaths || 0,
                  assists: player?.assists || 0,
                  win: win,
                  matchData: matchData
                });
              }
            }

            if (multiKillFeats.length > 0) {
              logger.info(`${friend.name} got ${summary.rampages} rampage(s), ${summary.ultraKills} ultra kill(s), ${summary.tripleKills} triple kill(s)!`);
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

      // First, send rampage notifications (separate messages)
      if (allRampages.length > 0) {
        logger.info(`🔥 Sending ${allRampages.length} rampage notification(s)...`);
        for (const rampage of allRampages) {
          // Skip if already notified about this rampage
          if (!this.stateCache.isRampageDetected(rampage.matchId, rampage.playerName)) {
            const embed = this.messageFormatter.formatRampageNotification(
              rampage.playerName,
              rampage.heroId,
              rampage.matchId,
              rampage.kills,
              rampage.deaths,
              rampage.assists,
              rampage.win,
              rampage.matchData
            );
            
            await this.discordBot.sendNotification(null, embed);
            this.stateCache.markRampageDetected(rampage.matchId, rampage.playerName, rampage.playerName);
            
            // Small delay between notifications
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
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
