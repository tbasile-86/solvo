const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function parsePagination(query) {
  let page = parseInt(query.page, 10);
  let pageSize = parseInt(query.page_size, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = { parsePagination };
