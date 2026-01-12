import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * Discord bot client
 */
export class DiscordBot {
  constructor(token, channelId) {
    this.token = token;
    this.channelId = channelId;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    this.commands = new Collection();

    this.setupEventHandlers();
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    this.client.once('ready', () => {
      logger.info(`✅ Discord bot logged in as ${this.client.user.tag}`);
      logger.info(`Bot is in ${this.client.guilds.cache.size} guild(s)`);
      this.client.guilds.cache.forEach(guild => {
        logger.info(`  - ${guild.name} (ID: ${guild.id})`);
      });
    });

    this.client.on('error', (error) => {
      logger.error('Discord client error:', error);
    });

    this.client.on('warn', (warning) => {
      logger.warn('Discord client warning:', warning);
    });
  }

  /**
   * Wait for the bot to be fully ready
   * This ensures guild cache is populated and we can register commands
   */
  waitForReady() {
    return new Promise((resolve) => {
      if (this.client.isReady()) {
        logger.info('Bot already ready');
        resolve();
      } else {
        logger.info('Waiting for ready event...');
        this.client.once('ready', () => {
          resolve();
        });
      }
    });
  }

  /**
   * Login to Discord
   */
  async login() {
    try {
      logger.info('Attempting to connect to Discord...');
      if (!this.token || this.token.trim() === '') {
        throw new Error('Discord bot token is missing or empty');
      }
      
      await this.client.login(this.token);
      logger.info('Discord bot connected successfully');
    } catch (error) {
      logger.error('Failed to login to Discord:', error.message || error);
      if (error.code) {
        logger.error(`Discord error code: ${error.code}`);
      }
      throw error;
    }
  }

  /**
   * Get the notification channel
   */
  getNotificationChannel() {
    return this.client.channels.cache.get(this.channelId);
  }

  /**
   * Send message to notification channel
   */
  async sendNotification(content, embed = null) {
    try {
      const channel = this.getNotificationChannel();
      if (!channel) {
        logger.error(`Channel ${this.channelId} not found`);
        return false;
      }

      const options = {};
      if (embed) {
        options.embeds = [embed];
      } else {
        options.content = content;
      }

      await channel.send(options);
      return true;
    } catch (error) {
      logger.error('Failed to send notification:', error.message);
      return false;
    }
  }

  /**
   * Register a command
   */
  registerCommand(command) {
    this.commands.set(command.data.name, command);
  }

  /**
   * Get command by name
   */
  getCommand(name) {
    return this.commands.get(name);
  }

  /**
   * Get all registered commands
   */
  getCommands() {
    return this.commands;
  }

  /**
   * Get Discord client instance
   */
  getClient() {
    return this.client;
  }

  /**
   * Destroy the bot connection
   */
  async destroy() {
    await this.client.destroy();
    logger.info('Discord bot disconnected');
  }
}

