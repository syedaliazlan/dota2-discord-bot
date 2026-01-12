import { logger } from './logger.js';

/**
 * Load hero names from STRATZ API and create mapping
 * This ensures we have the correct hero_id to name mapping
 */
let heroMap = null;
let heroMapPromise = null;

/**
 * Load heroes from STRATZ API
 */
export async function loadHeroesFromAPI(stratzClient) {
  if (heroMap) {
    return heroMap;
  }

  if (heroMapPromise) {
    return heroMapPromise;
  }

  heroMapPromise = (async () => {
    try {
      logger.info('Fetching heroes list from STRATZ API...');
      const heroes = await stratzClient.getHeroes();
      
      if (!heroes) {
        logger.warn('No heroes data received from API, using empty map');
        return {};
      }
      
      heroMap = {};
      
      if (Array.isArray(heroes)) {
        heroes.forEach(hero => {
          // STRATZ uses displayName for the localized name
          heroMap[hero.id] = hero.displayName || hero.name;
        });
        logger.info(`Loaded ${Object.keys(heroMap).length} heroes from STRATZ API`);
      } else {
        logger.warn('Heroes data is not an array, using empty map');
        return {};
      }
      
      return heroMap;
    } catch (error) {
      logger.error('Failed to load heroes from API:', error.message || error);
      logger.warn('Continuing with empty hero map - hero names may not display correctly');
      return {};
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
