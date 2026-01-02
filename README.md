# Dota 2 Profile Discord Bot

A Discord bot that fetches and displays Dota 2 profile data from OpenDota API and Dotabuff. The bot provides match notifications, player statistics, hero performance, achievements, and live match status through both automated polling and slash commands.

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Setup](#setup)
- [Commands](#commands)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## Features

- **Player Profile**: View your Dota 2 profile overview with MMR, rank, and leaderboard position
- **Recent Matches**: Display your recent match history with win/loss, KDA, hero names, and duration
- **Player Statistics**: View comprehensive stats including win rate, average KDA, GPM, XPM
- **Hero Statistics**: See your top heroes by games played with hero names, win rates, and KDA
- **Live Matches**: Check if you're currently in a live match
- **Achievements**: Display your achievements (via Dotabuff)
- **Match Details**: Get detailed information about specific matches
- **Automated Notifications**: Receive notifications when new matches complete, stats change, or you enter a live match
- **Daily Summary**: Automatic daily summary at 3 AM UK time (Mon-Fri) or 10 PM UK time (Sat-Sun) with 24-hour statistics for all tracked players for all tracked players
- **Multi-Player Support**: Track multiple friends and their daily summaries
- **Player Search**: Search for any player's recent matches by name or ID
- **Friends List**: View all tracked players in your friends list

## Setup

### Prerequisites

- Node.js 18+ installed
- Discord Bot Token
- Steam Account ID (32-bit)

### Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Copy the example environment file:
```bash
cp .env.example .env
```

4. Edit `.env` and fill in your configuration:
   - `DISCORD_BOT_TOKEN`: Get this from [Discord Developer Portal](https://discord.com/developers/applications)
   - `DISCORD_CHANNEL_ID`: Right-click your Discord channel → Copy ID
   - `STEAM_ACCOUNT_ID`: Your 32-bit Steam Account ID (can be found on OpenDota profile page)
   - `OPENDOTA_API_KEY`: (Optional) Get from [OpenDota API Keys](https://www.opendota.com/api-keys) for higher rate limits
   - `POLLING_INTERVAL`: How often to check for updates in minutes (default: 5)

### Getting Your Steam Account ID

1. Go to [OpenDota](https://www.opendota.com/)
2. Search for your Steam profile or Dota 2 profile
3. Your Account ID will be in the URL or profile page (32-bit number)

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token to your `.env` file
5. Enable the following bot permissions:
   - Send Messages
   - Embed Links
   - Use Slash Commands
6. Invite the bot to your server using the OAuth2 URL Generator with `applications.commands` and `bot` scopes

### Running the Bot

Start the bot:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

### Verifying Polling is Enabled

When the bot starts, you should see these log messages confirming polling is active:

```
[INFO] Polling service started (checking every 5 minutes)
[INFO] Daily summary scheduled: 3 AM UK time (Mon-Fri), 10 PM UK time (Sat-Sun)
```

**To verify automated messages are working:**

1. **Check bot logs** - Look for "Polling service started" message when bot starts
2. **Play a match** - After finishing a game, wait up to 5 minutes (or your `POLLING_INTERVAL` setting)
3. **Check Discord channel** - You should receive an automated notification with match details
4. **Monitor logs** - Look for messages like "Found X new match(es)" when polling detects new games

**If automated messages aren't working:**

- Verify `POLLING_INTERVAL` is set in `.env` (default: 5 minutes)
- Check that `DISCORD_CHANNEL_ID` is correct
- Ensure bot has permission to send messages in the channel
- Check logs for errors during update checks
- Note: First run may not detect matches if cache is empty (this is normal - it needs a baseline)

## Commands

The bot supports the following slash commands:

- `/profile` - Display your Dota 2 profile overview
- `/recent [limit]` - Show your recent matches (default: 5, max: 10)
- `/stats` - Display your player statistics
- `/heroes [limit]` - Show your top heroes (default: 10, max: 20)
- `/live` - Check if you are currently in a live match
- `/achievements` - Display your achievements
- `/match <id>` - Get details for a specific match
- `/search <player> [limit]` - Search for a player's recent matches by name (from friends list) or Steam Account ID
- `/listfriends` - List all players in your friends list

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `DISCORD_CHANNEL_ID` | Yes | Channel ID for notifications |
| `STEAM_ACCOUNT_ID` | Yes | Your 32-bit Steam Account ID |
| `OPENDOTA_API_KEY` | No | OpenDota API key for higher rate limits |
| `POLLING_INTERVAL` | No | Polling interval in minutes (default: 5) |
| `CACHE_FILE` | No | Path to cache file (default: ./data/state-cache.json) |
| `LOG_LEVEL` | No | Log level: ERROR, WARN, INFO, DEBUG (default: INFO). Use DEBUG or add _DETAILED suffix (e.g., INFO_DETAILED) for verbose logs |
| `DISCORD_GUILD_ID` | No | Guild ID for faster command registration (development) |
| `FRIENDS_LIST` | No | JSON string of friends list with names and account IDs (see below) |
| `MAIN_ACCOUNT_NAME` | No | Name for your main account in friends list (default: "You") |
| `DAILY_SUMMARY_WEEKDAY_TIME` | No | Daily summary time for weekdays in UK timezone (format: "HH:MM", default: "03:00") |
| `DAILY_SUMMARY_WEEKEND_TIME` | No | Daily summary time for weekends in UK timezone (format: "HH:MM", default: "22:00") |

### Friends List Configuration

To track multiple players in daily summaries, configure the `FRIENDS_LIST` environment variable as a JSON string. Each player can have multiple account IDs (for players who switch between accounts).

**Format:**
```json
{
  "PlayerName1": ["account_id_1"],
  "PlayerName2": ["account_id_2", "account_id_3"],
  "PlayerName3": ["account_id_4"]
}
```

**Example `.env` entry:**
```env
FRIENDS_LIST={"DX":["76561198154222201"],"Chirri":["190274308","398580353"],"CJ":["76561198137957508"],"Chuchu":["76561198306821929","76561199062714218"],"Toy":["76561198272276415"],"SHJ":["76561198098997173"],"Venom":["76561198818382757"],"Marco":["76561198325912093"],"Sikandar":["76561198182052901"]}
```

**Notes:**
- Your main account (from `STEAM_ACCOUNT_ID`) is automatically added to the friends list
- For players with multiple accounts, the bot will automatically select the account with the most matches in the last 24 hours for the daily summary
- Players with no matches in the last 24 hours are automatically skipped from the daily summary
- Use `/listfriends` command to view all configured players
- Use `/search <name>` or `/search <id>` to search for any player's recent matches

### Rate Limiting

- **Without API Key**: OpenDota allows 1 request per second (60 calls/min, 3000/day)
- **With API Key**: Higher rate limits (check OpenDota documentation)
- Dotabuff scraping has a 2-second delay between requests
- **Daily Summary**: Automatically respects rate limits with 1-second delays between friend lookups

### Automated Notifications

The bot runs a background polling service that checks for updates at regular intervals:

- **Check Frequency**: Configurable via `POLLING_INTERVAL` (default: 5 minutes)
- **New Match Detection**: Compares match IDs to detect newly completed matches
- **Live Match Detection**: Monitors OpenDota's live matches endpoint
- **Stat Change Detection**: Tracks MMR and Rank Tier changes
- **State Caching**: Prevents duplicate notifications using `data/state-cache.json`

### Daily Summary

The bot automatically sends a daily summary of the last 24 hours:

- **Weekdays (Monday-Friday)**: 3 AM UK time
- **Weekends (Saturday-Sunday)**: 10 PM UK time

The summary includes:
- Total matches played (or "No matches played" if none)
- Win/Loss record and win rate
- Average KDA and total K/D/A statistics
- Most played hero
- Best match (highest KDA)
- Worst match (lowest KDA)

The summary is sent to the configured Discord channel automatically, even if no matches were played.

## Project Structure

```
dota2-discord/
├── src/
│   ├── index.js                    # Main entry point
│   ├── bot/
│   │   └── discord-bot.js          # Discord bot client
│   ├── commands/                   # Slash command implementations
│   │   ├── command-handler.js      # Command routing
│   │   ├── profile.js              # /profile command
│   │   ├── recent.js               # /recent command
│   │   ├── stats.js                # /stats command
│   │   ├── heroes.js               # /heroes command
│   │   ├── live.js                 # /live command
│   │   ├── achievements.js         # /achievements command
│   │   └── match.js                # /match command
│   ├── services/
│   │   ├── opendota-client.js      # OpenDota API client
│   │   ├── dotabuff-scraper.js    # Dotabuff scraper
│   │   └── polling-service.js      # Polling scheduler & daily summary
│   ├── core/
│   │   ├── data-processor.js       # Data processing logic
│   │   └── state-cache.js          # State caching
│   └── utils/
│       ├── logger.js               # Logging utility
│       ├── config.js               # Configuration loader
│       ├── message-formatter.js    # Discord embed formatter
│       ├── hero-names.js           # Hero name mapping (fallback)
│       └── hero-loader.js          # Dynamic hero loading from API
├── data/
│   └── state-cache.json           # Cached state data (auto-generated)
├── .env.example                   # Environment variables template
├── .gitignore
├── package.json
├── README.md
└── DEPLOYMENT.md                   # Deployment guide for various platforms
```

## Deployment

### Quick Start: Deploy to Cybrancee.com

1. **Push to GitHub** (see [GitHub Setup](#github-setup) below)
2. **Connect Repository** in Cybrancee dashboard:
   - GIT REPO ADDRESS: `https://github.com/YOUR_USERNAME/dota2-discord-bot`
   - BOT JS FILE: `src/index.js`
   - INSTALL BRANCH: `main`
   - AUTO UPDATE: ON
   - NPM INSTALL: ON (important!)
3. **Set Environment Variables**:
   - `DISCORD_BOT_TOKEN`
   - `DISCORD_CHANNEL_ID`
   - `STEAM_ACCOUNT_ID`
   - `OPENDOTA_API_KEY` (optional but recommended)
   - `POLLING_INTERVAL=5` (optional)
   - `LOG_LEVEL=INFO` (optional)
4. **Set Start Command**: `npm start`
5. **Deploy** and verify bot is online

> 📖 **Detailed deployment guide**: See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive deployment instructions for other platforms.

### Deploying to Other Hosting Services

This bot can be deployed to any Node.js hosting service. Here are instructions for common platforms:

#### Using Cybrancee.com (Discord Bot Hosting)

1. **Prepare Your Repository**
   - Push your code to GitHub (see [GitHub Setup](#github-setup) below)
   - Make sure `.env` is in `.gitignore` (it should be by default)

2. **On Cybrancee.com Dashboard**
   - Connect your GitHub repository
   - Set up environment variables in the hosting dashboard:
     - `DISCORD_BOT_TOKEN`
     - `DISCORD_CHANNEL_ID`
     - `STEAM_ACCOUNT_ID`
     - `OPENDOTA_API_KEY` (optional)
     - `POLLING_INTERVAL` (optional, default: 5)
     - `LOG_LEVEL` (optional, default: INFO)

3. **Start Command**
   - Set the start command to: `npm start`
   - The bot will automatically install dependencies on first deploy

4. **File Structure**
   - Ensure `package.json` is in the root directory
   - The bot expects the `src/` directory structure as provided

#### Using Other Hosting Services

**Heroku:**
```bash
# Add Procfile
echo "worker: npm start" > Procfile

# Deploy
git push heroku main
```

**Railway:**
- Connect GitHub repository
- Set environment variables
- Railway auto-detects Node.js and runs `npm start`

**VPS/Server:**
```bash
# Clone repository
git clone <your-repo-url>
cd dota2-discord

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
nano .env  # Edit with your values

# Use PM2 for process management
npm install -g pm2
pm2 start src/index.js --name dota2-bot
pm2 save
pm2 startup  # Follow instructions to enable on boot
```

### GitHub Setup

1. **Initialize Git Repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Dota 2 Discord Bot"
   ```

2. **Create GitHub Repository**
   - Go to [GitHub](https://github.com) and create a new repository
   - Don't initialize with README (we already have one)

3. **Push to GitHub**
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/dota2-discord.git
   git branch -M main
   git push -u origin main
   ```

4. **Keep Repository Updated**
   ```bash
   git add .
   git commit -m "Your commit message"
   git push
   ```

## Troubleshooting

### Bot doesn't respond to commands / "The application did not respond" error

1. Make sure the bot is online in Discord
2. Check that commands are registered (may take up to 1 hour for global commands)
3. For faster testing, set `DISCORD_GUILD_ID` in `.env` for instant guild command registration
4. Verify bot has proper permissions in the channel
5. If you see "The application did not respond":
   - This usually means API calls are taking too long
   - Check your OpenDota API key is set (improves rate limits)
   - Check bot logs for API errors
   - Try the command again after a moment

### API rate limit errors

1. Get an OpenDota API key from [OpenDota API Keys](https://www.opendota.com/api-keys)
2. Add it to your `.env` file as `OPENDOTA_API_KEY`
3. The bot will automatically use higher rate limits

### No data returned

1. Verify your `STEAM_ACCOUNT_ID` is correct (32-bit number)
2. Check that your Dota 2 profile is public
3. Ensure OpenDota has parsed your matches (may take time for new accounts)

### Automated messages not working

1. Check that polling service started (look for "Polling service started" in logs)
2. Verify `POLLING_INTERVAL` is set correctly (default: 5 minutes)
3. Check that `DISCORD_CHANNEL_ID` is correct
4. Ensure bot has permission to send messages in the channel
5. Check logs for errors during update checks
6. Note: First run may not detect matches if cache is empty (this is normal)

### Daily summary not sending

1. Verify bot is running at the scheduled time:
   - Weekdays: 3 AM UK time
   - Weekends: 10 PM UK time
2. Check logs for "Generating daily summary..." messages
3. Ensure bot has permission to send messages in the channel
4. Daily summary will send even if no matches were played (shows "No matches played in the last 24 hours" message)

### Dotabuff scraping fails

- Dotabuff scraping may fail if the site structure changes
- Achievements and some features may not be available
- The bot will continue to work with OpenDota data

## Development

### Project Structure

```
dota2-discord/
├── src/
│   ├── index.js                    # Main entry point
│   ├── bot/
│   │   └── discord-bot.js          # Discord bot client
│   ├── commands/                   # Slash command implementations
│   │   ├── command-handler.js      # Command routing
│   │   ├── profile.js              # /profile command
│   │   ├── recent.js               # /recent command
│   │   ├── stats.js                # /stats command
│   │   ├── heroes.js               # /heroes command
│   │   ├── live.js                 # /live command
│   │   ├── achievements.js         # /achievements command
│   │   └── match.js                # /match command
│   ├── services/
│   │   ├── opendota-client.js      # OpenDota API client
│   │   ├── dotabuff-scraper.js     # Dotabuff scraper
│   │   └── polling-service.js      # Polling scheduler & daily summary
│   ├── core/
│   │   ├── data-processor.js       # Data processing logic
│   │   └── state-cache.js          # State caching
│   └── utils/
│       ├── logger.js               # Logging utility
│       ├── config.js               # Configuration loader
│       ├── message-formatter.js    # Discord embed formatter
│       ├── hero-names.js           # Static hero name mapping (fallback)
│       └── hero-loader.js          # Dynamic hero loading from API
├── data/
│   └── state-cache.json           # Cached state data (auto-generated)
├── .env.example                   # Environment variables template
├── .gitignore
├── package.json
├── README.md
└── DEPLOYMENT.md                   # Deployment guide for various platforms
```

### Key Features Implementation

- **Hero Name Mapping**: Uses OpenDota API `/heroes` endpoint for accurate hero_id to name mapping
- **Match Data**: Uses `/players/{id}/matches` endpoint for better data accuracy
- **State Caching**: Prevents duplicate notifications and tracks last known state
- **Error Handling**: Comprehensive error handling with retry logic
- **Rate Limiting**: Respects OpenDota API rate limits automatically

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Acknowledgments

- [OpenDota](https://www.opendota.com/) for the excellent API and hero data
- [Dotabuff](https://www.dotabuff.com/) for additional data sources
- [Discord.js](https://discord.js.org/) for the Discord library
- [OpenDota API Documentation](https://docs.opendota.com/) for comprehensive API reference

