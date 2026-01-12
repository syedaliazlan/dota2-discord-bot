import { Events } from 'discord.js';
import { profileCommand } from './profile.js';
import { recentCommand } from './recent.js';
import { statsCommand } from './stats.js';
import { heroesCommand } from './heroes.js';
import { liveCommand } from './live.js';
import { achievementsCommand } from './achievements.js';
import { matchCommand } from './match.js';
import { searchCommand } from './search.js';
import { listfriendsCommand } from './listfriends.js';
import { dailyallCommand } from './dailyall.js';
import { rampageCommand } from './rampage.js';
import { logger } from '../utils/logger.js';

/**
 * Command handler to register and route slash commands
 * Updated to use STRATZ API
 */
export class CommandHandler {
  constructor(discordBot, stratzClient, dataProcessor, messageFormatter, accountId, friendsManager = null, heroMap = null) {
    this.discordBot = discordBot;
    this.stratzClient = stratzClient;
    this.dataProcessor = dataProcessor;
    this.messageFormatter = messageFormatter;
    this.accountId = accountId;
    this.friendsManager = friendsManager;
    this.heroMap = heroMap;

    this.setupCommands();
    this.setupInteractionHandler();
  }

  /**
   * Register all commands
   */
  setupCommands() {
    // Register commands with the bot
    this.discordBot.registerCommand(profileCommand);
    this.discordBot.registerCommand(recentCommand);
    this.discordBot.registerCommand(statsCommand);
    this.discordBot.registerCommand(heroesCommand);
    this.discordBot.registerCommand(liveCommand);
    this.discordBot.registerCommand(achievementsCommand);
    this.discordBot.registerCommand(matchCommand);
    this.discordBot.registerCommand(searchCommand);
    this.discordBot.registerCommand(listfriendsCommand);
    this.discordBot.registerCommand(dailyallCommand);
    this.discordBot.registerCommand(rampageCommand);

    logger.info(`Registered ${this.discordBot.getCommands().size} commands`);
  }

  /**
   * Setup interaction handler
   */
  setupInteractionHandler() {
    const client = this.discordBot.getClient();

    client.on(Events.InteractionCreate, async interaction => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.discordBot.getCommand(interaction.commandName);

      if (!command) {
        logger.warn(`Unknown command: ${interaction.commandName}`);
        return;
      }

      try {
        logger.info(`Command received: /${interaction.commandName} from ${interaction.user.tag}`);
        
        // Execute command with STRATZ client
        if (interaction.commandName === 'profile') {
          await command.execute(interaction, this.stratzClient, this.dataProcessor, this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'recent') {
          await command.execute(interaction, this.stratzClient, this.dataProcessor, this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'stats') {
          await command.execute(interaction, this.stratzClient, this.dataProcessor, this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'heroes') {
          await command.execute(interaction, this.stratzClient, this.dataProcessor, this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'live') {
          await command.execute(interaction, this.stratzClient, this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'achievements') {
          await command.execute(interaction, this.stratzClient, this.dataProcessor, this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'match') {
          await command.execute(interaction, this.stratzClient, this.dataProcessor, this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'search') {
          await command.execute(interaction, this.stratzClient, this.dataProcessor, this.messageFormatter, this.friendsManager);
        } else if (interaction.commandName === 'listfriends') {
          await command.execute(interaction, this.friendsManager);
        } else if (interaction.commandName === 'dailyall') {
          await command.execute(interaction, this.stratzClient, this.dataProcessor, this.messageFormatter, this.friendsManager);
        } else if (interaction.commandName === 'rampage') {
          await command.execute(interaction, this.stratzClient, this.dataProcessor, this.messageFormatter, this.friendsManager, this.heroMap);
        }
      } catch (error) {
        logger.error(`Error executing command ${interaction.commandName}:`, error);
        
        // Don't try to reply if interaction is expired (code 10062)
        if (error.code === 10062) {
          logger.warn(`Interaction expired for command ${interaction.commandName}`);
          return;
        }
        
        const errorMessage = 'An error occurred while executing this command. Please try again.';

        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: errorMessage });
          } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
          }
        } catch (replyError) {
          // Don't log if interaction is expired
          if (replyError.code !== 10062) {
            logger.error('Failed to send error message:', replyError);
          }
        }
      }
    });
  }

  /**
   * Register commands with Discord (for global/guild commands)
   */
  async registerSlashCommands() {
    const client = this.discordBot.getClient();
    const commands = Array.from(this.discordBot.getCommands().values()).map(cmd => cmd.data.toJSON());

    // Helper function with timeout
    const withTimeout = (promise, ms) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
      ]);
    };

    try {
      const guildId = process.env.DISCORD_GUILD_ID;
      
      if (guildId) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
          logger.info(`Registering commands to guild ${guildId}...`);
          await withTimeout(guild.commands.set(commands), 30000);
          logger.info(`Registered ${commands.length} commands to guild ${guildId}`);
        } else {
          logger.warn(`Guild ${guildId} not found, skipping command registration`);
          logger.warn('Commands may already be registered from a previous run');
        }
      } else {
        logger.info('Registering commands globally (this may take a while)...');
        await withTimeout(client.application.commands.set(commands), 60000);
        logger.info(`Registered ${commands.length} commands globally`);
      }
    } catch (error) {
      if (error.message === 'Timeout') {
        logger.warn('Command registration timed out - commands may already be registered');
      } else {
        logger.error('Failed to register slash commands:', error.message);
      }
      logger.info('Continuing anyway - existing commands should still work');
    }
  }
}
