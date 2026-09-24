/**
 * <constructor-autocomplete> — Constructor-powered predictive search.
 *
 * Wraps a search form and renders an autosuggest dropdown from Constructor's
 * autocomplete API (Search Suggestions + Products sections), plus a zero-state
 * of trending products from a recommendations pod when the input is empty.
 *
 * Data-driven tracking attributes:
 *   - form:        data-cnstrc-search-form
 *   - input:       data-cnstrc-search-input
 *   - submit btn:  data-cnstrc-search-submit-btn
 *   - dropdown:    data-cnstrc-autosuggest (query state) OR
 *                  data-cnstrc-recommendations (+ pod id/result id) for zero state
 *   - items:       data-cnstrc-item-name / -item-id / -item-section
 *
 * When Constructor autocomplete is disabled the element is inert and the host
 * markup keeps working as native Shopify predictive search.
 */

import { getClient, getConfig, isSurfaceEnabled, itemPrice, formatPrice } from '@theme/constructor';

const DEBOUNCE_MS = 200;

class ConstructorAutocomplete extends HTMLElement {
  #debounce = null;
  #zeroStateFetched = false;
  #zeroStateProducts = [];
  #zeroStateMeta = { podId: null, resultId: null, numResults: 0 };
  #open = false;

  connectedCallback() {
    if (!isSurfaceEnabled('autocomplete')) return;

    this.input = this.querySelector('[data-cnstrc-search-input]');
    this.form = this.querySelector('[data-cnstrc-search-form]');
    this.dropdown = this.querySelector('[data-cnstrc-dropdown]');

    if (!this.input || !this.form || !this.dropdown) return;

    this.input.addEventListener('input', this.#onInput);
    this.input.addEventListener('focus', this.#onFocus);
    this.form.addEventListener('submit', this.#onSubmit);
    document.addEventListener('click', this.#onDocumentClick);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this.#onDocumentClick);
    if (this.#debounce) clearTimeout(this.#debounce);
  }

  #onInput = (event) => {
    const value = event.target.value;
    if (this.#debounce) clearTimeout(this.#debounce);

    if (!value.trim()) {
      this.#renderZeroState();
      return;
    }
    this.#debounce = setTimeout(() => this.#fetchAutocomplete(value), DEBOUNCE_MS);
  };

  #onFocus = () => {
    if (!this.input.value.trim()) {
      this.#renderZeroState();
    } else {
      this.#show();
    }
  };

  #onSubmit = (event) => {
    // Let the query submit navigate to the native search results URL, which the
    // Constructor search surface then powers.
    const value = this.input.value.trim();
    if (!value) {
      event.preventDefault();
    }
    // otherwise allow default GET to routes.search_url?q=...
  };

  #onDocumentClick = (event) => {
    if (this.#open && !this.contains(event.target)) this.#hide();
  };

  async #fetchAutocomplete(query) {
    try {
      const client = await getClient();
      const response = await client.autocomplete.getAutocompleteResults(query, {
        resultsPerSection: { Products: 6, 'Search Suggestions': 8 },
      });
      const suggestions = response?.sections?.['Search Suggestions'] || [];
      const products = response?.sections?.Products || [];
      this.#renderResults({ query, suggestions, products });
    } catch (error) {
      console.error('[Constructor] autocomplete failed', error);
    }
  }

  async #renderZeroState() {
    const config = getConfig();
    const podId = config.pods && config.pods.autocomplete;
    if (!podId) {
      // No zero-state pod configured; just show nothing but keep dropdown closed.
      this.#hide();
      return;
    }

    if (!this.#zeroStateFetched) {
      try {
        const client = await getClient();
        const response = await client.recommendations.getRecommendations(podId, { numResults: 6 });
        this.#zeroStateProducts = response?.response?.results || [];
        this.#zeroStateMeta = {
          podId: response?.response?.pod?.id || podId,
          resultId: response?.result_id || '',
          numResults: response?.response?.total_num_results || this.#zeroStateProducts.length,
        };
        this.#zeroStateFetched = true;
      } catch (error) {
        console.error('[Constructor] zero-state recommendations failed', error);
        return;
      }
    }

    if (!this.#zeroStateProducts.length) {
      this.#hide();
      return;
    }

    const productsHtml = this.#zeroStateProducts
      .map((item) => this.#productRow(item, { zeroState: true }))
      .join('');

    this.dropdown.innerHTML = `
      <div
        class="cnstrc-ac__section"
        data-cnstrc-recommendations
        data-cnstrc-recommendations-pod-id="${this.#zeroStateMeta.podId}"
        data-cnstrc-result-id="${this.#zeroStateMeta.resultId}"
        data-cnstrc-num-results="${this.#zeroStateMeta.numResults}"
      >
        <h3 class="cnstrc-ac__heading">Trending products</h3>
        <ul class="cnstrc-ac__products">${productsHtml}</ul>
      </div>`;
    // Zero state is a recommendations container, so it must NOT carry the
    // autosuggest attribute.
    this.dropdown.removeAttribute('data-cnstrc-autosuggest');
    this.#show();
  }

  #renderResults({ query, suggestions, products }) {
    if (!suggestions.length && !products.length) {
      this.dropdown.innerHTML = `<div class="cnstrc-ac__empty">No results for “${escapeHtml(query)}”.</div>`;
      this.dropdown.setAttribute('data-cnstrc-autosuggest', '');
      this.#show();
      return;
    }

    const suggestionsHtml = suggestions
      .map(
        (item) => `
          <li class="cnstrc-ac__suggestion" data-cnstrc-item-name="${escapeHtml(item.value)}" data-cnstrc-item-section="Search Suggestions">
            <a href="${searchUrl(item.value)}">${escapeHtml(item.value)}</a>
          </li>`
      )
      .join('');

    const productsHtml = products.map((item) => this.#productRow(item, { zeroState: false })).join('');

    this.dropdown.innerHTML = `
      <div class="cnstrc-ac__grid">
        ${
          suggestions.length
            ? `<div class="cnstrc-ac__section cnstrc-ac__section--suggestions">
                 <h3 class="cnstrc-ac__heading">Suggestions</h3>
                 <ul class="cnstrc-ac__suggestions">${suggestionsHtml}</ul>
               </div>`
            : ''
        }
        ${
          products.length
            ? `<div class="cnstrc-ac__section cnstrc-ac__section--products">
                 <h3 class="cnstrc-ac__heading">Products</h3>
                 <ul class="cnstrc-ac__products">${productsHtml}</ul>
               </div>`
            : ''
        }
      </div>`;
    this.dropdown.setAttribute('data-cnstrc-autosuggest', '');
    this.#show();
  }

  /**
   * @param {any} item
   * @param {{zeroState: boolean}} options
   */
  #productRow(item, options) {
    const data = item.data || {};
    const price = itemPrice(item);
    const url = data.url || `/products/${data.id}`;
    const recAttrs = options.zeroState
      ? ` data-cnstrc-item="recommendation" data-cnstrc-strategy-id="${escapeHtml(item.strategy?.id || '')}" data-cnstrc-item-variation-id="${escapeHtml(data.variation_id || '')}" data-cnstrc-item-price="${escapeHtml(price)}"`
      : '';
    return `
      <li
        class="cnstrc-ac__product"
        data-cnstrc-item-name="${escapeHtml(item.value)}"
        data-cnstrc-item-id="${escapeHtml(data.id)}"
        data-cnstrc-item-section="Products"${recAttrs}
      >
        <a href="${escapeHtml(url)}">
          ${data.image_url ? `<img src="${escapeHtml(data.image_url)}" alt="${escapeHtml(item.value)}" loading="lazy">` : ''}
          <span class="cnstrc-ac__product-title">${escapeHtml(item.value)}</span>
          ${price != null ? `<span class="cnstrc-ac__product-price">${escapeHtml(formatPrice(price))}</span>` : ''}
        </a>
      </li>`;
  }

  #show() {
    this.dropdown.hidden = false;
    this.#open = true;
  }

  #hide() {
    this.dropdown.hidden = true;
    this.#open = false;
  }
}

/**
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
 * @param {string} term
 * @returns {string} the store search URL for a term.
 */
function searchUrl(term) {
  const base = window.ConstructorTheme?.config?.routes?.search || '/search';
  return `${base}?q=${encodeURIComponent(term)}`;
}

if (!customElements.get('constructor-autocomplete')) {
  customElements.define('constructor-autocomplete', ConstructorAutocomplete);
}

export default ConstructorAutocomplete;
