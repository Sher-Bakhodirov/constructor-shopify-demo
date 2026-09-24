/**
 * <constructor-results> — Constructor-powered search & browse results grid.
 *
 * One element powers both surfaces; `mode` selects which Constructor API is called
 * and which container tracking attributes are emitted:
 *   - mode="search"  -> client.search.getSearchResults(query, params)
 *                       container: data-cnstrc-search + data-cnstrc-search-term
 *   - mode="browse"  -> client.browse.getBrowseResults(filterName, filterValue, params)
 *                       container: data-cnstrc-browse + filter-name/value
 *
 * The container div carries the Constructor data-driven attributes so the autotrack
 * beacon attributes clicks/conversions to this result set. Facets, sort and
 * load-more read/write the URL query string so results are shareable and the back
 * button works.
 *
 * Rendered by `sections/constructor-search.liquid` and `sections/constructor-collection.liquid`.
 */

import { getClient, isSurfaceEnabled } from '@theme/constructor';
import { renderCard, bindAddToCart } from '@theme/constructor-card';

const RESULTS_PER_PAGE = 24;

class ConstructorResults extends HTMLElement {
  #page = 1;
  #totalResults = 0;
  #resultId = '';
  #items = [];

  connectedCallback() {
    this.mode = this.getAttribute('mode') || 'search';

    // Only take over when Constructor is enabled for this surface. Otherwise the
    // section renders its native Shopify fallback and this element does nothing.
    if (!isSurfaceEnabled(this.mode === 'browse' ? 'browse' : 'search')) return;

    this.refs = {
      grid: this.querySelector('[data-cnstrc-grid]'),
      status: this.querySelector('[data-cnstrc-status]'),
      facets: this.querySelector('[data-cnstrc-facets]'),
      sort: this.querySelector('[data-cnstrc-sort]'),
      loadMore: this.querySelector('[data-cnstrc-load-more]'),
      title: this.querySelector('[data-cnstrc-title]'),
    };

    if (this.refs.loadMore) {
      this.refs.loadMore.addEventListener('click', () => this.#loadMore());
    }
    if (this.refs.grid) bindAddToCart(this.refs.grid);

    // Re-fetch when the query string changes (facet toggles, sort, back/forward).
    window.addEventListener('popstate', () => this.#fetch({ reset: true }));

    this.#fetch({ reset: true });
  }

  /** @returns {URLSearchParams} */
  get #params() {
    return new URLSearchParams(window.location.search);
  }

  /** The active search query (search mode). */
  get #query() {
    return this.#params.get('q') || '';
  }

