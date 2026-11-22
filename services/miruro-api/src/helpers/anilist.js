/*
 * ======= • ======= • ======= • ======= • =======• =======
 * MiruroAPI — anilist.js
 * Repository: https://github.com/Shineii86/MiruroAPI
 *
 * @description
 *   AniList GraphQL API integration module. Provides functions for
 *   searching anime, fetching details, browsing collections, and
 *   querying the AniList GraphQL API. All metadata (titles, covers,
 *   genres, scores, characters, relations) comes from AniList.
 *
 * @exports
 *   searchAnime, getSuggestions, getAnimeInfo, getAnimeCharacters,
 *   getAnimeRelations, getAnimeRecommendations, getCollection,
 *   getSpotlight, getSchedule, filterAnime
 *
 * @author  Shinei Nouzen
 * @license MIT
 * ======= • ======= • ======= • ======= • =======• =======
 */

const axios = require("axios");

// ══════════════════════════════════════════════════════════════
// ANILIST API CONFIGURATION
// ══════════════════════════════════════════════════════════════

/**
 * AniList GraphQL API endpoint.
 * Used for all metadata queries (search, trending, info, filter).
 *
 * @type {string}
 */
const ANILIST_URL = "https://graphql.anilist.co";

// ══════════════════════════════════════════════════════════════
// GRAPHQL FRAGMENTS
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Media list fields fragment (used in collections/search) ----
/**
 * Standard set of fields for anime list responses.
 * Used in trending, popular, search, filter, and schedule endpoints.
 * Includes titles, cover, format, scores, genres, studios, and airing info.
 *
 * @type {string}
 */
const MEDIA_LIST_FIELDS = `
  id
  title { romaji english native }
  coverImage { large extraLarge }
  bannerImage
  format
  season
  seasonYear
  episodes
  duration
  status
  averageScore
  meanScore
  popularity
  favourites
  genres
  source
  countryOfOrigin
  isAdult
  studios(isMain: true) { nodes { name isAnimationStudio } }
  nextAiringEpisode { episode airingAt timeUntilAiring }
  startDate { year month day }
  endDate { year month day }
`;

// ---- FEATURE: Media full fields fragment (used in info endpoint) ----
/**
 * Extended set of fields for detailed anime info responses.
 * Includes everything in MEDIA_LIST_FIELDS plus characters, staff,
 * relations, recommendations, trailer, stats, and external links.
 *
 * @type {string}
 */
const MEDIA_FULL_FIELDS = `
  id
  idMal
  title { romaji english native }
  description(asHtml: false)
  coverImage { large extraLarge color }
  bannerImage
  format
  season
  seasonYear
  episodes
  duration
  status
  averageScore
  meanScore
  popularity
  favourites
  trending
  genres
  tags { name rank isMediaSpoiler }
  source
  countryOfOrigin
  isAdult
  hashtag
  synonyms
  siteUrl
  trailer { id site thumbnail }
  studios { nodes { id name isAnimationStudio siteUrl } }
  nextAiringEpisode { episode airingAt timeUntilAiring }
  startDate { year month day }
  endDate { year month day }
  characters(sort: [ROLE, RELEVANCE], perPage: 25) {
    edges {
      role
      node { id name { full native } image { large } }
      voiceActors(language: JAPANESE) { id name { full native } image { large } languageV2 }
    }
  }
  staff(sort: RELEVANCE, perPage: 25) {
    edges {
      role
      node { id name { full native } image { large } }
    }
  }
  relations {
    edges {
      relationType(version: 2)
      node {
        id
        title { romaji english native }
        coverImage { large }
        format
        type
        status
        episodes
        meanScore
      }
    }
  }
  recommendations(sort: RATING_DESC, perPage: 10) {
    nodes {
      rating
      mediaRecommendation {
        id
        title { romaji english native }
        coverImage { large }
        format
        episodes
        status
        meanScore
        averageScore
      }
    }
  }
  externalLinks { url site type }
  streamingEpisodes { title thumbnail url site }
  stats {
    scoreDistribution { score amount }
    statusDistribution { status amount }
  }
`;

// ══════════════════════════════════════════════════════════════
// CORE QUERY FUNCTION
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Execute AniList GraphQL query ----
/**
 * Executes a GraphQL query against the AniList API.
 * Handles request formatting and error checking.
 *
 * @param {string} query - The GraphQL query string
 * @param {object} [variables={}] - Query variables
 * @returns {Promise<object>} The `data` field from the AniList response
 * @throws {Error} If the AniList API returns a non-200 status
 *
 * @example
 *   const data = await anilistQuery(MEDIA_LIST_FIELDS, { search: "naruto" });
 */
