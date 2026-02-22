import { Events } from 'discord.js';
import axios from 'axios';
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
import { metaCommand } from './meta.js';
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
    this.discordBot.registerCommand(metaCommand);

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
        const options = interaction.options?.data?.map(o => `${o.name}=${o.value}`).join(', ') || 'none';
        logger.info(`Command received: /${interaction.commandName} from ${interaction.user.tag} [options: ${options}]`);

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
          await command.execute(interaction, this.stratzClient, this.messageFormatter, this.accountId, this.friendsManager);
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
        } else if (interaction.commandName === 'meta') {
          await command.execute(interaction, this.stratzClient, this.dataProcessor, this.messageFormatter);
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
   * Register commands with Discord using axios (discord.js REST client has issues)
   */
  async registerSlashCommands() {
    const client = this.discordBot.getClient();
    const commands = Array.from(this.discordBot.getCommands().values()).map(cmd => cmd.data.toJSON());

    logger.info(`Preparing to register ${commands.length} commands:`);
    commands.forEach(cmd => logger.info(`  - /${cmd.name}: ${cmd.description}`));

    try {
      const guildId = process.env.DISCORD_GUILD_ID;
      const token = process.env.DISCORD_BOT_TOKEN;
      const clientId = client.user.id;
      
      // Build the API URL
      const url = guildId 
        ? `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`
        : `https://discord.com/api/v10/applications/${clientId}/commands`;
      
      logger.info(`Registering commands to: ${guildId ? 'guild ' + guildId : 'global'}`);
      
      // Use axios directly (discord.js REST client hangs on some systems)
      const response = await axios.put(url, commands, {
        headers: {
          'Authorization': `Bot ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      const registeredCommands = response.data;
      logger.info(`✅ Successfully registered ${registeredCommands.length} commands!`);
      registeredCommands.forEach(cmd => {
        logger.info(`  ✓ /${cmd.name} (ID: ${cmd.id})`);
      });
      
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        if (status === 429) {
          // Rate limited - this is fine, commands may already be registered
          const retryAfter = data.retry_after || 'unknown';
          logger.warn(`⚠️ Rate limited by Discord (retry after ${retryAfter}s)`);
          logger.warn('Commands may already be registered - continuing anyway...');
          return; // Don't throw - just continue
        }
        
        logger.error('❌ Failed to register slash commands!');
        logger.error(`HTTP Status: ${status}`);
        logger.error(`Error: ${JSON.stringify(data)}`);
        
        if (status === 401) {
          logger.error('>>> Invalid bot token! Check DISCORD_BOT_TOKEN in .env');
        } else if (status === 403) {
          logger.error('>>> Missing Access! The bot lacks the "applications.commands" scope.');
          logger.error('>>> Kick the bot and re-add with: bot + applications.commands scopes');
        }
      } else {
        logger.error('❌ Failed to register slash commands!');
        logger.error(`Error: ${error.message}`);
      }
      
      // Don't throw - let the bot continue even if registration fails
      logger.warn('Continuing anyway - existing commands should still work');
    }
  }
}
