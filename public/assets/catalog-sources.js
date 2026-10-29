export const CATALOG_VIEWS = Object.freeze({
  latest: { title: 'All Anime', description: 'All posts, ordered by the latest episode updates.', endpoint: '/latest-updated' },
  trending: { title: 'Trending Anime', description: 'Discover the titles trending now.', endpoint: '/trending' },
  added: { title: 'Newly Added Anime', description: 'The newest additions to the catalog.', endpoint: '/newly-added' },
  popular: { title: 'Most Popular Anime', description: 'Browse the most popular anime.', endpoint: '/most-popular' },
  upcoming: { title: 'Upcoming Anime', description: 'Discover anime that have not aired yet.', endpoint: '/status/upcoming' },
  ongoing: { title: 'Ongoing Anime', description: 'Anime that are currently airing.', endpoint: '/status/ongoing' },
  completed: { title: 'Completed Anime', description: 'Browse anime that have finished airing.', endpoint: '/status/completed' },
});
export const ANIME_TYPES = Object.freeze({ tv: 'TV Series', movie: 'Movies', ova: 'OVA', ona: 'ONA', special: 'Specials' });

/** @param {unknown} value @returns {value is keyof typeof CATALOG_VIEWS} */
export const isCatalogSource = value => typeof value === 'string' && Object.hasOwn(CATALOG_VIEWS, value);
/** @param {unknown} value @returns {value is keyof typeof ANIME_TYPES} */
export const isAnimeType = value => typeof value === 'string' && Object.hasOwn(ANIME_TYPES, value);
