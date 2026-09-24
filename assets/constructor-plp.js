/**
 * Mounts Constructor's PLP UI library (bundled build) on search & collection pages.
 *
 * The library (`assets/constructorio-ui-plp-bundled.js`, importmap alias
 * `@theme/constructorio-ui-plp`) is a pinned, self-hosted copy of
 * @constructor-io/constructorio-ui-plp/constructorio-ui-plp-bundled. It renders
 * the full PLP — facets, groups, sort, pagination, product cards — fetches
 * results and emits Constructor's data-driven tracking attributes itself.
 *
 * This module only supplies theme-specific wiring on top of `useShopifyDefaults`:
 *   - page context (search query / collection group_id) via staticRequestConfigs
 *   - Horizon cart drawer integration for add-to-cart
 *   - store currency formatting and translations
 *   - Shopify-friendly URLs (/collections/<handle>?filters[...]) for browse state;
 *     filter / sort / page changes navigate to the new URL, as the library's own
 *     default setUrl does
 *
 * To upgrade the library, copy `dist/constructorio-ui-plp-bundled.js` from the new
 * npm version over the asset.
 *
 * Docs: https://constructor-io.github.io/constructorio-ui-plp/
 */

import CioPlp from '@theme/constructorio-ui-plp';
import { getConfig, isSurfaceEnabled, formatPrice } from '@theme/constructor';
import { addVariantToCart } from '@theme/constructor-card';

const SELECTOR = '[data-cnstrc-plp]';

/**
 * The library derives browse state from the last path segment (`/group_id/<id>`).
 * Shopify collection URLs are `/collections/<handle>`, so we read/write state from
 * the query string and leave the path alone; the page context comes from
 * staticRequestConfigs instead.
 *
 * @param {'search' | 'browse'} mode
 */
function createUrlHelpers(mode) {
  /** Library query-string keys (kept identical to its defaultQueryStringMap). */
  const keys = {
    query: 'q',
    page: 'page',
    resultsPerPage: 'numResults',
    sortBy: 'sortBy',
    sortOrder: 'sortOrder',
    section: 'section',
  };

  return {
    /** @param {string} url */
    getStateFromUrl(url) {
      const params = new URL(url).searchParams;
      /** @type {Record<string, any>} */
      const state = {};

      for (const [key, param] of Object.entries(keys)) {
        const value = params.get(param);
        if (value == null || value === '') continue;
        state[key] = key === 'page' || key === 'resultsPerPage' ? Number(value) : value;
      }
      // Only search pages carry a query; a stray ?q= must not flip a collection into search.
      if (mode !== 'search') delete state.query;

      /** @type {Record<string, string[]>} */
      const filters = {};
      for (const [key, value] of params) {
        const match = key.match(/^filters\[(.+)\]$/);
        if (match) (filters[match[1]] ||= []).push(value);
      }
      if (Object.keys(filters).length) state.filters = filters;

      return state;
    },

    /**
     * @param {Record<string, any>} state
     * @param {string} url
     */
    getUrlFromState(state, url) {
      const current = new URL(url);
      const params = new URLSearchParams();

      // Preserve non-PLP params (e.g. Shopify preview / tracking params).
      for (const [key, value] of current.searchParams) {
        if (!key.startsWith('filters[') && !Object.values(keys).includes(key)) params.append(key, value);
      }

      for (const [key, param] of Object.entries(keys)) {
        const value = state[key];
        if (value == null || value === '') continue;
        if (key === 'query' && mode !== 'search') continue;
        if (key === 'page' && Number(value) === 1) continue;
        params.set(param, String(value));
      }

      for (const [name, values] of Object.entries(state.filters || {})) {
        (Array.isArray(values) ? values : [values]).forEach((value) => params.append(`filters[${name}]`, String(value)));
      }

      const query = params.toString();
      return `${current.origin}${current.pathname}${query ? `?${query}` : ''}`;
    },

    /** @param {string} url */
    setUrl(url) {
      const target = new URL(url, window.location.origin);
      const collectionsRoot = window.Shopify?.routes?.root ? `${window.Shopify.routes.root}collections` : '/collections';

      // Group links (sub-categories) are emitted as /group_id/<id> — map to the collection.
      const groupMatch = target.pathname.match(/\/group_id\/([^/]+)$/);
      if (groupMatch) {
        window.location.href = `${collectionsRoot.replace(/\/+/g, '/')}/${groupMatch[1]}${target.search}`;
        return;
      }

      // The library fetches once on mount and re-renders from the URL, so (like its
      // default setUrl) state changes are full navigations to the new URL.
      window.location.href = target.href;
    },
  };
}