const anilistQuery = async (query, variables = {}) => {
  const body = { query, variables };
  const res = await axios.post(ANILIST_URL, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
  });

  if (res.status !== 200) throw new Error("AniList query failed");
  return res.data.data;
};

// ══════════════════════════════════════════════════════════════
// SEARCH ENDPOINTS
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Full-text anime search with pagination ----
/**
 * Searches AniList for anime matching the given query.
 * Returns paginated results with full metadata per result.
 *
 * @param {string} query - The search query string
 * @param {number} [page=1] - Page number for pagination
 * @param {number} [perPage=20] - Results per page (max 50)
 * @returns {Promise<object>} Paginated search results with page, perPage, total, hasNextPage, results[]
 *
 * @example
 *   const results = await searchAnime("naruto", 1, 10);
 *   console.log(results.total); // 5000+
 */
const searchAnime = async (query, page = 1, perPage = 20) => {
  const gql = `
    query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          ${MEDIA_LIST_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { search: query, page, perPage });
  const pageData = data.Page;

  return {
    page: pageData.pageInfo.currentPage,
    perPage: pageData.pageInfo.perPage,
    total: pageData.pageInfo.total,
    hasNextPage: pageData.pageInfo.hasNextPage,
    results: pageData.media,
  };
};

// ---- FEATURE: Lightweight autocomplete suggestions (max 8) ----
/**
 * Fetches search suggestions for autocomplete dropdowns.
 * Returns minimal data (id, title, poster, format, status, year).
 *
 * @param {string} query - The search query string
 * @returns {Promise<Array>} Array of up to 8 suggestion objects
 *
 * @example
 *   const suggestions = await getSuggestions("one piece");
 *   console.log(suggestions[0].title); // "ONE PIECE"
 */
const getSuggestions = async (query) => {
  const gql = `
    query ($search: String) {
      Page(page: 1, perPage: 8) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          title { romaji english }
          coverImage { large }
          format
          status
          startDate { year }
          episodes
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { search: query });

  return data.Page.media.map((item) => ({
    id: item.id,
    title: item.title.english || item.title.romaji,
    title_romaji: item.title.romaji,
    poster: item.coverImage.large,
    format: item.format,
    status: item.status,
    year: item.startDate?.year,
    episodes: item.episodes,
  }));
};

// ══════════════════════════════════════════════════════════════
// ANIME DETAILS
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Complete anime info by AniList ID ----
/**
 * Fetches full anime metadata including characters, staff,
 * relations, recommendations, trailer, stats, and external links.
 *
 * @param {number} id - AniList anime ID
 * @returns {Promise<object>} Complete anime metadata object
 * @throws {Error} If anime is not found
 *
 * @example
 *   const info = await getAnimeInfo(20); // Naruto
 *   console.log(info.title.romaji); // "NARUTO"
 */
