import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { DiscordBot } from './bot/discord-bot.js';
import { StratzClient } from './services/stratz-client.js';
import { OpenDotaClient } from './services/opendota-client.js';
import { DataProcessor } from './core/data-processor.js';
import { StateCache } from './core/state-cache.js';
import { MessageFormatter } from './utils/message-formatter.js';
import { loadHeroesFromAPI } from './utils/hero-loader.js';
import { CommandHandler } from './commands/command-handler.js';
import { PollingService } from './services/polling-service.js';
import { FriendsManager } from './utils/friends-manager.js';

/**
 * Main application entry point
 */
async function main() {
  try {
    logger.info('Starting Dota 2 Discord Bot...');

    // Load configuration
    const config = loadConfig();

    // Validate STRATZ API token
    if (!config.stratz.apiToken) {
      throw new Error('STRATZ_API_TOKEN is required. Get your token at https://stratz.com/api');
    }

    // Initialize state cache
    const stateCache = new StateCache(config.cache.file);
    await stateCache.load();

    // Initialize STRATZ client (with residential proxies for datacenter IP bypass)
    const stratzClient = new StratzClient(config.stratz.apiToken, config.stratz.proxies);
    const dataProcessor = new DataProcessor(stateCache, config.steam.accountId);
    
    // Initialize OpenDota client (for multi-kill detection)
    const openDotaClient = new OpenDotaClient(config.opendota.apiKey);
    logger.info(`OpenDota client initialized${config.opendota.apiKey ? ' (with API key)' : ' (no API key - using free tier)'}`);

    // Initialize friends manager
    const friendsManager = new FriendsManager(config.friends);
    
    // Test STRATZ API connectivity
    logger.info('Testing STRATZ API connectivity...');
    try {
      const testStart = Date.now();
      const isConnected = await stratzClient.testConnection();
      const testDuration = Date.now() - testStart;
      
      if (isConnected) {
        logger.info(`✅ STRATZ API is reachable (response time: ${testDuration}ms)`);
      } else {
        logger.warn('⚠️ STRATZ API test returned unexpected result');
      }
    } catch (error) {
      logger.error(`❌ STRATZ API connectivity FAILED: ${error.message}`);
      logger.warn('The bot will start but API commands may not work until this is fixed.');
    }
    
    // Load heroes from STRATZ API
    logger.info('Loading heroes from STRATZ API...');
    const heroMap = await loadHeroesFromAPI(stratzClient);
    logger.info('Heroes loaded successfully');
    
    const messageFormatter = new MessageFormatter(heroMap, config.dailySummary.mainAccountName);

    // Initialize Discord bot
    logger.info('Initializing Discord bot...');
    const discordBot = new DiscordBot(
      config.discord.token,
      config.discord.channelId
    );

    // Login to Discord and wait for ready
    logger.info('Logging in to Discord...');
    await discordBot.login();
    
    // Wait for the ready event (proper way instead of fixed delay)
    await discordBot.waitForReady();
    logger.info('Discord bot is ready!');

    // Initialize command handler
    logger.info('Initializing command handler...');
    const commandHandler = new CommandHandler(
      discordBot,
      stratzClient,
      dataProcessor,
      messageFormatter,
      config.steam.accountId,
      friendsManager,
      heroMap
    );

    // Register slash commands with Discord
    logger.info('Registering slash commands with Discord...');
    await commandHandler.registerSlashCommands();

    // Initialize polling service
    logger.info('Initializing polling service...');
    const pollingService = new PollingService(
      stratzClient,
      dataProcessor,
      stateCache,
      discordBot,
      messageFormatter,
      config.steam.accountId,
      config.polling.interval,
      friendsManager,
      config.dailySummary,
      openDotaClient
    );

    // Start polling service
    logger.info('Starting polling service...');
    pollingService.start();

    logger.info('Bot is ready and running!');

    // Graceful shutdown handler
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      pollingService.stop();
      await stateCache.save();
      await discordBot.destroy();
      
      logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Handle uncaught errors
    process.on('unhandledRejection', (error) => {
      logger.error('Unhandled promise rejection:', error);
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      shutdown('uncaughtException');
    });

  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the application
main();
