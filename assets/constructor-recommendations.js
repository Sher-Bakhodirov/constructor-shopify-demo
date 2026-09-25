/**
 * Mounts Constructor's Recommendations UI library (bundled build) into
 * `[data-cnstrc-recommendations-mount]` containers rendered by
 * `blocks/constructor-recommendations.liquid`.
 *
 * The library (`assets/constructorio-ui-recommendations-bundled.js`, importmap alias
 * `@theme/constructorio-ui-recommendations`) is a pinned, self-hosted copy of
 * @constructor-io/constructorio-ui-recommendations/constructorio-ui-recommendations-bundled.
 * It fetches the pod, renders the pod header + product carousel, and emits the
 * data-driven tracking attributes (data-cnstrc-recommendations, pod id, result id,
 * seed items, item ids/names/prices) that the autotrack beacon reads.
 *
 * This module supplies the theme wiring:
 *   - pod id, seed item (current product) and result count from the block
 *   - navigation on card click (the library's cards are not links)
 *
 * To upgrade the library, copy `dist/constructorio-ui-recommendations-bundled.js`
 * from the new npm version over the asset.
 *
 * Docs: https://constructor-io.github.io/constructorio-ui-recommendations/
 */

import CioRecommendations from '@theme/constructorio-ui-recommendations';
import { getConfig, isSurfaceEnabled } from '@theme/constructor';

const SELECTOR = '[data-cnstrc-recommendations-mount]';

/**
 * Storefront URL for a recommended item: feed url if present, else /products/<id>.
 * @param {{ id?: string, url?: string }} product
 */
function productUrl(product) {
  if (product.url) return product.url;
  const root = window.Shopify?.routes?.root || '/';
  return `${root}products/${encodeURIComponent(product.id || '')}`.replace(/\/+/g, '/');
}

/** @param {HTMLElement} container */
function mount(container) {
  if (container.dataset.cnstrcMounted === 'true') return;
  if (!isSurfaceEnabled('recommendations')) return;

  const config = getConfig();
  const podId = container.dataset.podId || '';
  if (!config.indexKey || !podId) return;

  if (!container.id) container.id = `cio-recs-${Math.random().toString(36).slice(2)}`;
  container.dataset.cnstrcMounted = 'true';

  /** @type {Record<string, any>} */
  const parameters = {};
  const numResults = Number(container.dataset.numResults);
  if (numResults) parameters.numResults = numResults;
  if (container.dataset.itemId) parameters.itemIds = container.dataset.itemId;

  /** @type {Record<string, any>} */
  const cioClientOptions = {};
  if (window.cnstrc?.userId) cioClientOptions.userId = window.cnstrc.userId;

  CioRecommendations({
    selector: `#${CSS.escape(container.id)}`,
    includeCSS: true,
    apiKey: config.indexKey,
    podId,
    podSubheader: container.dataset.subheading || undefined,
    parameters,
    cioClientOptions,
    callbacks: {
      /** @param {CustomEvent<{ product: any }>} event */
      onProductClick(event) {
        window.location.href = productUrl(event.detail.product);
      },
    },
  });
}

document.querySelectorAll(SELECTOR).forEach((el) => mount(/** @type {HTMLElement} */ (el)));