const getAnimeInfo = async (id) => {
  const gql = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FULL_FIELDS}
      }
    }
  `;
  const data = await anilistQuery(gql, { id });
  return data.Media;
};

// ---- FEATURE: Paginated character list with voice actors ----
/**
 * Fetches paginated character list for an anime.
 * Each character includes name, image, role, and Japanese voice actors.
 *
 * @param {number} id - AniList anime ID
 * @param {number} [page=1] - Page number
 * @param {number} [perPage=25] - Results per page (max 50)
 * @returns {Promise<object>} Paginated character list
 */
const getAnimeCharacters = async (id, page = 1, perPage = 25) => {
  const gql = `
    query ($id: Int, $page: Int, $perPage: Int) {
      Media(id: $id, type: ANIME) {
        id
        title { romaji english }
        characters(sort: [ROLE, RELEVANCE], page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          edges {
            role
            node { id name { full native userPreferred } image { large medium } description gender favourites siteUrl }
            voiceActors { id name { full native } image { large } languageV2 }
          }
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { id, page, perPage });
  if (!data.Media) throw new Error("Anime not found");

  const chars = data.Media.characters;
  return {
    page: chars.pageInfo.currentPage,
    perPage: chars.pageInfo.perPage,
    total: chars.pageInfo.total,
    hasNextPage: chars.pageInfo.hasNextPage,
    characters: chars.edges,
  };
};

// ---- FEATURE: Related anime (sequels, prequels, spin-offs) ----
/**
 * Fetches all related media for an anime — sequels, prequels,
 * side stories, spin-offs, and source material.
 *
 * @param {number} id - AniList anime ID
 * @returns {Promise<object>} Relations with id, title, and relations[]
 */
const getAnimeRelations = async (id) => {
  const gql = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title { romaji english }
        relations {
          edges {
            relationType(version: 2)
            node {
              id title { romaji english native } coverImage { large }
              format type status episodes meanScore averageScore popularity
            }
          }
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { id });
  if (!data.Media) throw new Error("Anime not found");

  return {
    id: data.Media.id,
    title: data.Media.title,
    relations: data.Media.relations.edges,
  };
};

// ---- FEATURE: Community recommendations sorted by rating ----
/**
 * Fetches paginated community recommendations for an anime.
 * "If you liked X, you'll like Y" — sorted by highest rating.
 *
 * @param {number} id - AniList anime ID
 * @param {number} [page=1] - Page number
 * @param {number} [perPage=10] - Results per page (max 25)
 * @returns {Promise<object>} Paginated recommendations
 */
const getAnimeRecommendations = async (id, page = 1, perPage = 10) => {
  const gql = `
    query ($id: Int, $page: Int, $perPage: Int) {
      Media(id: $id, type: ANIME) {
        id
        title { romaji english }
        recommendations(sort: RATING_DESC, page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          nodes {
            rating
            mediaRecommendation {
              id title { romaji english native } coverImage { large extraLarge }
              format episodes status meanScore averageScore popularity genres
            }
          }
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { id, page, perPage });
  if (!data.Media) throw new Error("Anime not found");

  const recs = data.Media.recommendations;
  return {
    page: recs.pageInfo.currentPage,
    perPage: recs.pageInfo.perPage,
    total: recs.pageInfo.total,
    hasNextPage: recs.pageInfo.hasNextPage,
    recommendations: recs.nodes,
  };
};

// ══════════════════════════════════════════════════════════════
// COLLECTIONS
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Generic collection fetcher with sort and status ----
/**
 * Internal helper for fetching anime collections (trending, popular, etc.).
 * Builds a dynamic GraphQL query based on sort type and optional status filter.
 *
 * @param {string} sortType - AniList sort enum (e.g., "TRENDING_DESC", "POPULARITY_DESC")
 * @param {string|null} status - Optional status filter (e.g., "RELEASING", "NOT_YET_RELEASED")
 * @param {number} [page=1] - Page number
 * @param {number} [perPage=20] - Results per page
 * @returns {Promise<object>} Paginated collection results
 */
const getCollection = async (sortType, status = null, page = 1, perPage = 20) => {
  const statusFilter = status ? `, status: ${status}` : "";
  const gql = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, sort: [${sortType}]${statusFilter}) {
          ${MEDIA_LIST_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { page, perPage });
  const pageData = data.Page;

  return {
    page: pageData.pageInfo.currentPage,
    perPage: pageData.pageInfo.perPage,
    total: pageData.pageInfo.total,
    hasNextPage: pageData.pageInfo.hasNextPage,
    results: pageData.media,
  };
};

// ---- FEATURE: Spotlight/featured anime (top 10 trending + popular) ----
/**
 * Fetches the top 10 trending + popular anime for hero banners.
 * Combines TRENDING_DESC and POPULARITY_DESC sorts.
 *
 * @returns {Promise<Array>} Array of up to 10 anime objects
 */
const getSpotlight = async () => {
  const gql = `
    query {
      Page(page: 1, perPage: 10) {
        media(sort: [TRENDING_DESC, POPULARITY_DESC], type: ANIME) {
          ${MEDIA_LIST_FIELDS}
          description(asHtml: false)
        }
      }
    }
  `;
  const data = await anilistQuery(gql);
  return data.Page.media;
};

// ---- FEATURE: Airing schedule with timestamps ----
/**
 * Fetches upcoming anime episodes with UNIX timestamps.
 * Each result includes next_episode number, airingAt, and timeUntilAiring.
 *
 * @param {number} [page=1] - Page number
 * @param {number} [perPage=20] - Results per page
 * @returns {Promise<object>} Paginated schedule with airing timestamps
 */
const getSchedule = async (page = 1, perPage = 20) => {
  const gql = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        airingSchedules(notYetAired: true, sort: TIME) {
          episode
          airingAt
          timeUntilAiring
          media { ${MEDIA_LIST_FIELDS} }
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { page, perPage });
  const pageData = data.Page;

  const results = pageData.airingSchedules.map((item) => ({
    ...item.media,
    next_episode: item.episode,
    airingAt: item.airingAt,
    timeUntilAiring: item.timeUntilAiring,
  }));

  return {
    page: pageData.pageInfo.currentPage,
    perPage: pageData.pageInfo.perPage,
    total: pageData.pageInfo.total,
    hasNextPage: pageData.pageInfo.hasNextPage,
    results,
  };
};

// ---- FEATURE: Advanced anime filter with multiple parameters ----
/**
 * Advanced anime filter supporting genre, tag, year, season,
 * format, status, and sort. All parameters are optional.
 *
 * @param {object} options - Filter options
 * @param {string} [options.genre] - Genre name (e.g., "Action", "Romance")
 * @param {string} [options.tag] - Tag name (e.g., "Isekai", "Time Skip")
 * @param {number} [options.year] - Season year (e.g., 2025)
 * @param {string} [options.season] - Season (WINTER, SPRING, SUMMER, FALL)
 * @param {string} [options.format] - Format (TV, MOVIE, OVA, ONA, SPECIAL)
 * @param {string} [options.status] - Status (RELEASING, FINISHED, NOT_YET_RELEASED)
 * @param {string} [options.sort="POPULARITY_DESC"] - Sort order
 * @param {number} [options.page=1] - Page number
 * @param {number} [options.perPage=20] - Results per page
 * @returns {Promise<object>} Paginated filtered results
 */
const filterAnime = async ({
  search, genre, tag, year, season, format, status,
  sort = "POPULARITY_DESC", page = 1, perPage = 20,
}) => {
  const SORT_MAP = {
    SCORE_DESC: "SCORE_DESC",
    POPULARITY_DESC: "POPULARITY_DESC",
    TRENDING_DESC: "TRENDING_DESC",
    START_DATE_DESC: "START_DATE_DESC",
    FAVOURITES_DESC: "FAVOURITES_DESC",
    UPDATED_AT_DESC: "UPDATED_AT_DESC",
    SEARCH_MATCH: "SEARCH_MATCH",
  };

  const args = ["type: ANIME", `sort: [${SORT_MAP[sort] || "POPULARITY_DESC"}]`];
  const variables = { page, perPage };
  const varTypes = ["$page: Int", "$perPage: Int"];

  if (search) { args.push("search: $search"); variables.search = search; varTypes.push("$search: String"); }
  if (genre) { args.push("genre: $genre"); variables.genre = genre; varTypes.push("$genre: String"); }
  if (tag) { args.push("tag: $tag"); variables.tag = tag; varTypes.push("$tag: String"); }
  if (year) { args.push("seasonYear: $seasonYear"); variables.seasonYear = year; varTypes.push("$seasonYear: Int"); }
  if (season) { args.push("season: $season"); variables.season = season.toUpperCase(); varTypes.push("$season: MediaSeason"); }
  if (format) { args.push("format: $format"); variables.format = format.toUpperCase(); varTypes.push("$format: MediaFormat"); }
  if (status) { args.push("status: $status"); variables.status = status.toUpperCase(); varTypes.push("$status: MediaStatus"); }

  const gql = `
    query (${varTypes.join(", ")}) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(${args.join(", ")}) {
          ${MEDIA_LIST_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(gql, variables);
  const pageData = data.Page;

  return {
    page: pageData.pageInfo.currentPage,
    perPage: pageData.pageInfo.perPage,
    total: pageData.pageInfo.total,
    hasNextPage: pageData.pageInfo.hasNextPage,
    results: pageData.media,
  };
};

// ══════════════════════════════════════════════════════════════
// GENRES & CATEGORIES
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Get all available genres ----
/**
 * Returns the complete list of AniList genres.
 *
 * @returns {Promise<Array>} Array of genre name strings
 */
const getAllGenres = async () => {
  const gql = `query { GenreCollection }`;
  const data = await anilistQuery(gql);
  return data.GenreCollection;
};

// ---- FEATURE: Get all available tags ----
/**
 * Returns the complete list of AniList tags with metadata.
 *
 * @returns {Promise<Array>} Array of tag objects { name, description, category, rank, isGeneralSpoiler, isMediaSpoiler, isAdult }
 */
const getAllTags = async () => {
  const gql = `query { MediaTagCollection { name description category isGeneralSpoiler isMediaSpoiler isAdult } }`;
  const data = await anilistQuery(gql);
  return data.MediaTagCollection;
};

// ══════════════════════════════════════════════════════════════
// TOP & TRENDING
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Top anime by score (all time) ----
/**
 * Fetches top-rated anime of all time sorted by score.
 *
 * @param {number} [page=1] - Page number
 * @param {number} [perPage=20] - Results per page
 * @returns {Promise<object>} Paginated top anime results
 */
const getTopAnime = async (page = 1, perPage = 20) => {
  const gql = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, sort: SCORE_DESC) {
          ${MEDIA_LIST_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { page, perPage });
  const pageData = data.Page;

  return {
    page: pageData.pageInfo.currentPage,
    perPage: pageData.pageInfo.perPage,
    total: pageData.pageInfo.total,
    hasNextPage: pageData.pageInfo.hasNextPage,
    results: pageData.media,
  };
};

// ---- FEATURE: Daily trending anime ----
/**
 * Fetches currently trending anime (last 7 days).
 *
 * @param {number} [page=1] - Page number
 * @param {number} [perPage=20] - Results per page
 * @returns {Promise<object>} Paginated trending results
 */
const getTrendingDaily = async (page = 1, perPage = 20) => {
  const gql = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, sort: TRENDING_DESC) {
          ${MEDIA_LIST_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { page, perPage });
  const pageData = data.Page;

  return {
    page: pageData.pageInfo.currentPage,
    perPage: pageData.pageInfo.perPage,
    total: pageData.pageInfo.total,
    hasNextPage: pageData.pageInfo.hasNextPage,
    results: pageData.media,
  };
};

// ---- FEATURE: Weekly trending anime ----
/**
 * Fetches currently trending anime (last 30 days).
 * Returns more results than daily to cover a wider window.
 *
 * @param {number} [page=1] - Page number
 * @param {number} [perPage=40] - Results per page (default 40, wider than daily)
 * @returns {Promise<object>} Paginated trending results
 */
const getTrendingWeekly = async (page = 1, perPage = 40) => {
  const gql = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, sort: TRENDING_DESC) {
          ${MEDIA_LIST_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { page, perPage });
  const pageData = data.Page;

  return {
    page: pageData.pageInfo.currentPage,
    perPage: pageData.pageInfo.perPage,
    total: pageData.pageInfo.total,
    hasNextPage: pageData.pageInfo.hasNextPage,
    results: pageData.media,
  };
};

// ══════════════════════════════════════════════════════════════
// SEASONAL & STUDIO
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Seasonal anime by year and season ----
/**
 * Fetches anime for a specific season and year.
 *
 * @param {number} year - The year (e.g., 2025)
 * @param {string} season - The season (WINTER, SPRING, SUMMER, FALL)
 * @param {number} [page=1] - Page number
 * @param {number} [perPage=20] - Results per page
 * @returns {Promise<object>} Paginated seasonal anime results
 */
const getSeasonalAnime = async (year, season, page = 1, perPage = 20) => {
  const gql = `
    query ($year: Int, $season: MediaSeason, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC) {
          ${MEDIA_LIST_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { year, season: season.toUpperCase(), page, perPage });
  const pageData = data.Page;

  return {
    page: pageData.pageInfo.currentPage,
    perPage: pageData.pageInfo.perPage,
    total: pageData.pageInfo.total,
    hasNextPage: pageData.pageInfo.hasNextPage,
    results: pageData.media,
  };
};

// ---- FEATURE: Anime by studio name ----
/**
 * Fetches all anime produced by a specific studio.
 *
 * @param {string} studioName - The studio name to search for
 * @param {number} [page=1] - Page number
 * @param {number} [perPage=20] - Results per page
 * @returns {Promise<object>} Paginated studio anime results
 */
const getAnimeByStudio = async (studioName, page = 1, perPage = 20) => {
  const gql = `
    query ($name: String, $page: Int, $perPage: Int) {
      Studio(search: $name) {
        id name isAnimationStudio siteUrl
        media(sort: POPULARITY_DESC, page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          nodes { ${MEDIA_LIST_FIELDS} }
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { name: studioName, page, perPage });
  const studio = data.Studio;

  if (!studio) throw new Error("Studio not found");

  return {
    studio: {
      id: studio.id,
      name: studio.name,
      isAnimationStudio: studio.isAnimationStudio,
      siteUrl: studio.siteUrl,
    },
    page: studio.media.pageInfo.currentPage,
    perPage: studio.media.pageInfo.perPage,
    total: studio.media.pageInfo.total,
    hasNextPage: studio.media.pageInfo.hasNextPage,
    results: studio.media.nodes,
  };
};

// ══════════════════════════════════════════════════════════════
// CHARACTER & STAFF
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Character detail with anime list ----
/**
 * Fetches detailed character info including all anime appearances.
 *
 * @param {number} id - AniList character ID
 * @returns {Promise<object>} Character details with anime list
 */
const getCharacterInfo = async (id) => {
  const gql = `
    query ($id: Int) {
      Character(id: $id) {
        id name { full native userPreferred }
        image { large medium }
        description gender favourites siteUrl
        dateOfBirth { year month day }
        age bloodType
        media(perPage: 25, sort: POPULARITY_DESC) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          edges {
            characterRole
            node { id title { romaji english } coverImage { large } format episodes status meanScore }
          }
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { id });
  if (!data.Character) throw new Error("Character not found");
  return data.Character;
};

// ---- FEATURE: Staff detail with anime list ----
/**
 * Fetches detailed staff info including all anime works.
 *
 * @param {number} id - AniList staff ID
 * @returns {Promise<object>} Staff details with anime list
 */
const getStaffInfo = async (id) => {
  const gql = `
    query ($id: Int) {
      Staff(id: $id) {
        id name { full native userPreferred }
        image { large medium }
        description gender favourites siteUrl
        dateOfBirth { year month day }
        age homeTown yearsActive
        staffMedia(perPage: 25, sort: POPULARITY_DESC) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          edges {
            node { id title { romaji english } coverImage { large } format episodes status meanScore }
          }
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { id });
  if (!data.Staff) throw new Error("Staff not found");
  return data.Staff;
};

// ---- FEATURE: Search characters by name ----
/**
 * Searches AniList characters by name.
 *
 * @param {string} query - Character name to search
 * @param {number} [page=1] - Page number
 * @param {number} [perPage=20] - Results per page
 * @returns {Promise<object>} Paginated character search results
 */
const searchCharacters = async (query, page = 1, perPage = 20) => {
  const gql = `
    query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        characters(search: $search, sort: SEARCH_MATCH) {
          id name { full native userPreferred } image { large medium } gender favourites siteUrl
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { search: query, page, perPage });
  const pageData = data.Page;

  return {
    page: pageData.pageInfo.currentPage,
    perPage: pageData.pageInfo.perPage,
    total: pageData.pageInfo.total,
    hasNextPage: pageData.pageInfo.hasNextPage,
    results: pageData.characters,
  };
};

// ---- FEATURE: Search staff by name ----
/**
 * Searches AniList staff by name.
 *
 * @param {string} query - Staff name to search
 * @param {number} [page=1] - Page number
 * @param {number} [perPage=20] - Results per page
 * @returns {Promise<object>} Paginated staff search results
 */
const searchStaff = async (query, page = 1, perPage = 20) => {
  const gql = `
    query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        staff(search: $search, sort: SEARCH_MATCH) {
          id name { full native userPreferred } image { large medium } gender favourites siteUrl
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { search: query, page, perPage });
  const pageData = data.Page;

  return {
    page: pageData.pageInfo.currentPage,
    perPage: pageData.pageInfo.perPage,
    total: pageData.pageInfo.total,
    hasNextPage: pageData.pageInfo.hasNextPage,
    results: pageData.staff,
  };
};

module.exports = {
  anilistQuery,
  searchAnime,
  getSuggestions,
  getAnimeInfo,
  getAnimeCharacters,
  getAnimeRelations,
  getAnimeRecommendations,
  getCollection,
  getSpotlight,
  getSchedule,
  filterAnime,
  getAllGenres,
  getAllTags,
  getTopAnime,
  getTrendingDaily,
  getTrendingWeekly,
  getSeasonalAnime,
  getAnimeByStudio,
  getCharacterInfo,
  getStaffInfo,
  searchCharacters,
  searchStaff,
  MEDIA_LIST_FIELDS,
  MEDIA_FULL_FIELDS,
};

// ══════════════════════════════════════════════════════════════ END: anilist.js

