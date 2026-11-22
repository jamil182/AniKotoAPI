export const SEARCH_KINDS = Object.freeze({ anime:'Anime', studios:'Studios', staff:'Staff', characters:'Characters' });
export const SEARCH_GENRES = Object.freeze(['Action','Adventure','Comedy','Drama','Ecchi','Fantasy','Horror','Mahou Shoujo','Mecha','Music','Mystery','Psychological','Romance','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller']);
export const SEARCH_FORMATS = Object.freeze({ TV:'TV Series', TV_SHORT:'TV Short', MOVIE:'Movie', OVA:'OVA', ONA:'ONA', SPECIAL:'Special', MUSIC:'Music' });
export const SEARCH_STATUSES = Object.freeze({ RELEASING:'Airing', FINISHED:'Completed', NOT_YET_RELEASED:'Upcoming', CANCELLED:'Cancelled', HIATUS:'On hiatus' });
export const SEARCH_SORTS = Object.freeze({ POPULARITY_DESC:'Most Popular', SCORE_DESC:'Highest Rated', TRENDING_DESC:'Trending', START_DATE_DESC:'Newest', FAVOURITES_DESC:'Most Favourited' });

/** @param {Record<string,unknown>} input @param {{strict?: boolean}} [options]
 * @returns {import('./search-filters.types.js').SearchFilters} */
export function searchFilters(input, {strict = false} = {}) {
  const output = {kind:'anime',page:'1',sort:'POPULARITY_DESC'};
  const invalid = key => { if (strict) throw new Error(`Invalid ${key}`); };
  for (const key of ['kind','q','genre','format','status','year','sort','page','studio']) {
    const value = input[key]; if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) { invalid(key); continue; }
    const text = value.trim(); if (!text) continue;
    const valid = key === 'q' || key === 'studio' ? text.length <= 120
      : key === 'kind' ? Object.hasOwn(SEARCH_KINDS,text)
      : key === 'genre' ? SEARCH_GENRES.includes(text)
      : key === 'format' ? Object.hasOwn(SEARCH_FORMATS,text)
      : key === 'status' ? Object.hasOwn(SEARCH_STATUSES,text)
      : key === 'sort' ? Object.hasOwn(SEARCH_SORTS,text)
      : key === 'year' ? /^\d{4}$/.test(text) && Number(text)>=1900 && Number(text)<=2100
      : /^[1-9]\d{0,2}$/.test(text);
    if (!valid) { invalid(key); continue; }
    output[key] = text;
  }
  if (output.kind !== 'anime') for (const key of ['genre','format','status','year','studio']) delete output[key];
  if (output.studio) for (const key of ['q','genre','format','status','year']) delete output[key];
  return output;
}
