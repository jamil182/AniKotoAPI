const anilist = require('./src/helpers/anilist');

/** Fixed GraphQL documents keep user values in variables rather than query text. */
module.exports = async function discover(params) {
  const kind = params.kind || 'anime', page = Number(params.page || 1), perPage = 28;
  const search = typeof params.q === 'string' && params.q.trim() ? params.q.trim().slice(0,120) : null;
  if (!['anime','studios','staff','characters'].includes(kind) || !Number.isInteger(page) || page<1 || page>999) throw new Error('Invalid search parameters');
  if (kind === 'anime') {
    if (params.studio) return anilist.getAnimeByStudio(String(params.studio).slice(0,120),page,perPage);
    return anilist.filterAnime({ search,genre:params.genre,format:params.format,status:params.status,year:params.year ? Number(params.year) : null,sort:params.sort,page,perPage });
  }
  const fields = kind === 'studios'
    ? 'id name siteUrl isAnimationStudio media(perPage:1,sort:POPULARITY_DESC){nodes{coverImage{large}}}'
    : 'id name{full} image{large} siteUrl favourites';
  const document = `query ($search:String,$page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){pageInfo{total currentPage hasNextPage perPage} ${kind}(search:$search,sort:FAVOURITES_DESC){${fields}}}}`;
  const data = await anilist.anilistQuery(document,{search,page,perPage}), result = data?.Page;
  if (!result) throw new Error('Search source returned an invalid response');
  return {page:result.pageInfo.currentPage,perPage,total:result.pageInfo.total,hasNextPage:result.pageInfo.hasNextPage,results:result[kind]};
};
