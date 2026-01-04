import cron from 'node-cron';
import { logger } from '../utils/logger.js';

/**
 * Polling service to check for updates at regular intervals
 */
export class PollingService {
  constructor(opendotaClient, dotabuffScraper, dataProcessor, stateCache, discordBot, messageFormatter, accountId, intervalMinutes, friendsManager = null, dailySummaryConfig = null) {
    this.opendotaClient = opendotaClient;
    this.dotabuffScraper = dotabuffScraper;
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

    // Do initial check
    this.checkForUpdates();
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

      // Note: Rampage checking moved to daily summary to reduce API calls

      // Check for stat changes
      await this.checkStatChanges();

      // Check for live matches
      await this.checkLiveMatches();

      // Save cache after checks
      await this.stateCache.save();
    } catch (error) {
      logger.error('Error during update check:', error);
    }
  }

  /**
   * Check for new matches
   */
  async checkNewMatches() {
    try {
      // Use getPlayerMatches() for better accuracy (same as recent command)
      const matchesData = await this.opendotaClient.getPlayerMatches(this.accountId, 10);
      
      if (!matchesData || matchesData.length === 0) {
        return;
      }

      // Process matches to get accurate hero_id
      const accountIdNum = parseInt(this.accountId);
      const processedMatches = matchesData.map((match) => {
        // Extract player data from players array if available
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

      // If matches don't have players array, fetch full details for first few
      const needsDetails = processedMatches.slice(0, 5).filter(m => !m.players || m.players.length === 0);
      if (needsDetails.length > 0) {
        await Promise.all(needsDetails.map(async (match) => {
          try {
            const fullMatch = await this.opendotaClient.getMatch(match.match_id);
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
            // Silently handle - will use original match data
          }
        }));
      }

      const processed = this.dataProcessor.processRecentMatches(processedMatches);
      const newMatches = this.dataProcessor.detectNewMatches(processed);

      if (newMatches.length > 0) {
        logger.info(`Found ${newMatches.length} new match(es)`);
        
        // Send notification for each new match (most recent first)
        for (const match of newMatches.reverse()) {
          const embed = this.messageFormatter.formatNewMatch(match);
          await this.discordBot.sendNotification(null, embed);
          
          // Small delay between notifications
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      logger.error('Error checking for new matches:', error);
    }
  }

  /**
   * Check for rampages in provided matches (called during daily summary)
   * This reduces API calls by only checking when we already have match data
   */
  async checkRampagesForMatches(playerName, accountId, matches) {
    try {
      if (!matches || matches.length === 0) {
        return;
      }

      const accountIdNum = parseInt(accountId);

      // Check each match for rampages
      for (const match of matches) {
        // Skip if already detected
        if (this.stateCache.isRampageDetected(match.match_id, accountId)) {
          continue;
        }

        // Fetch full match details to get multi_kills if not already available
        let fullMatch = match;
        if (!match.players || match.players.length === 0) {
          try {
            fullMatch = await this.opendotaClient.getMatch(match.match_id);
            // Rate limiting: wait 1 second between match detail fetches
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            logger.detail(`Failed to fetch match ${match.match_id} for rampage check:`, error.message);
            continue;
          }
        }

        if (!fullMatch.players || fullMatch.players.length === 0) {
          continue;
        }

        const player = fullMatch.players.find(p => p.account_id === accountIdNum);
        
        if (!player) {
          continue;
        }

        // Check for rampage (multi_kills["5"] indicates rampage)
        const multiKills = player.multi_kills;
        if (multiKills && typeof multiKills === 'object') {
          const rampageCount = multiKills['5'] || 0;
          
          if (rampageCount > 0) {
            // Rampage detected!
            logger.info(`🔥 RAMPAGE detected for ${playerName} in match ${match.match_id}`);
            
            // Mark as detected
            this.stateCache.markRampageDetected(match.match_id, accountId, playerName);
            
            // Send notification
            const win = fullMatch.radiant_win === (player.player_slot < 128);
            const embed = this.messageFormatter.formatRampageNotification(
              playerName,
              player.hero_id,
              match.match_id,
              player.kills || 0,
              player.deaths || 0,
              player.assists || 0,
              win,
              null
            );
            
            await this.discordBot.sendNotification(null, embed);
            
            // Small delay between notifications
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    } catch (error) {
      logger.error(`Error checking rampages for ${playerName}:`, error.message);
    }
  }

  /**
   * Check for stat changes
   */
  async checkStatChanges() {
    try {
      const [totalsData, winLossData] = await Promise.all([
        this.opendotaClient.getPlayerTotals(this.accountId),
        this.opendotaClient.getPlayerWinLoss(this.accountId)
      ]);

      const newStats = this.dataProcessor.processPlayerStats(totalsData, winLossData);
      const comparison = this.dataProcessor.detectStatChanges(newStats);

      if (comparison.changed && comparison.changes.length > 0) {
        logger.info('Detected stat changes:', comparison.changes);
        
        // Optionally send notification for significant stat changes
        // For now, we'll just log them
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
   * Check for live matches
   */
  async checkLiveMatches() {
    try {
      const liveMatches = await this.opendotaClient.getLiveMatches();
      
      if (!liveMatches || liveMatches.length === 0) {
        return;
      }

      const accountIdNum = parseInt(this.accountId);
      const playerMatch = liveMatches.find(match => 
        match.players?.some(player => player.account_id === accountIdNum)
      );

      if (playerMatch) {
        // Check if we've already notified about this live match
        const lastLiveMatchId = this.stateCache.cache.lastLiveMatchId;
        
        if (lastLiveMatchId !== playerMatch.match_id) {
          logger.info('Player is in a live match');
          const embed = this.messageFormatter.formatLiveMatch(playerMatch);
          await this.discordBot.sendNotification(null, embed);
          
          this.stateCache.cache.lastLiveMatchId = playerMatch.match_id;
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
   * Send daily summary for last 24 hours for all friends
   */
  async sendDailySummary() {
    try {
      logger.info('Generating daily summary for all friends...');
      logger.detailInfo(`Time range: Last 24 hours (since ${new Date((Math.floor(Date.now() / 1000) - (24 * 60 * 60)) * 1000).toISOString()})`);
      
      const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
      const playerSummaries = [];

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
            // Check all accounts to find the one with most matches
            let bestMatchCount = 0;
            let bestAccountMatches = [];
            
            for (const accountId of friend.ids) {
              try {
                const matchesData = await this.opendotaClient.getPlayerMatches(accountId, 50);
                const accountMatches = (matchesData || []).filter(match => 
        match.start_time >= twentyFourHoursAgo
      );

                if (accountMatches.length > bestMatchCount) {
                  bestMatchCount = accountMatches.length;
                  bestAccountId = accountId;
                  bestAccountMatches = accountMatches;
                }
                
                // Rate limiting between account checks
                await new Promise(resolve => setTimeout(resolve, 1000));
              } catch (error) {
                logger.warn(`Error checking account ${accountId} for ${friend.name}:`, error.message);
              }
            }
            
            recentMatches = bestAccountMatches;
          } else {
            // Single account - just fetch matches
            const matchesData = await this.opendotaClient.getPlayerMatches(bestAccountId, 50);
            recentMatches = (matchesData || []).filter(match => 
              match.start_time >= twentyFourHoursAgo
            );
          }
          
          // Skip if no matches
      if (recentMatches.length === 0) {
            continue;
      }

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
      const summary = this.dataProcessor.processDailySummary(processedMatches);
          playerSummaries.push({
            name: friend.name,
            accountId: bestAccountId,
            summary
          });

          // Check for rampages in recent matches (only during daily summary)
          await this.checkRampagesForMatches(friend.name, bestAccountId, processedMatches);

          // Rate limiting: wait 1 second between requests (free tier: 60 calls/min)
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(`Error processing daily summary for ${friend.name}:`, error);
          // Continue with other friends even if one fails
        }
      }

      // Send combined summary
      if (playerSummaries.length === 0) {
        logger.info('No matches in last 24 hours for any friend');
        const embed = this.messageFormatter.formatMultiPlayerDailySummary([]);
        await this.discordBot.sendNotification(null, embed);
      } else {
        const embed = this.messageFormatter.formatMultiPlayerDailySummary(playerSummaries);
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

