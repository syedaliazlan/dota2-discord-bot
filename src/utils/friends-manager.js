import { logger } from './logger.js';

/**
 * Friends manager to handle player lookups and account selection
 */
export class FriendsManager {
  constructor(friendsList) {
    // friendsList is an object like: { "Name": ["id1", "id2"], ... }
    this.friendsList = friendsList || {};
    this.nameToIds = new Map();
    this.idToName = new Map();
    
    // Steam Account ID to Dota 2 Account ID conversion constant
    // Dota 2 Account ID = Steam Account ID - 76561197960265728
    this.STEAM_TO_DOTA2_OFFSET = BigInt('76561197960265728');
    
    // Build lookup maps and convert Steam IDs to Dota 2 IDs
    for (const [name, ids] of Object.entries(this.friendsList)) {
      if (Array.isArray(ids) && ids.length > 0) {
        // Convert Steam Account IDs to Dota 2 Account IDs
        const convertedIds = ids.map(id => this.convertToDota2AccountId(String(id)));
        this.nameToIds.set(name.toLowerCase(), { name, ids: convertedIds });
        convertedIds.forEach(id => {
          // Store mapping from ID to name (if multiple IDs map to same name, last one wins)
          this.idToName.set(String(id), name);
        });
      }
    }
  }

  /**
   * Convert Steam Account ID (64-bit) to Dota 2 Account ID (32-bit)
   * Steam Account IDs start with 76561... and are 17 digits
   * Dota 2 Account IDs are 32-bit integers
   */
  convertToDota2AccountId(accountId) {
    const idStr = String(accountId).trim();
    
    // Check if it's a Steam Account ID (starts with 76561 and is 17 digits)
    if (idStr.startsWith('76561') && idStr.length === 17) {
      try {
        const steamId = BigInt(idStr);
        const dota2Id = steamId - this.STEAM_TO_DOTA2_OFFSET;
        const dota2IdStr = dota2Id.toString();
        logger.debug(`Converted Steam Account ID ${idStr} to Dota 2 Account ID ${dota2IdStr}`);
        return dota2IdStr;
      } catch (error) {
        logger.warn(`Failed to convert Steam Account ID ${idStr}:`, error.message);
        return idStr; // Return original if conversion fails
      }
    }
    
    // Already a Dota 2 Account ID (32-bit, typically 6-10 digits)
    return idStr;
  }

  /**
   * Get all friends with their names and IDs (converted to Dota 2 Account IDs)
   */
  getAllFriends() {
    const friends = Object.entries(this.friendsList).map(([name, ids]) => {
      const idArray = Array.isArray(ids) ? ids : [ids];
      const convertedIds = idArray.map(id => this.convertToDota2AccountId(String(id)));
      return {
        name,
        ids: convertedIds
      };
    });
    logger.debug(`getAllFriends: returning ${friends.length} friends: [${friends.map(f => `${f.name}(${f.ids.join('/')})`).join(', ')}]`);
    return friends;
  }

  /**
   * Find player by name (case-insensitive) or ID
   * Returns { name, accountId } or null
   * accountId is always returned as Dota 2 Account ID (converted if needed)
   */
  findPlayer(query) {
    if (!query) return null;

    const queryStr = String(query).trim();
    
    // Convert query to Dota 2 Account ID if it's a Steam Account ID
    const convertedQuery = this.convertToDota2AccountId(queryStr);
    
    // First try to find by ID (using converted ID)
    const nameById = this.idToName.get(convertedQuery);
    if (nameById) {
      const nameData = this.nameToIds.get(nameById.toLowerCase());
      if (nameData && nameData.ids.length > 0) {
        return {
          name: nameData.name,
          accountId: nameData.ids[0], // Already converted
          allIds: nameData.ids // Already converted
        };
      }
    }
    
    // Also try with original query in case it's already a Dota 2 ID
    const nameByIdOriginal = this.idToName.get(queryStr);
    if (nameByIdOriginal) {
      const nameData = this.nameToIds.get(nameByIdOriginal.toLowerCase());
      if (nameData && nameData.ids.length > 0) {
        return {
          name: nameData.name,
          accountId: nameData.ids[0], // Already converted
          allIds: nameData.ids // Already converted
        };
      }
    }

    // Then try to find by name (case-insensitive)
    const nameLower = queryStr.toLowerCase();
    const nameData = this.nameToIds.get(nameLower);
    if (nameData) {
      return {
        name: nameData.name,
        accountId: nameData.ids[0], // Already converted
        allIds: nameData.ids // Already converted
      };
    }

    return null;
  }

  /**
   * Get the best account ID for a player based on matches in last 24 hours
   * Returns the account ID with the most matches, or the first one if no matches
   */
  async getBestAccountId(playerName, opendotaClient) {
    const nameData = this.nameToIds.get(playerName.toLowerCase());
    if (!nameData || !nameData.ids || nameData.ids.length === 0) {
      return null;
    }

    // If only one ID, return it
    if (nameData.ids.length === 1) {
      return nameData.ids[0];
    }

    // Check matches for each account in last 24 hours
    const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
    const accountMatches = [];

    for (const accountId of nameData.ids) {
      try {
        const matchesData = await opendotaClient.getPlayerMatches(accountId, 50);
        const recentMatches = (matchesData || []).filter(match => 
          match.start_time >= twentyFourHoursAgo
        );
        accountMatches.push({
          accountId,
          matchCount: recentMatches.length
        });
      } catch (error) {
        logger.warn(`Error fetching matches for account ${accountId}:`, error.message);
        accountMatches.push({
          accountId,
          matchCount: 0
        });
      }
    }

    // Sort by match count (descending) and return the account with most matches
    accountMatches.sort((a, b) => b.matchCount - a.matchCount);
    return accountMatches[0].accountId;
  }

  /**
   * Get all account IDs for a player
   */
  getAllAccountIds(playerName) {
    const nameData = this.nameToIds.get(playerName.toLowerCase());
    if (!nameData) return [];
    return nameData.ids;
  }
}


