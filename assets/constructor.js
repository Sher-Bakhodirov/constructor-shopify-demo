/**
 * Constructor.io foundation module for the Horizon theme.
 *
 * Central place that:
 *  - reads the theme config exposed by `snippets/constructor-init.liquid`
 *    (window.ConstructorTheme.config),
 *  - lazily loads the self-hosted Constructor JavaScript client,
 *  - exposes a single shared client instance and a few helpers.
 *
 * Surface modules (autocomplete, search, browse, recommendations) import from
 * here so there is exactly one client and one config source of truth.
 *
 * The client bundle (`assets/constructorio-client.js`, importmap alias
 * `@theme/constructorio-client`) is a pinned, self-hosted ESM build of
 * @constructor-io/constructorio-client-javascript — no third-party CDN at runtime.
 * To upgrade it, re-bundle that package to ESM and replace the asset.
 *
 * Docs: https://constructor-io.github.io/constructorio-client-javascript/
 */

/** @typedef {Object} ConstructorSurfaces
 * @property {boolean} autocomplete
 * @property {boolean} search
 * @property {boolean} browse
 * @property {boolean} recommendations
 */

/** @typedef {Object} ConstructorConfig
 * @property {boolean} enabled
 * @property {string} [indexKey]
 * @property {ConstructorSurfaces} [surfaces]
 * @property {{home:string, plp:string, pdp:string, cart:string, autocomplete:string}} [pods]
 * @property {string} [itemIdSource]
 * @property {{search:string, cartAdd:string}} [routes]
 */

/** @returns {ConstructorConfig} */
export function getConfig() {
  return (window.ConstructorTheme && window.ConstructorTheme.config) || { enabled: false };
}

/**
 * @param {keyof ConstructorSurfaces} surface
 * @returns {boolean} whether Constructor is enabled AND powering this surface.
 */
export function isSurfaceEnabled(surface) {
  const config = getConfig();
  return Boolean(config.enabled && config.surfaces && config.surfaces[surface]);
}

/** @type {Promise<any> | null} */
let clientPromise = null;

/**
 * Loads the Constructor client bundle from CDN once and returns a configured
 * client instance. Subsequent calls return the same promise.
 *
 * The bundled build attaches `ConstructorioClient` to `window`.
 *
 * @returns {Promise<any>} the ConstructorIO client, or rejects if disabled.
 */
export function getClient() {
  if (clientPromise) return clientPromise;

  const config = getConfig();
  if (!config.enabled || !config.indexKey) {
    clientPromise = Promise.reject(new Error('Constructor.io is not enabled or missing an index key.'));
    return clientPromise;
  }

  clientPromise = import('@theme/constructorio-client')
    .then((module) => {
      const ConstructorIOClient = module.default || window.ConstructorioClient;
      if (!ConstructorIOClient) {
        throw new Error('Constructor client module loaded but no constructor was exported.');
      }
      const options = { apiKey: config.indexKey };
      // Carry through the logged-in user id set on window.cnstrc, if present, so
      // API requests are personalized consistently with the beacon.
      if (window.cnstrc && window.cnstrc.userId) {
        options.userId = window.cnstrc.userId;
      }
      return new ConstructorIOClient(options);
    })
    .catch((error) => {
      // Reset so a later caller can retry after a transient network failure.
      clientPromise = null;
      throw error;
    });

  return clientPromise;
}

/**
 * Best price for a Constructor result item (sale price wins).
 * @param {any} item
 * @returns {number | undefined}
 */
export function itemPrice(item) {
  const data = item && item.data ? item.data : {};
  return data.sale_price != null ? data.sale_price : data.price;
}

/**
 * Builds a storefront URL for a Constructor result item, honoring the configured
 * catalog id mapping. Item ids map to product ids by default.
 * @param {any} item
 * @returns {string}
 */
export function itemUrl(item) {
  const config = getConfig();
  const data = (item && item.data) || {};
  // Prefer an explicit url the feed may carry.
  if (data.url) return data.url;

  const id = (item && item.data && item.data.id) || item.id;
  switch (config.itemIdSource) {
    case 'handle':
      return `/products/${id}`;
    default:
      // product_id / variant_id / sku all resolve via the products route by id;
      // Shopify redirects /products/<numeric-id> appropriately.
      return `/products/${id}`;
  }
}

/**
 * Formats a numeric price using the store's active currency, falling back to a
 * plain fixed-2 string if Intl/currency is unavailable.
 * @param {number} value
 * @returns {string}
 */
export function formatPrice(value) {
  if (value == null || Number.isNaN(Number(value))) return '';
  const currency =
    (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'USD';
  try {
    return new Intl.NumberFormat(document.documentElement.lang || 'en', {
      style: 'currency',
      currency,
    }).format(value);
  } catch (error) {
    return `$${Number(value).toFixed(2)}`;
  }
}
