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
import { logger } from '../utils/logger.js';

/**
 * Command handler to register and route slash commands
 */
export class CommandHandler {
  constructor(discordBot, opendotaClient, dotabuffScraper, dataProcessor, messageFormatter, accountId, friendsManager = null) {
    this.discordBot = discordBot;
    this.opendotaClient = opendotaClient;
    this.dotabuffScraper = dotabuffScraper;
    this.dataProcessor = dataProcessor;
    this.messageFormatter = messageFormatter;
    this.accountId = accountId;
    this.friendsManager = friendsManager;

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
        
        // Execute command immediately - commands should call deferReply() within 3 seconds
        // Execute command with appropriate parameters
        // All commands should call deferReply() immediately to avoid timeout
        if (interaction.commandName === 'profile') {
          await command.execute(interaction, this.opendotaClient, this.dotabuffScraper, 
            this.dataProcessor, this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'recent') {
          await command.execute(interaction, this.opendotaClient, this.dataProcessor, 
            this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'stats') {
          await command.execute(interaction, this.opendotaClient, this.dataProcessor, 
            this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'heroes') {
          await command.execute(interaction, this.opendotaClient, this.dataProcessor, 
            this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'live') {
          await command.execute(interaction, this.opendotaClient, this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'achievements') {
          await command.execute(interaction, this.dotabuffScraper, this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'match') {
          await command.execute(interaction, this.opendotaClient, this.dataProcessor, this.messageFormatter, this.accountId);
        } else if (interaction.commandName === 'search') {
          await command.execute(interaction, this.opendotaClient, this.dataProcessor, this.messageFormatter, this.friendsManager);
        } else if (interaction.commandName === 'listfriends') {
          await command.execute(interaction, this.friendsManager);
        } else if (interaction.commandName === 'dailyall') {
          await command.execute(interaction, this.opendotaClient, this.dataProcessor, this.messageFormatter, this.friendsManager);
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

    try {
      // Register commands globally (takes up to 1 hour to propagate)
      // For faster testing, register to a specific guild
      const guildId = process.env.DISCORD_GUILD_ID;
      
      // ALWAYS clear global commands first to prevent duplicates when switching modes
      try {
        await client.application.commands.set([]);
        logger.info('Cleared global commands');
      } catch (clearError) {
        logger.warn('Failed to clear global commands:', clearError.message);
      }
      
      if (guildId) {
        // Register to specific guild (instant)
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
          // Clear guild commands first to prevent duplicates
          await guild.commands.set([]);
          await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to ensure clear
          await guild.commands.set(commands);
          logger.info(`Registered ${commands.length} commands to guild ${guildId}`);
        } else {
          logger.warn(`Guild ${guildId} not found, commands may not be available immediately`);
          // Fallback to global registration
          await client.application.commands.set(commands);
          logger.info(`Registered ${commands.length} commands globally (guild not found)`);
        }
      } else {
        // Register globally
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to ensure clear
        await client.application.commands.set(commands);
        logger.info(`Registered ${commands.length} commands globally`);
      }
    } catch (error) {
      logger.error('Failed to register slash commands:', error);
    }
  }
}

