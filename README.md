# Dota 2 Profile Discord Bot

A Discord bot that fetches and displays Dota 2 profile data using the STRATZ GraphQL API. The bot provides match notifications, player statistics, hero performance, rampage detection, and daily summaries through both automated polling and slash commands.

## Table of Contents

- [Features](#features)
- [Setup](#setup)
- [Commands](#commands)
- [Configuration](#configuration)
- [Daily Summary](#daily-summary)
- [Rampage Notifications](#rampage-notifications)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## Features

- **STRATZ API Integration**: Fast, reliable data from STRATZ GraphQL API
- **Player Profile**: View Dota 2 profile overview with rank and statistics
- **Recent Matches**: Display recent match history with KDA, hero names, and duration
- **Player Statistics**: View comprehensive stats including win rate and average KDA
- **Hero Statistics**: See top heroes by games played with win rates and KDA
- **Live Matches**: Check if you're currently in a live match
- **Achievements**: Display player achievements/feats from STRATZ
- **Match Details**: Get detailed information about specific matches
- **Rampage Detection**: Automatic detection and enhanced notifications for rampages
- **Automated Notifications**: Receive notifications when new matches complete
- **Daily Summary**: Automatic daily summary based on previous day (UK time) for all tracked players
- **Multi-Player Support**: Track multiple friends and their daily summaries
- **Player Search**: Search for any player's recent matches by name or ID
- **Friends List**: View all tracked players in your friends list

## Setup

### Prerequisites

- Node.js 18+ installed
- Discord Bot Token
- STRATZ API Token (free at [stratz.com](https://stratz.com/api))
- Steam Account ID (32-bit)

### Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with your configuration (see [Configuration](#configuration))

4. Start the bot:
```bash
npm start
```

### Getting Your STRATZ API Token

1. Go to [STRATZ](https://stratz.com/)
2. Log in with your Steam account
3. Go to API settings and generate a token
4. Add it to your `.env` file as `STRATZ_API_TOKEN`

### Getting Your Steam Account ID

1. Go to [STRATZ](https://stratz.com/) or [OpenDota](https://www.opendota.com/)
2. Search for your Steam profile
3. Your Account ID will be in the URL (32-bit number)

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

## Commands

| Command | Description |
|---------|-------------|
| `/profile` | Display your Dota 2 profile overview |
| `/recent [limit]` | Show recent matches (default: 5, max: 10) |
| `/stats` | Display player statistics |
| `/heroes [limit]` | Show top heroes (default: 10, max: 20) |
| `/live` | Check if you're in a live match |
| `/achievements` | Display achievements/feats |
| `/match <id>` | Get details for a specific match |
| `/search <player> [limit]` | Search for a player's recent matches |
| `/listfriends` | List all tracked players |
| `/dailyall` | Show daily summary for previous day (UK time) |
| `/rampage [day]` | Show rampages - optional day parameter |

### Rampage Command Examples

```
/rampage              # Show all recent rampages (top 10)
/rampage day:0        # Today's rampages
/rampage day:1        # Yesterday's rampages
/rampage day:11-Jan-2026  # Specific date
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `DISCORD_CHANNEL_ID` | Yes | Channel ID for notifications |
| `STEAM_ACCOUNT_ID` | Yes | Your 32-bit Steam Account ID |
| `STRATZ_API_TOKEN` | Yes | STRATZ API token for data access |
| `DISCORD_GUILD_ID` | No | Guild ID for faster command registration |
| `POLLING_INTERVAL` | No | Polling interval in minutes (default: 5) |
| `CACHE_FILE` | No | Path to cache file (default: ./data/state-cache.json) |
| `LOG_LEVEL` | No | Log level (see below) |
| `FRIENDS_LIST` | No | JSON string of friends to track |
| `MAIN_ACCOUNT_NAME` | No | Name for main account (default: "You") |
| `DAILY_SUMMARY_WEEKDAY_TIME` | No | Weekday summary time UK (default: "01:00") |
| `DAILY_SUMMARY_WEEKEND_TIME` | No | Weekend summary time UK (default: "22:00") |

### Log Levels

Set `LOG_LEVEL` in `.env` to control logging verbosity:

| Level | Description |
|-------|-------------|
| `ERROR` | Only errors |
| `WARN` | Errors and warnings |
| `INFO` | Normal operation logs (default, minimal) |
| `DEBUG` | Verbose debugging logs |
| `INFO_DETAILED` | INFO + detailed processing logs |
| `DEBUG_DETAILED` | Full verbose logging |

Example:
```env
LOG_LEVEL=INFO          # Minimal logs (recommended for production)
LOG_LEVEL=DEBUG         # Verbose logs for debugging
LOG_LEVEL=INFO_DETAILED # Normal + detailed processing info
```

### Friends List Configuration

Track multiple players in daily summaries:

```env
FRIENDS_LIST={"DX":["account_id"],"Chirri":["id1","id2"],"CJ":["account_id"]}
```

- Players can have multiple account IDs (for smurfs/alts)
- Bot automatically selects the account with most matches
- Players with no matches are skipped in daily summaries

### Example .env File

```env
# Discord Configuration
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CHANNEL_ID=your_channel_id
DISCORD_GUILD_ID=your_guild_id

# Steam/Dota Configuration
STEAM_ACCOUNT_ID=your_32bit_account_id
MAIN_ACCOUNT_NAME=YourName

# STRATZ API
STRATZ_API_TOKEN=your_stratz_token

# Friends List
FRIENDS_LIST={"Friend1":["id1"],"Friend2":["id2"]}

# Polling
POLLING_INTERVAL=5

# Logging (INFO for minimal, DEBUG for verbose)
LOG_LEVEL=INFO

# Daily Summary Times (UK timezone)
DAILY_SUMMARY_WEEKDAY_TIME=01:00
DAILY_SUMMARY_WEEKEND_TIME=22:00
```

## Daily Summary

The bot automatically sends a daily summary:

- **Weekdays (Mon-Fri)**: Default 1:00 AM UK time
- **Weekends (Sat-Sun)**: Default 10:00 PM UK time
- **Time Period**: Previous day (midnight to midnight, UK time)
- **Date Format**: `11-Jan-2026`

### Summary Includes:

- Total matches played
- Win/Loss record and win rate
- Average KDA and total K/D/A
- Most played hero
- Best match (highest KDA)
- Rampage count (if any)

Use `/dailyall` to manually trigger the summary for the previous day.

## Rampage Notifications

When a rampage is detected, the bot sends an enhanced notification with:

- 🔥 Dramatic title and random message
- Hero thumbnail image
- Final KDA stats
- Match result (Victory/Defeat)
- GPM/XPM stats (when available)
- Match duration
- Hero damage and tower damage (when available)

Rampages are detected through STRATZ's feats/achievements system for reliability.

## Rate Limits

STRATZ API (Free Tier):
- 20 calls/second
- 250 calls/minute
- 2,000 calls/hour
- 10,000 calls/day

The bot automatically handles rate limiting with delays between requests.

## Project Structure

```
dota2-discord/
├── src/
│   ├── index.js                    # Main entry point
│   ├── bot/
│   │   └── discord-bot.js          # Discord bot client
│   ├── commands/
│   │   ├── command-handler.js      # Command routing
│   │   ├── profile.js              # /profile command
│   │   ├── recent.js               # /recent command
│   │   ├── stats.js                # /stats command
│   │   ├── heroes.js               # /heroes command
│   │   ├── live.js                 # /live command
│   │   ├── achievements.js         # /achievements command
│   │   ├── match.js                # /match command
│   │   ├── search.js               # /search command
│   │   ├── listfriends.js          # /listfriends command
│   │   ├── dailyall.js             # /dailyall command
│   │   └── rampage.js              # /rampage command
│   ├── services/
│   │   ├── stratz-client.js        # STRATZ GraphQL API client
│   │   └── polling-service.js      # Polling & daily summary
│   ├── core/
│   │   ├── data-processor.js       # Data processing logic
│   │   ├── state-cache.js          # State caching
│   │   └── friends-manager.js      # Friends list management
│   └── utils/
│       ├── logger.js               # Logging utility
│       ├── config.js               # Configuration loader
│       ├── message-formatter.js    # Discord embed formatter
│       └── hero-loader.js          # Hero loading from API
├── data/
│   └── state-cache.json            # Cached state (auto-generated)
├── .env                            # Environment configuration
├── .gitignore
├── package.json
└── README.md
```

## Deployment

### Quick Start

1. Push to GitHub
2. Deploy to your preferred hosting (Heroku, Railway, VPS, etc.)
3. Set environment variables
4. Start with `npm start`

### PM2 (VPS/Server)

```bash
npm install -g pm2
pm2 start src/index.js --name dota2-bot
pm2 save
pm2 startup
```

## Troubleshooting

### Bot doesn't respond to commands

1. Verify bot is online in Discord
2. Check command registration (set `DISCORD_GUILD_ID` for instant registration)
3. Verify bot permissions in channel
4. Check logs for errors

### No data returned

1. Verify `STEAM_ACCOUNT_ID` is correct
2. Check `STRATZ_API_TOKEN` is valid
3. Ensure Dota 2 profile is public

### Daily summary not sending

1. Verify bot is running at scheduled time
2. Check `LOG_LEVEL=DEBUG` for detailed logs
3. Ensure bot has permission to send in channel

### Rate limit errors

- The bot handles rate limits automatically
- If issues persist, check STRATZ API usage dashboard

## License

MIT

## Contributing

Contributions welcome! Please submit a Pull Request.

## Acknowledgments

- [STRATZ](https://stratz.com/) for the excellent GraphQL API
- [Discord.js](https://discord.js.org/) for the Discord library