  /**
   * Builds the request parameters (filters, sort, page) from the URL.
   * @param {number} page
   */
  #requestParameters(page) {
    const params = this.#params;
    const filters = {};
    for (const [key, value] of params) {
      const match = key.match(/^filters\[(.+)\]$/);
      if (match) filters[match[1]] = value.split(',');
    }
    return {
      page,
      resultsPerPage: RESULTS_PER_PAGE,
      filters,
      sortBy: params.get('sort_by') || undefined,
      sortOrder: params.get('sort_order') || undefined,
    };
  }

  /**
   * @param {{reset?: boolean}} [options]
   */
  async #fetch(options = {}) {
    const reset = options.reset !== false;
    if (reset) this.#page = 1;

    this.#setStatus('loading');

    try {
      const client = await getClient();
      const parameters = this.#requestParameters(this.#page);
      let response;

      if (this.mode === 'browse') {
        const filterName = this.getAttribute('filter-name') || 'group_id';
        const filterValue = this.getAttribute('filter-value') || '';
        response = await client.browse.getBrowseResults(filterName, filterValue, parameters);
      } else {
        response = await client.search.getSearchResults(this.#query, parameters);
      }

      const data = response.response || {};
      this.#resultId = response.result_id || '';
      this.#totalResults = data.total_num_results || 0;
      const results = data.results || [];
      this.#items = reset ? results : this.#items.concat(results);

      this.#applyContainerAttributes();
      this.#renderGrid();
      this.#renderFacets(data.facets || []);
      this.#renderSort(data.sort_options || []);
      this.#updateLoadMore();
      this.#updateTitle();

      this.#setStatus(this.#items.length ? 'ready' : 'empty');
    } catch (error) {
      console.error('[Constructor] results fetch failed', error);
      this.#setStatus('error');
    }
  }

  async #loadMore() {
    if (this.#page * RESULTS_PER_PAGE >= this.#totalResults) return;
    this.#page += 1;
    await this.#fetch({ reset: false });
  }

  /** Writes the data-cnstrc-* container attributes for the beacon. */
  #applyContainerAttributes() {
    const grid = this.refs.grid;
    if (!grid) return;

    grid.setAttribute('data-cnstrc-num-results', String(this.#totalResults));
    grid.setAttribute('data-cnstrc-result-id', this.#resultId);
    grid.setAttribute('data-cnstrc-result-page', String(this.#page));

    if (this.mode === 'browse') {
      grid.setAttribute('data-cnstrc-browse', '');
      grid.setAttribute('data-cnstrc-filter-name', this.getAttribute('filter-name') || 'group_id');
      grid.setAttribute('data-cnstrc-filter-value', this.getAttribute('filter-value') || '');
    } else {
      grid.setAttribute('data-cnstrc-search', '');
      grid.setAttribute('data-cnstrc-search-term', this.#query);
      if (this.#totalResults === 0) {
        grid.setAttribute('data-cnstrc-zero-result', '');
      } else {
        grid.removeAttribute('data-cnstrc-zero-result');
      }
    }
  }

  #renderGrid() {
    if (!this.refs.grid) return;
    this.refs.grid.innerHTML = this.#items.map((item) => renderCard(item)).join('');
  }

  /**
   * @param {any[]} facets
   */
  #renderFacets(facets) {
    const host = this.refs.facets;
    if (!host) return;
    if (!facets.length) {
      host.innerHTML = '';
      return;
    }

    const params = this.#params;
    host.innerHTML = facets
      .map((facet) => {
        const active = (params.get(`filters[${facet.name}]`) || '').split(',').filter(Boolean);
        const options = (facet.options || [])
          .map((option) => {
            const checked = active.includes(String(option.value)) ? 'checked' : '';
            return `
              <li class="cnstrc-facet__option">
                <label>
                  <input type="checkbox" data-facet-name="${facet.name}" value="${option.value}" ${checked}>
                  <span>${option.display_name || option.value}</span>
                  ${option.count != null ? `<span class="cnstrc-facet__count">(${option.count})</span>` : ''}
                </label>
              </li>`;
          })
          .join('');
        return `
          <div class="cnstrc-facet">
            <h3 class="cnstrc-facet__title">${facet.display_name || facet.name}</h3>
            <ul class="cnstrc-facet__options">${options}</ul>
          </div>`;
      })
      .join('');

    host.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', () => this.#onFacetChange(input));
    });
  }

  /**
   * @param {HTMLInputElement} input
   */
  #onFacetChange(input) {
    const params = this.#params;
    const key = `filters[${input.dataset.facetName}]`;
    const current = (params.get(key) || '').split(',').filter(Boolean);
    const value = input.value;

    let next;
    if (input.checked) {
      next = Array.from(new Set([...current, value]));
    } else {
      next = current.filter((v) => v !== value);
    }

    if (next.length) {
      params.set(key, next.join(','));
    } else {
      params.delete(key);
    }
    this.#pushParams(params);
  }

  /**
   * @param {any[]} sortOptions
   */
  #renderSort(sortOptions) {
    const host = this.refs.sort;
    if (!host || !sortOptions.length) return;

    const params = this.#params;
    const activeBy = params.get('sort_by') || '';
    const activeOrder = params.get('sort_order') || '';

    const options = sortOptions
      .map((option) => {
        const selected =
          option.sort_by === activeBy && option.sort_order === activeOrder ? 'selected' : '';
        return `<option value="${option.sort_by}|${option.sort_order}" ${selected}>${option.display_name}</option>`;
      })
      .join('');

    host.innerHTML = `<select data-cnstrc-sort-select><option value="">${
      window.Theme?.translations?.sort || 'Sort'
    }</option>${options}</select>`;

    const select = host.querySelector('select');
    select?.addEventListener('change', () => {
      const params = this.#params;
      const [by, order] = select.value.split('|');
      if (by) {
        params.set('sort_by', by);
        params.set('sort_order', order || '');
      } else {
        params.delete('sort_by');
        params.delete('sort_order');
      }
      this.#pushParams(params);
    });
  }

  /**
   * Pushes new query params and re-fetches from page 1.
   * @param {URLSearchParams} params
   */
  #pushParams(params) {
    const url = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({}, '', url);
    this.#fetch({ reset: true });
  }

  #updateLoadMore() {
    if (!this.refs.loadMore) return;
    const hasMore = this.#page * RESULTS_PER_PAGE < this.#totalResults;
    this.refs.loadMore.hidden = !hasMore;
    this.refs.loadMore.textContent = hasMore
      ? `Load more (${this.#items.length} / ${this.#totalResults})`
      : '';
  }

  #updateTitle() {
    if (!this.refs.title) return;
    if (this.mode === 'search') {
      this.refs.title.textContent = this.#query
        ? `Results for “${this.#query}” (${this.#totalResults})`
        : `All products (${this.#totalResults})`;
    }
  }

  /**
   * @param {'loading'|'ready'|'empty'|'error'} state
   */
  #setStatus(state) {
    this.dataset.state = state;
    if (!this.refs.status) return;
    const messages = {
      loading: 'Loading…',
      ready: '',
      empty: 'No results found.',
      error: 'Something went wrong loading results.',
    };
    this.refs.status.textContent = messages[state] || '';
  }
}

if (!customElements.get('constructor-results')) {
  customElements.define('constructor-results', ConstructorResults);
}

export default ConstructorResults;
