import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';

/**
 * Dotabuff scraper for additional profile data
 * Note: Use responsibly and respect rate limits
 */
export class DotabuffScraper {
  constructor() {
    this.baseUrl = 'https://www.dotabuff.com';
    this.requestDelay = 2000; // 2 seconds between requests
    this.lastRequestTime = 0;
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  }

  /**
   * Wait for rate limiting
   */
  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.requestDelay) {
      const waitTime = this.requestDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Fetch and parse HTML page
   */
  async fetchPage(url) {
    await this.waitForRateLimit();

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 10000
      });

      return cheerio.load(response.data);
    } catch (error) {
      // Dotabuff often blocks scraping with 403 - this is expected
      if (error.response?.status === 403) {
        logger.debug(`Dotabuff blocked access to ${url} (403) - this is expected, bot will continue with OpenDota data only`);
      } else {
        logger.warn(`Failed to fetch Dotabuff page ${url}:`, error.message);
      }
      return null;
    }
  }

  /**
   * Get player profile data from Dotabuff
   */
  async getPlayerProfile(accountId) {
    logger.debug(`Scraping Dotabuff profile for account ${accountId}`);
    
    const url = `${this.baseUrl}/players/${accountId}`;
    const $ = await this.fetchPage(url);

    if (!$) {
      return null;
    }

    try {
      const profile = {
        accountId,
        name: $('h1').first().text().trim(),
        rank: $('.header-content-secondary').text().trim(),
        // Extract additional stats from the page
        stats: {}
      };

      // Try to extract MMR if available
      const mmrElement = $('.header-content-secondary').find('span').first();
      if (mmrElement.length) {
        profile.mmr = mmrElement.text().trim();
      }

      return profile;
    } catch (error) {
      logger.error('Failed to parse Dotabuff profile:', error.message);
      return null;
    }
  }

  /**
   * Get player achievements (if available on Dotabuff)
   */
  async getPlayerAchievements(accountId) {
    logger.debug(`Scraping achievements for account ${accountId}`);
    
    const url = `${this.baseUrl}/players/${accountId}/achievements`;
    const $ = await this.fetchPage(url);

    if (!$) {
      return null;
    }

    try {
      const achievements = [];
      
      // Extract achievement data from the page
      // This is a placeholder - actual structure depends on Dotabuff's HTML
      $('.achievement').each((i, elem) => {
        const $elem = $(elem);
        achievements.push({
          name: $elem.find('.achievement-name').text().trim(),
          description: $elem.find('.achievement-desc').text().trim(),
          unlocked: $elem.hasClass('unlocked')
        });
      });

      return achievements;
    } catch (error) {
      logger.error('Failed to parse Dotabuff achievements:', error.message);
      return null;
    }
  }

  /**
   * Get recent match performance
   */
  async getRecentMatchPerformance(accountId) {
    logger.debug(`Scraping recent match performance for account ${accountId}`);
    
    const url = `${this.baseUrl}/players/${accountId}/matches`;
    const $ = await this.fetchPage(url);

    if (!$) {
      return null;
    }

    try {
      // Extract match performance data
      // This is a placeholder - actual implementation depends on Dotabuff's structure
      return {
        recentWinRate: null,
        recentKDA: null
      };
    } catch (error) {
      logger.error('Failed to parse recent match performance:', error.message);
      return null;
    }
  }
}

