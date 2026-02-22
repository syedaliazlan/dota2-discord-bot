import cron from 'node-cron';
import { logger } from '../utils/logger.js';

/**
 * Polling service to check for updates at regular intervals
 * Uses STRATZ API for match detection, rank tracking, and stats
 * Uses OpenDota API as additional source for multi-kill detection
 */
export class PollingService {
  constructor(stratzClient, dataProcessor, stateCache, discordBot, messageFormatter, accountId, intervalMinutes, friendsManager = null, dailySummaryConfig = null, openDotaClient = null) {
    this.stratzClient = stratzClient;
    this.openDotaClient = openDotaClient;
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
    this.dailySummaryJobs = [];
    // Max re-checks for pending multi-kill detection (6 checks * 5 min = 30 min window)
    this.maxMultiKillChecks = 6;
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
    this.dailySummaryJobs.push(cron.schedule(`${weekdayMinute} ${weekdayHour} * * 1-5`, async () => {
      logger.info('Daily summary cron triggered (weekday)');
      await this.sendDailySummary();
    }, {
      scheduled: true,
      timezone: 'Europe/London'
    }));

    // Weekends: Saturday-Sunday
    this.dailySummaryJobs.push(cron.schedule(`${weekendMinute} ${weekendHour} * * 0,6`, async () => {
      logger.info('Daily summary cron triggered (weekend)');
      await this.sendDailySummary();
    }, {
      scheduled: true,
      timezone: 'Europe/London'
    }));
    
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
    if (this.dailySummaryJobs && this.dailySummaryJobs.length > 0) {
      for (const job of this.dailySummaryJobs) {
        job.stop();
      }
      this.dailySummaryJobs = [];
    }
    this.isRunning = false;
    logger.info('Polling service stopped');
  }

  /**
   * Check for updates (new matches, stat changes, etc.)
   */
  async checkForUpdates() {
    try {
      logger.debug('=== Poll cycle starting ===');

      await this.checkNewMatches();
      await this.checkPendingMultiKills();
      await this.checkStatChanges();
      await this.checkRankChanges();

      this.stateCache.cleanupPendingMultiKillChecks();
      await this.stateCache.save();
      logger.debug('=== Poll cycle complete ===');
    } catch (error) {
      logger.error('Error during update check:', error);
    }
  }

  /**
   * Check for new matches using STRATZ API
   * Checks main account and all friends for new matches
   * New matches are added to pending multi-kill checks for reliable detection
   */
  async checkNewMatches() {
    try {
      const playersToCheck = this.friendsManager
        ? this.friendsManager.getAllFriends()
        : [{ name: 'You', ids: [this.accountId] }];

      logger.debug(`checkNewMatches: checking ${playersToCheck.length} player(s)`);

      for (const player of playersToCheck) {
        const playerName = player.name;

        // Check ALL accounts for this player (not just the first)
        for (const accountId of player.ids) {
          try {
            logger.debug(`checkNewMatches: fetching for ${playerName} (account ${accountId})`);
            const matchesData = await this.stratzClient.getRecentMatches(accountId, 5);

            if (!matchesData || matchesData.length === 0) {
              logger.debug(`checkNewMatches: no matches returned for ${playerName} (account ${accountId})`);
              continue;
            }

            const processed = this.dataProcessor.processRecentMatches(matchesData, accountId);
            const newMatches = this.dataProcessor.detectNewMatches(processed, accountId);

            logger.debug(`checkNewMatches: ${playerName} (${accountId}): ${matchesData.length} fetched, ${processed.length} processed, ${newMatches.length} new`);

            if (newMatches.length > 0) {
              logger.info(`Found ${newMatches.length} new match(es) for ${playerName} (account ${accountId}): [${newMatches.map(m => m.matchId).join(', ')}]`);

              for (const match of newMatches) {
                this.stateCache.addPendingMultiKillCheck(match.matchId, accountId, playerName);

                if (this.openDotaClient) {
                  this.openDotaClient.requestParse(match.matchId).catch(() => {});
                }
              }
            }

            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            logger.warn(`Error checking matches for ${playerName} (account ${accountId}):`, error.message);
          }
        }
      }
    } catch (error) {
      logger.error('Error checking for new matches:', error);
    }
  }

