import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { DiscordBot } from './bot/discord-bot.js';
import { OpenDotaClient } from './services/opendota-client.js';
import { DotabuffScraper } from './services/dotabuff-scraper.js';
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

    // Initialize state cache
    const stateCache = new StateCache(config.cache.file);
    await stateCache.load();

    // Initialize services
    const opendotaClient = new OpenDotaClient(
      config.opendota.baseUrl,
      config.opendota.apiKey
    );
    const dotabuffScraper = new DotabuffScraper();
    const dataProcessor = new DataProcessor(stateCache, config.steam.accountId);
    
    // Initialize friends manager
    const friendsManager = new FriendsManager(config.friends);
    
    // Load heroes from API first to get correct mapping
    logger.info('Loading heroes from OpenDota API...');
    const heroMap = await loadHeroesFromAPI(opendotaClient);
    logger.info('Heroes loaded successfully');
    
    const messageFormatter = new MessageFormatter(heroMap, config.dailySummary.mainAccountName);

    // Initialize Discord bot
    logger.info('Initializing Discord bot...');
    const discordBot = new DiscordBot(
      config.discord.token,
      config.discord.channelId
    );

    // Login to Discord
    logger.info('Logging in to Discord...');
    await discordBot.login();

    // Wait a bit for bot to be ready
    logger.info('Waiting for Discord bot to be ready...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Initialize command handler
    logger.info('Initializing command handler...');
    const commandHandler = new CommandHandler(
      discordBot,
      opendotaClient,
      dotabuffScraper,
      dataProcessor,
      messageFormatter,
      config.steam.accountId,
      friendsManager
    );

    // Register slash commands with Discord
    logger.info('Registering slash commands with Discord...');
    await commandHandler.registerSlashCommands();

    // Initialize polling service
    logger.info('Initializing polling service...');
    const pollingService = new PollingService(
      opendotaClient,
      dotabuffScraper,
      dataProcessor,
      stateCache,
      discordBot,
      messageFormatter,
      config.steam.accountId,
      config.polling.interval,
      friendsManager,
      config.dailySummary
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

