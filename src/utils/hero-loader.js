import { logger } from './logger.js';

/**
 * Load hero names from OpenDota API and create mapping
 * This ensures we have the correct hero_id to name mapping
 */
let heroMap = null;
let heroMapPromise = null;

/**
 * Load heroes from OpenDota API
 */
export async function loadHeroesFromAPI(opendotaClient) {
  if (heroMap) {
    return heroMap;
  }

  if (heroMapPromise) {
    return heroMapPromise;
  }

  heroMapPromise = (async () => {
    try {
      const heroes = await opendotaClient.getHeroes();
      heroMap = {};
      
      if (heroes && Array.isArray(heroes)) {
        heroes.forEach(hero => {
          heroMap[hero.id] = hero.localized_name || hero.name;
        });
      }
      
      return heroMap;
    } catch (error) {
      logger.error('Failed to load heroes from API:', error);
      return null;
    }
  })();

  return heroMapPromise;
}

/**
 * Get hero name by ID using API-loaded mapping
 */
export function getHeroNameFromAPI(heroId, heroMap) {
  if (!heroMap) {
    return null;
  }
  return heroMap[heroId] || null;
}

