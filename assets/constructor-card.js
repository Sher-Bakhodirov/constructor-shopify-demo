/**
 * Shared renderer for a Constructor result card.
 *
 * Used by the Constructor-powered search, browse, and recommendations surfaces so
 * every result card looks and behaves the same and carries the correct data-driven
 * tracking attributes (`data-cnstrc-item-*`, `data-cnstrc-btn`).
 *
 * Cards are rendered from Constructor result data (demo parity): the feed supplies
 * image, title, price, url and variation_id, and add-to-cart posts that variation_id
 * to Shopify's cart as the variant id.
 */

import { itemPrice, itemUrl, formatPrice } from '@theme/constructor';
import { CartLinesUpdateEvent } from '@shopify/events';

/**
 * Escapes a value for safe insertion into HTML attributes/text.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds the HTML for a single Constructor result card.
 *
 * @param {any} item - A Constructor result item ({ value, data, strategy? }).
 * @param {{ recommendation?: string }} [options] - When `recommendation` is set,
 *   the card is marked as a recommendation result carrying that strategy id.
 * @returns {string} card HTML
 */
export function renderCard(item, options = {}) {
  const data = (item && item.data) || {};
  const id = data.id;
  const name = item.value || data.name || '';
  const variationId = data.variation_id || '';
  const price = itemPrice(item);
  const url = itemUrl(item);
  const image = data.image_url || '';
  const strategyId = options.recommendation || (item.strategy && item.strategy.id) || '';
  const isRecommendation = Boolean(strategyId);

  const recommendationAttrs = isRecommendation
    ? ` data-cnstrc-item="recommendation" data-cnstrc-strategy-id="${escapeHtml(strategyId)}"`
    : '';

  const priceHtml =
    price != null
      ? `<div class="cnstrc-card__price">${escapeHtml(formatPrice(price))}</div>`
      : '';

  return `
    <div
      class="cnstrc-card"
      data-cnstrc-item-id="${escapeHtml(id)}"
      data-cnstrc-item-name="${escapeHtml(name)}"
      data-cnstrc-item-variation-id="${escapeHtml(variationId)}"
      data-cnstrc-item-price="${escapeHtml(price)}"${recommendationAttrs}
    >
      <a class="cnstrc-card__link" href="${escapeHtml(url)}" aria-label="${escapeHtml(name)}">
        <div class="cnstrc-card__media">
          ${image ? `<img class="cnstrc-card__image" src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy">` : ''}
        </div>
        <div class="cnstrc-card__title">${escapeHtml(name)}</div>
        ${priceHtml}
      </a>
      ${
        variationId
          ? `<button
              type="button"
              class="button cnstrc-card__atc"
              data-cnstrc-btn="add_to_cart"
              data-variant-id="${escapeHtml(variationId)}"
            >${escapeHtml(window.Theme?.translations?.add_to_cart || 'Add to cart')}</button>`
          : ''
      }
    </div>
  `;
}

/**
 * Wires click-to-add-to-cart on a container of rendered cards. Delegates so it
 * survives re-renders. Safe to call multiple times on the same root (guards with a
 * data flag).
 * @param {HTMLElement} root
 */
export function bindAddToCart(root) {
  if (!root || root.dataset.cnstrcAtcBound === 'true') return;
  root.dataset.cnstrcAtcBound = 'true';

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cnstrc-btn="add_to_cart"]');
    if (!button || !root.contains(button)) return;

    const variantId = button.dataset.variantId;
    if (!variantId) return;

    event.preventDefault();
    addVariantToCart(button, variantId);
  });
}

/**
 * Adds a variant to the cart using Horizon's standard cart event flow, so the
 * cart drawer / bubble update and auto-open exactly as they do for native cards.
 * @param {HTMLElement} button
 * @param {string} variantId
 */
function addVariantToCart(button, variantId) {
  button.setAttribute('disabled', '');
  const original = button.textContent;

  // Collect the section ids the cart UI needs re-rendered (cart drawer items).
  const sectionIds = Array.from(document.querySelectorAll('[data-section-id]'))
    .map((el) => el.getAttribute('data-section-id'))
    .filter(Boolean);
  const uniqueSectionIds = Array.from(new Set(sectionIds));

  const cartAddUrl =
    window.ConstructorTheme?.config?.routes?.cartAdd ||
    `${window.Shopify?.routes?.root || '/'}cart/add.js`;

  const deferred = CartLinesUpdateEvent.createPromise();

  // Announce the add so <cart-drawer-component> can auto-open.
  document.dispatchEvent(
    new CartLinesUpdateEvent({
      action: 'add',
      context: 'product',
      lines: [{ merchandiseId: variantId, quantity: 1 }],
      promise: deferred.promise,
    })
  );

  fetch(cartAddUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      items: [{ id: Number(variantId), quantity: 1 }],
      sections: uniqueSectionIds.join(','),
    }),
  })
    .then((response) => response.json())
    .then((response) => {
      if (response.status) {
        throw new Error(response.message || 'Add to cart failed');
      }

      const added = window.Theme?.translations?.added || 'Added';
      button.textContent = `✓ ${added}`;
      setTimeout(() => {
        button.textContent = original;
        button.removeAttribute('disabled');
      }, 1500);

      // Refresh the authoritative cart so the drawer renders the new state.
      return fetch(`${window.Shopify?.routes?.root || '/'}cart.js`)
        .then((res) => res.json())
        .then((cart) => {
          deferred.resolve({
            cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
            detail: {
              items: cart.items,
              source: 'constructor-card',
              itemCount: cart.item_count,
            },
          });
        });
    })
    .catch((error) => {
      console.error('[Constructor] add to cart failed', error);
      button.textContent = original;
      button.removeAttribute('disabled');
      deferred.reject(error);
    });
}