  /**
   * Process pending multi-kill checks across multiple data sources
   * Retries across poll cycles until data is available or max checks reached
   *
   * Data sources (checked in order):
   * 1. OpenDota match details - direct multi_kills field (most reliable when parsed)
   * 2. STRATZ feats API - pre-calculated achievements (rampages, ultra kills, triple kills)
   * 3. STRATZ kill events - timestamp analysis fallback (only on final check)
   */
  async checkPendingMultiKills() {
    const pendingChecks = this.stateCache.getPendingMultiKillChecks();
    if (pendingChecks.length === 0) return;

    logger.debug(`Processing ${pendingChecks.length} pending multi-kill check(s)`);

    // Group pending checks by accountId for efficient STRATZ feats batching
    const checksByAccount = new Map();
    for (const check of [...pendingChecks]) {
      if (!checksByAccount.has(check.accountId)) {
        checksByAccount.set(check.accountId, []);
      }
      checksByAccount.get(check.accountId).push(check);
    }

    for (const [accountId, checks] of checksByAccount) {
      const playerName = checks[0].playerName;
      const matchIds = checks.map(c => c.matchId);

      // Batch fetch STRATZ feats once per player
      let stratzFeats = [];
      try {
        const feats = await this.stratzClient.getPlayerAchievements(accountId, 200);
        stratzFeats = feats ? this.stratzClient.getMultiKillFeatsFromMatches(feats, matchIds) : [];
        if (stratzFeats.length > 0) {
          logger.info(`STRATZ feats found for ${playerName}: ${stratzFeats.length} multi-kill(s) in pending matches`);
          stratzFeats.forEach(f => logger.debug(`  Feat: type=${f.type}, matchId=${f.matchId}, heroId=${f.heroId}`));
        }
      } catch (error) {
        logger.debug(`STRATZ feats fetch failed for ${playerName}: ${error.message}`);
      }

      // Process each pending match
      for (const check of checks) {
        if (this.stateCache.isMultiKillDetected(check.matchId, accountId)) {
          this.stateCache.removePendingMultiKillCheck(check.matchId, accountId);
          continue;
        }

        let resolved = false;

        // Source 1: OpenDota multi_kills (direct, most reliable when parsed)
        if (this.openDotaClient && !resolved) {
          resolved = await this.checkMultiKillsViaOpenDota(check.matchId, accountId, playerName);
        }

        // Source 2: STRATZ feats (pre-calculated achievements)
        if (!resolved) {
          const matchFeats = stratzFeats.filter(f => f.matchId === check.matchId || f.matchId === parseInt(check.matchId));
          if (matchFeats.length > 0) {
            resolved = true;
            await this.notifyMultiKillsFromFeats(matchFeats, accountId, playerName);
          }
        }

        // Source 3: STRATZ kill events (only on final check as last resort)
        if (!resolved && check.checkCount >= this.maxMultiKillChecks - 1) {
          resolved = await this.checkMultiKillsViaKillEvents(check.matchId, accountId, playerName);
        }

        if (resolved) {
          this.stateCache.markMultiKillDetected(check.matchId, accountId, playerName);
          this.stateCache.removePendingMultiKillCheck(check.matchId, accountId);
        } else if (check.checkCount >= this.maxMultiKillChecks) {
          // Give up after max checks - mark as done to prevent infinite retries
          logger.debug(`Max checks reached for match ${check.matchId} (${playerName}), giving up`);
          this.stateCache.markMultiKillDetected(check.matchId, accountId, playerName);
          this.stateCache.removePendingMultiKillCheck(check.matchId, accountId);
        } else {
          this.stateCache.incrementMultiKillCheckCount(check.matchId, accountId);
        }

        await new Promise(resolve => setTimeout(resolve, 300));
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  /**
   * Check multi-kills via OpenDota's parsed match multi_kills field
   * Returns true if the match was parsed (regardless of whether multi-kills were found)
   */
  async checkMultiKillsViaOpenDota(matchId, accountId, playerName) {
    if (!this.openDotaClient) return false;

    try {
      const matchData = await this.openDotaClient.getMatch(matchId);
      if (!matchData) return false;

      const result = this.openDotaClient.getMultiKillsForPlayer(matchData, accountId);
      if (!result) return false; // Match not parsed yet

      // Match is parsed - send notifications for any multi-kills found
      if (result.rampages > 0) {
        logger.info(`🔥 RAMPAGE detected for ${playerName} in match ${matchId} (via OpenDota)`);
        const embed = this.messageFormatter.formatRampageNotification(
          playerName, result.heroId, matchId,
          result.kills, result.deaths, result.assists, result.win, null
        );
        await this.discordBot.sendNotification(null, embed);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (result.ultraKills > 0) {
        logger.info(`⚡ ULTRA KILL detected for ${playerName} in match ${matchId} (via OpenDota)`);
        const embed = this.messageFormatter.formatUltraKillNotification(
          playerName, result.heroId, matchId,
          result.kills, result.deaths, result.assists, result.win, result.ultraKills, null
        );
        await this.discordBot.sendNotification(null, embed);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (result.tripleKills > 0) {
        logger.info(`💥 TRIPLE KILL detected for ${playerName} in match ${matchId} (via OpenDota)`);
        const embed = this.messageFormatter.formatTripleKillNotification(
          playerName, result.heroId, matchId,
          result.kills, result.deaths, result.assists, result.win, result.tripleKills, null
        );
        await this.discordBot.sendNotification(null, embed);
      }

      return true; // Match was parsed, check is resolved
    } catch (error) {
      logger.debug(`OpenDota check failed for match ${matchId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Send notifications from STRATZ feat data
   */
  async notifyMultiKillsFromFeats(feats, accountId, playerName) {
    for (const feat of feats) {
      if (feat.type === 'RAMPAGE') {
        logger.info(`🔥 RAMPAGE detected for ${playerName} in match ${feat.matchId} (via STRATZ feats)`);
        const embed = this.messageFormatter.formatRampageNotification(
          playerName, feat.heroId, feat.matchId, 0, 0, 0, false, null
        );
        await this.discordBot.sendNotification(null, embed);
      } else if (feat.type === 'ULTRA_KILL') {
        logger.info(`⚡ ULTRA KILL detected for ${playerName} in match ${feat.matchId} (via STRATZ feats)`);
        const embed = this.messageFormatter.formatUltraKillNotification(
          playerName, feat.heroId, feat.matchId, 0, 0, 0, false, 1, null
        );
        await this.discordBot.sendNotification(null, embed);
      } else if (feat.type === 'TRIPLE_KILL') {
        logger.info(`💥 TRIPLE KILL detected for ${playerName} in match ${feat.matchId} (via STRATZ feats)`);
        const embed = this.messageFormatter.formatTripleKillNotification(
          playerName, feat.heroId, feat.matchId, 0, 0, 0, false, 1, null
        );
        await this.discordBot.sendNotification(null, embed);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  /**
   * Check multi-kills via STRATZ kill event timestamp analysis (last resort fallback)
   * Returns true if kill event data was available (regardless of whether multi-kills found)
   */
  async checkMultiKillsViaKillEvents(matchId, accountId, playerName) {
    try {
      const matchData = await this.stratzClient.getMatchWithKillEvents(matchId);
      if (!matchData?.players) return false;

      const accountIdNum = parseInt(accountId);
      const player = matchData.players.find(p => p.steamAccountId === accountIdNum);
      if (!player?.stats?.killEvents || player.stats.killEvents.length === 0) return false;

      const multiKills = this.stratzClient.detectMultiKillsFromKillEvents(player.stats.killEvents);
      const win = player.isRadiant === matchData.didRadiantWin;

      if (multiKills.rampages > 0) {
        logger.info(`🔥 RAMPAGE detected for ${playerName} in match ${matchId} (via STRATZ kill events)`);
        const embed = this.messageFormatter.formatRampageNotification(
          playerName, player.heroId, matchId,
          player.kills || 0, player.deaths || 0, player.assists || 0, win, matchData
        );
        await this.discordBot.sendNotification(null, embed);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (multiKills.ultraKills > 0) {
        logger.info(`⚡ ULTRA KILL detected for ${playerName} in match ${matchId} (via STRATZ kill events)`);
        const embed = this.messageFormatter.formatUltraKillNotification(
          playerName, player.heroId, matchId,
          player.kills || 0, player.deaths || 0, player.assists || 0, win, multiKills.ultraKills, matchData
        );
        await this.discordBot.sendNotification(null, embed);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (multiKills.tripleKills > 0) {
        logger.info(`💥 TRIPLE KILL detected for ${playerName} in match ${matchId} (via STRATZ kill events)`);
        const embed = this.messageFormatter.formatTripleKillNotification(
          playerName, player.heroId, matchId,
          player.kills || 0, player.deaths || 0, player.assists || 0, win, multiKills.tripleKills, matchData
        );
        await this.discordBot.sendNotification(null, embed);
      }

      return true; // Kill event data was available
    } catch (error) {
      logger.debug(`STRATZ kill events check failed for match ${matchId}: ${error.message}`);
      return false;
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
      const playersToCheck = this.friendsManager
        ? this.friendsManager.getAllFriends()
        : [{ name: 'You', ids: [this.accountId] }];

      logger.debug(`checkRankChanges: checking ${playersToCheck.length} player(s)`);

      for (const player of playersToCheck) {
        const playerName = player.name;

        try {
          let bestRankData = null;

          for (const accountId of player.ids) {
            try {
              const rankData = await this.stratzClient.getPlayerRank(accountId);
              logger.debug(`checkRankChanges: ${playerName} account ${accountId} -> rank=${rankData?.rank}, leaderboard=${rankData?.leaderboardRank}`);
              if (rankData && rankData.rank) {
                if (!bestRankData || rankData.rank > bestRankData.rank) {
                  bestRankData = rankData;
                }
              }
              await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
              logger.warn(`Error checking rank for ${playerName} (account ${accountId}):`, error.message);
            }
          }

          if (!bestRankData || !bestRankData.rank) {
            logger.debug(`checkRankChanges: ${playerName} -> no rank data found`);
            continue;
          }

          // Use player name as key to avoid duplicate notifications across accounts
          const rankKey = `player_${playerName}`;
          const oldRankData = this.stateCache.updatePlayerRank(
            rankKey,
            bestRankData.rank,
            bestRankData.leaderboardRank
          );

          if (oldRankData && oldRankData.oldRank !== null) {
            logger.info(`Rank change detected for ${playerName}: ${oldRankData.oldRank} -> ${bestRankData.rank}`);

            const embed = this.messageFormatter.formatRankChangeNotification(
              playerName,
              oldRankData.oldRank,
              bestRankData.rank,
              oldRankData.oldLeaderboardRank,
              bestRankData.leaderboardRank
            );

            await this.discordBot.sendNotification(null, embed);
          }
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
   * Get the time range for the last 20 hours from current UK time
   * Returns { startTimestamp, endTimestamp, dateString } in Unix seconds
   */
  getLast20HoursRange() {
    const now = new Date();
    const endTimestamp = Math.floor(now.getTime() / 1000);
    const startTimestamp = endTimestamp - (20 * 60 * 60); // 20 hours ago

    const dateString = 'Last 20 hours';

    return {
      startTimestamp,
      endTimestamp,
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
      logger.info('=== DAILY SUMMARY START ===');

      // Get last 20 hours range from current UK time
      const { startTimestamp, endTimestamp, dateString } = this.getLast20HoursRange();
      logger.info(`Daily summary for: ${dateString}`);
      logger.info(`Time range: ${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()}`);

      const playerSummaries = [];
      const allRampages = [];

      // Get all friends or just the main account if no friends manager
      const friends = this.friendsManager
        ? this.friendsManager.getAllFriends()
        : [{ name: 'You', ids: [this.accountId] }];

      logger.info(`Processing ${friends.length} player(s): [${friends.map(f => `${f.name}(${f.ids.join('/')})`).join(', ')}]`);

      // Process each friend
      for (const friend of friends) {
        logger.info(`--- Processing player: ${friend.name} (IDs: [${friend.ids.join(', ')}]) ---`);
        try {
          let bestAccountId = friend.ids[0];
          let recentMatches = [];

          // For players with multiple IDs, check all accounts to find matches
          if (friend.ids.length > 1 && this.friendsManager) {
            let bestMatchCount = 0;
            let bestAccountMatches = [];

            logger.debug(`${friend.name}: multi-account player, checking ${friend.ids.length} accounts`);
            for (const accountId of friend.ids) {
              try {
                const matchesData = await this.stratzClient.getPlayerMatchesSince(accountId, startTimestamp, 50);

                const filteredMatches = matchesData.filter(m =>
                  m.startDateTime >= startTimestamp && m.startDateTime <= endTimestamp
                );

                logger.debug(`${friend.name}: account ${accountId} -> ${matchesData.length} since start, ${filteredMatches.length} in day range`);

                if (filteredMatches.length > bestMatchCount) {
                  bestMatchCount = filteredMatches.length;
                  bestAccountId = accountId;
                  bestAccountMatches = filteredMatches;
                }

                await new Promise(resolve => setTimeout(resolve, 100));
              } catch (error) {
                logger.warn(`Error checking account ${accountId} for ${friend.name}: ${error.message}`);
              }
            }

            recentMatches = bestAccountMatches;
            logger.debug(`${friend.name}: best account=${bestAccountId} with ${recentMatches.length} matches`);
          } else {
            // Single account - use time-based query
            logger.debug(`${friend.name}: single account ${bestAccountId}, fetching matches`);
            const matchesData = await this.stratzClient.getPlayerMatchesSince(bestAccountId, startTimestamp, 50);
            recentMatches = matchesData.filter(m =>
              m.startDateTime >= startTimestamp && m.startDateTime <= endTimestamp
            );
            logger.debug(`${friend.name}: ${matchesData.length} since start, ${recentMatches.length} in day range`);
          }

          // Skip if no matches
          if (recentMatches.length === 0) {
            logger.info(`${friend.name}: NO MATCHES on ${dateString} - skipping`);
            continue;
          }

          logger.info(`${friend.name}: Found ${recentMatches.length} match(es) on ${dateString} [IDs: ${recentMatches.map(m => m.id).join(', ')}]`);

          // Process daily summary for this player
          const summary = this.dataProcessor.processDailySummary(recentMatches);
          logger.debug(`${friend.name}: summary -> ${summary.totalMatches} matches, ${summary.wins}W/${summary.losses}L, WR=${summary.winRate}%`);

          // Get match IDs from recent matches
          const matchIds = recentMatches.map(m => m.id);

          // Check for multi-kills using STRATZ feats + OpenDota fallback
          try {
            // Source 1: STRATZ feats
            logger.debug(`${friend.name}: fetching STRATZ feats for account ${bestAccountId}`);
            const feats = await this.stratzClient.getPlayerAchievements(bestAccountId, 200);
            const multiKillFeats = this.stratzClient.getMultiKillFeatsFromMatches(feats, matchIds);

            summary.rampages = multiKillFeats.filter(f => f.type === 'RAMPAGE').length;
            summary.ultraKills = multiKillFeats.filter(f => f.type === 'ULTRA_KILL').length;
            summary.tripleKills = multiKillFeats.filter(f => f.type === 'TRIPLE_KILL').length;

            // Source 2: OpenDota fallback for missed multi-kills
            if (this.openDotaClient && (summary.rampages + summary.ultraKills + summary.tripleKills) === 0) {
              logger.debug(`${friend.name}: no STRATZ multi-kills, checking OpenDota fallback for ${Math.min(matchIds.length, 10)} matches`);
              for (const matchId of matchIds.slice(0, 10)) {
                try {
                  const odMatch = await this.openDotaClient.getMatch(matchId);
                  const result = odMatch ? this.openDotaClient.getMultiKillsForPlayer(odMatch, bestAccountId) : null;
                  if (result) {
                    summary.rampages += result.rampages;
                    summary.ultraKills += result.ultraKills;
                    summary.tripleKills += result.tripleKills;
                  }
                } catch (e) {
                  logger.debug(`${friend.name}: OpenDota match ${matchId} check failed: ${e.message}`);
                }
              }
            }

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

            if ((summary.rampages + summary.ultraKills + summary.tripleKills) > 0) {
              logger.info(`${friend.name} got ${summary.rampages} rampage(s), ${summary.ultraKills} ultra kill(s), ${summary.tripleKills} triple kill(s)!`);
            }
          } catch (error) {
            logger.warn(`Error fetching feats for ${friend.name}:`, error.message);
          }
          
          logger.info(`${friend.name}: ADDED to summary (${summary.totalMatches} matches, ${summary.wins}W-${summary.losses}L, ${summary.winRate}% WR)`);
          playerSummaries.push({
            name: friend.name,
            accountId: bestAccountId,
            summary
          });

          // Small delay between players
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error(`Error processing daily summary for ${friend.name}: ${error.message}`, error.stack);
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
      logger.info(`=== DAILY SUMMARY RESULTS: ${playerSummaries.length}/${friends.length} players had matches ===`);
      if (playerSummaries.length > 0) {
        logger.info(`Players in summary: [${playerSummaries.map(p => `${p.name}(${p.summary.totalMatches} matches)`).join(', ')}]`);
      }
      const skippedPlayers = friends.filter(f => !playerSummaries.some(p => p.name === f.name));
      if (skippedPlayers.length > 0) {
        logger.info(`Players skipped (no matches): [${skippedPlayers.map(f => f.name).join(', ')}]`);
      }

      if (playerSummaries.length === 0) {
        const embed = this.messageFormatter.formatMultiPlayerDailySummary([], dateString);
        await this.discordBot.sendNotification(null, embed);
        logger.info('Sent empty daily summary (no matches)');
      } else {
        const embed = this.messageFormatter.formatMultiPlayerDailySummary(playerSummaries, dateString);
        const sent = await this.discordBot.sendNotification(null, embed);
        logger.info(`Daily summary sent: ${sent ? 'SUCCESS' : 'FAILED'} for ${playerSummaries.length} player(s)`);
      }

      this.stateCache.setLastDailySummary(new Date().toISOString());
      await this.stateCache.save();
      logger.info('=== DAILY SUMMARY END ===');
    } catch (error) {
      logger.error('Error sending daily summary:', error);
      // Notify Discord that the daily summary failed
      try {
        const { EmbedBuilder } = await import('discord.js');
        const errorEmbed = new EmbedBuilder()
          .setTitle('Daily Summary Failed')
          .setDescription(`The automated daily summary failed to generate.\n\n**Error:** ${error.message}`)
          .setColor(0xFF0000)
          .setTimestamp();
        await this.discordBot.sendNotification(null, errorEmbed);
      } catch (notifyError) {
        logger.error('Failed to send error notification:', notifyError.message);
      }
    }
  }
}
