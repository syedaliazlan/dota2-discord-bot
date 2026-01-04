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
      logger.info('Fetching heroes list from OpenDota API...');
      const heroes = await opendotaClient.getHeroes();
      
      if (!heroes) {
        logger.warn('No heroes data received from API, using empty map');
        return {};
      }
      
      heroMap = {};
      
      if (Array.isArray(heroes)) {
        heroes.forEach(hero => {
          heroMap[hero.id] = hero.localized_name || hero.name;
        });
        logger.info(`Loaded ${Object.keys(heroMap).length} heroes from API`);
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

