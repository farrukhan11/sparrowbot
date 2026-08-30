type ShippingProductInfo = {
  variantId?: string;
  productUrl?: string;
  price?: string;
};

type ShippingAddress = {
  city: string;
  address1?: string;
};

export type ShippingQuote = {
  productPrice: string;
  shippingPrice: string;
  totalPrice: string;
  shippingRateName: string;
  currency: string;
};

type ShopifyShippingRate = {
  name?: string;
  presentment_name?: string;
  price?: string | number;
  currency?: string | null;
};

function money(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function parseMoney(value: unknown): number | null {
  const number = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function resolveStoreOrigin(productInfo: ShippingProductInfo): string {
  const configured =
    process.env.SHOPIFY_STORE_URL?.trim() ||
    process.env.SHOPIFY_STORE_DOMAIN?.trim() ||
    '';

  if (configured) {
    const normalized = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
    try {
      return new URL(normalized).origin;
    } catch {
      // Fall through to the product URL/default store.
    }
  }

  if (productInfo.productUrl) {
    try {
      return new URL(productInfo.productUrl).origin;
    } catch {
      // Fall through to the known storefront.
    }
  }

  return 'https://sparrowofficial.pk';
}

function getCookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const rawCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];

  return rawCookies
    .filter(Boolean)
    .map(cookie => cookie.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}

function buildShippingParams(address: ShippingAddress): URLSearchParams {
  const params = new URLSearchParams();
  params.set('shipping_address[country]', 'Pakistan');
  params.set('shipping_address[country_code]', 'PK');
  params.set('shipping_address[city]', address.city);
  if (address.address1) params.set('shipping_address[address1]', address.address1);
  return params;
}

async function fetchRates(
  origin: string,
  cookie: string,
  address: ShippingAddress
): Promise<ShopifyShippingRate[]> {
  const params = buildShippingParams(address);
  const commonHeaders: HeadersInit = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Cookie: cookie,
    Referer: `${origin}/cart`,
  };

  const prepare = await fetch(
    `${origin}/cart/prepare_shipping_rates.json?${params.toString()}`,
    {
      method: 'POST',
      headers: commonHeaders,
      cache: 'no-store',
    }
  );

  if (prepare.ok || prepare.status === 202) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 250 * attempt));

      const asyncResponse = await fetch(
        `${origin}/cart/async_shipping_rates.json?${params.toString()}`,
        { headers: commonHeaders, cache: 'no-store' }
      );

      if (asyncResponse.ok) {
        const data = await asyncResponse.json().catch(() => null);
        if (Array.isArray(data?.shipping_rates)) return data.shipping_rates;
      }
    }
  }

  // Shopify also exposes a synchronous estimator. Keep it as a fallback for
  // stores where asynchronous rate preparation is unavailable.
  const direct = await fetch(
    `${origin}/cart/shipping_rates.json?${params.toString()}`,
    { headers: commonHeaders, cache: 'no-store' }
  );

  if (!direct.ok) {
    const body = await direct.text().catch(() => '');
    throw new Error(`Shopify shipping lookup failed (${direct.status})${body ? `: ${body.slice(0, 180)}` : ''}`);
  }

  const data = await direct.json().catch(() => null);
  return Array.isArray(data?.shipping_rates) ? data.shipping_rates : [];
}

export async function getShopifyShippingQuote(
  productInfo: ShippingProductInfo,
  address: ShippingAddress
): Promise<ShippingQuote> {
  const variantId = String(productInfo.variantId || '').replace(/\D/g, '');
  const productPrice = parseMoney(productInfo.price);

  if (!variantId) {
    throw new Error('Selected Shopify variant is missing. Please select the product options again.');
  }
  if (productPrice === null) {
    throw new Error('Product price is missing or invalid.');
  }

  const origin = resolveStoreOrigin(productInfo);
  const addResponse = await fetch(`${origin}/cart/add.js`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: productInfo.productUrl || origin,
    },
    body: JSON.stringify({
      items: [{ id: Number(variantId), quantity: 1 }],
    }),
    cache: 'no-store',
  });

  if (!addResponse.ok) {
    const body = await addResponse.text().catch(() => '');
    throw new Error(`Selected product could not be added to Shopify cart (${addResponse.status})${body ? `: ${body.slice(0, 180)}` : ''}`);
  }

  const cookie = getCookieHeader(addResponse);
  if (!cookie) {
    throw new Error('Shopify cart session could not be created for shipping calculation.');
  }

  const rates = await fetchRates(origin, cookie, address);
  const normalized = rates
    .map(rate => ({
      ...rate,
      numericPrice: parseMoney(rate.price),
    }))
    .filter(rate => rate.numericPrice !== null)
    .sort((a, b) => (a.numericPrice as number) - (b.numericPrice as number));

  const selected = normalized[0];
  if (!selected || selected.numericPrice === null) {
    throw new Error('Shopify did not return a shipping rate for this delivery city/address.');
  }

  const shippingPrice = selected.numericPrice;
  return {
    productPrice: money(productPrice),
    shippingPrice: money(shippingPrice),
    totalPrice: money(productPrice + shippingPrice),
    shippingRateName: selected.presentment_name || selected.name || (shippingPrice === 0 ? 'Free Shipping' : 'Shipping'),
    currency: selected.currency || 'PKR',
  };
}