/** Maps library UI strings to the theme's locale (falls back to English). */
function translations() {
  const t = window.ConstructorTheme?.plpTranslations || {};
  /** @type {Record<string, string>} */
  const result = {};
  for (const [key, value] of Object.entries(t)) {
    if (value) result[key] = value;
  }
  return result;
}

/** @param {HTMLElement} container */
function mount(container) {
  if (container.dataset.cnstrcMounted === 'true') return;

  const mode = container.dataset.mode === 'browse' ? 'browse' : 'search';
  if (!isSurfaceEnabled(mode)) return;

  const config = getConfig();
  if (!config.indexKey) return;

  if (!container.id) container.id = `cio-plp-${Math.random().toString(36).slice(2)}`;
  container.dataset.cnstrcMounted = 'true';

  /** @type {Record<string, any>} */
  const staticRequestConfigs = {};
  const perPage = Number(container.dataset.resultsPerPage);
  if (perPage) staticRequestConfigs.resultsPerPage = perPage;

  if (mode === 'browse') {
    staticRequestConfigs.filterName = container.dataset.filterName || 'group_id';
    staticRequestConfigs.filterValue = container.dataset.filterValue || '';
  } else {
    // Search: the library reads `q` from the URL; seed it so an empty ?q= still renders.
    staticRequestConfigs.query = new URLSearchParams(window.location.search).get('q') || '';
  }

  /** @type {Record<string, any>} */
  const cioClientOptions = {};
  if (window.cnstrc?.userId) cioClientOptions.userId = window.cnstrc.userId;

  CioPlp({
    selector: `#${CSS.escape(container.id)}`,
    apiKey: config.indexKey,
    useShopifyDefaults: true,
    includeCSS: true,
    cioClientOptions,
    staticRequestConfigs,
    urlHelpers: createUrlHelpers(mode),
    formatters: {
      /** @param {number} [price] */
      formatPrice: (price) => (price == null ? '' : formatPrice(price)),
    },
    translations: translations(),
    callbacks: {
      /**
       * Shopify default posts to /cart/add.js only; route through Horizon's cart
       * flow instead so the drawer / bubble update and auto-open.
       * @param {MouseEvent} _event
       * @param {any} item
       * @param {any} [selectedVariation]
       */
      onAddToCart(_event, item, selectedVariation) {
        const variantId =
          item.data?.__shopify_id || selectedVariation?.variationId || item.variationId || item.itemId;
        // The card's button is owned by React, so give the helper a detached stand-in
        // for its label/disabled feedback; the opening cart drawer is the confirmation.
        if (variantId) addVariantToCart(document.createElement('button'), String(variantId));
      },
      /**
       * Let the card's anchor navigate (keeps cmd/ctrl-click, middle-click working);
       * only fall back to /products/<id> when the feed has no url.
       * @param {MouseEvent} event
       * @param {any} item
       */
      onProductCardClick(event, item) {
        if (item.url) return;
        event.preventDefault();
        window.location.href = `${window.Shopify?.routes?.root || '/'}products/${item.itemId}`.replace(/\/+/g, '/');
      },
      /** @param {string} url */
      onRedirect(url) {
        window.location.assign(url);
      },
    },
  });
}

document.querySelectorAll(SELECTOR).forEach((el) => mount(/** @type {HTMLElement} */ (el)));
