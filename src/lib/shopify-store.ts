type RawShopifyVariant = {
  id?: string | number;
  title?: string;
  available?: boolean;
  price?: string | number;
  compare_at_price?: string | number | null;
  sku?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
};

type RawShopifyProduct = {
  id?: string | number;
  title?: string;
  handle?: string;
  description?: string;
  vendor?: string;
  type?: string;
  tags?: string[] | string;
  available?: boolean;
  featured_image?: string | null;
  images?: string[];
  options?: Array<string | { name?: string; values?: string[] }>;
  variants?: RawShopifyVariant[];
};

export type StoreProductOption = {
  name: string;
  values: string[];
};

export type StoreProductVariant = {
  id: string;
  title: string;
  options: string[];
  available: boolean;
  price: string;
  compareAtPrice: string | null;
  sku: string | null;
};

export type StoreProduct = {
  id: string;
  title: string;
  handle: string;
  description: string;
  vendor: string;
  productType: string;
  tags: string[];
  available: boolean;
  image: string | null;
  productUrl: string;
  options: StoreProductOption[];
  variants: StoreProductVariant[];
};

export type ProductSuggestion = {
  title: string;
  handle: string;
  productUrl: string;
  image: string | null;
  price: string | null;
  available: boolean | null;
};

export type StoreKnowledge = {
  currentProduct: StoreProduct | null;
  suggestions: ProductSuggestion[];
  policyText: string;
  contextText: string;
};

const DEFAULT_STORE_ORIGIN = 'https://sparrowofficial.pk';

function cleanText(value: unknown, max = 6000): string {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function moneyFromCents(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const amount = number / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function safeOrigin(productUrl?: string): string {
  const configured = process.env.SHOPIFY_STORE_URL?.trim() || process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const candidate = configured || productUrl || DEFAULT_STORE_ORIGIN;
  try {
    const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    const url = new URL(normalized);
    if (!/(^|\.)sparrowofficial\.pk$/i.test(url.hostname)) return DEFAULT_STORE_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_STORE_ORIGIN;
  }
}

function normalizeHandle(handle?: string, productUrl?: string): string {
  if (handle) return String(handle).trim().replace(/^\/+|\/+$/g, '');
  if (!productUrl) return '';
  try {
    const path = new URL(productUrl).pathname;
    const match = path.match(/\/products\/([^/?#]+)/i);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function normalizeProduct(raw: RawShopifyProduct, origin: string): StoreProduct | null {
  const handle = String(raw.handle || '').trim();
  const title = cleanText(raw.title, 240);
  if (!handle || !title) return null;

  const optionNames: string[] = [];
  if (Array.isArray(raw.options)) {
    for (const option of raw.options) {
      if (typeof option === 'string') optionNames.push(option);
      else if (option?.name) optionNames.push(String(option.name));
    }
  }

  const rawVariants = Array.isArray(raw.variants) ? raw.variants : [];
  const variants: StoreProductVariant[] = rawVariants.map(variant => {
    const options = [variant.option1, variant.option2, variant.option3]
      .slice(0, Math.max(optionNames.length, 1))
      .map(value => String(value || ''));

    return {
      id: String(variant.id || ''),
      title: cleanText(variant.title, 180),
      options,
      available: Boolean(variant.available),
      price: moneyFromCents(variant.price),
      compareAtPrice: variant.compare_at_price == null ? null : moneyFromCents(variant.compare_at_price),
      sku: variant.sku ? String(variant.sku) : null,
    };
  }).filter(variant => variant.id);

  const options: StoreProductOption[] = optionNames
    .map((name, index) => ({
      name,
      values: Array.from(new Set(variants.map(variant => variant.options[index]).filter(Boolean))),
    }))
    .filter(option => option.name.toLowerCase() !== 'title' && !(option.values.length === 1 && option.values[0].toLowerCase() === 'default title'));

  const rawTags = Array.isArray(raw.tags)
    ? raw.tags
    : String(raw.tags || '').split(',');

  return {
    id: String(raw.id || ''),
    title,
    handle,
    description: cleanText(raw.description, 7000),
    vendor: cleanText(raw.vendor, 120),
    productType: cleanText(raw.type, 120),
    tags: rawTags.map(tag => cleanText(tag, 80)).filter(Boolean).slice(0, 30),
    available: typeof raw.available === 'boolean' ? raw.available : variants.some(variant => variant.available),
    image: raw.featured_image ? String(raw.featured_image) : Array.isArray(raw.images) && raw.images[0] ? String(raw.images[0]) : null,
    productUrl: `${origin}/products/${handle}`,
    options,
    variants,
  };
}

export async function getStoreProduct(input: {
  handle?: string;
  productUrl?: string;
}): Promise<StoreProduct | null> {
  const origin = safeOrigin(input.productUrl);
  const handle = normalizeHandle(input.handle, input.productUrl);
  if (!handle) return null;

  try {
    const response = await fetch(`${origin}/products/${encodeURIComponent(handle)}.js`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const raw = await response.json() as RawShopifyProduct;
    return normalizeProduct(raw, origin);
  } catch (error) {
    console.error('Shopify product lookup failed:', error);
    return null;
  }
}

function compactSearchQuery(message: string): string {
  return cleanText(message, 180)
    .replace(/\b(mujhe|mujhay|show|dikhao|dikhaye|search|find|another|other|aur|koi|product|item|chahiye|chaheye|please|pls)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function searchStoreProducts(message: string, productUrl?: string): Promise<ProductSuggestion[]> {
  const query = compactSearchQuery(message);
  if (query.length < 2) return [];
  const origin = safeOrigin(productUrl);

  try {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('resources[type]', 'product');
    params.set('resources[limit]', '5');
    params.set('resources[options][unavailable_products]', 'last');

    const response = await fetch(`${origin}/search/suggest.json?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const data = await response.json();
    const products = data?.resources?.results?.products;
    if (!Array.isArray(products)) return [];

    return products.slice(0, 5).map((product: any) => {
      const url = String(product?.url || '');
      const handle = url.match(/\/products\/([^/?#]+)/i)?.[1] || String(product?.handle || '');
      const price = product?.price == null ? null : cleanText(product.price, 40).replace(/[^0-9.,]/g, '');
      return {
        title: cleanText(product?.title, 220),
        handle,
        productUrl: url.startsWith('http') ? url : `${origin}${url}`,
        image: product?.featured_image?.url || product?.image || null,
        price,
        available: typeof product?.available === 'boolean' ? product.available : null,
      };
    }).filter((product: ProductSuggestion) => product.title && product.handle);
  } catch (error) {
    console.error('Shopify product search failed:', error);
    return [];
  }
}

const POLICY_ROUTES: Array<{ keywords: RegExp; path: string; label: string }> = [
  { keywords: /\b(exchange|return|refund|wapas|change)\b/i, path: '/policies/refund-policy', label: 'Return/Refund policy' },
  { keywords: /\b(delivery|shipping|courier|ship|charges|fee)\b/i, path: '/policies/shipping-policy', label: 'Shipping policy' },
  { keywords: /\b(privacy|data)\b/i, path: '/policies/privacy-policy', label: 'Privacy policy' },
  { keywords: /\b(terms|condition)\b/i, path: '/policies/terms-of-service', label: 'Terms of service' },
];

async function fetchRelevantPolicies(message: string, productUrl?: string): Promise<string> {
  const origin = safeOrigin(productUrl);
  const relevant = POLICY_ROUTES.filter(policy => policy.keywords.test(message)).slice(0, 2);
  if (relevant.length === 0) return '';

  const sections = await Promise.all(relevant.map(async policy => {
    try {
      const response = await fetch(`${origin}${policy.path}`, { cache: 'no-store' });
      if (!response.ok) return '';
      const html = await response.text();
      const text = cleanText(html, 3500);
      return text ? `${policy.label}: ${text}` : '';
    } catch {
      return '';
    }
  }));

  return sections.filter(Boolean).join('\n');
}

function shouldSearchOtherProducts(message: string): boolean {
  return /\b(other|another|aur|doosra|dusra|search|find|dikhao|show|available products?|collection|dress|shirt|suit|bag|kids|girls|boys|men|women)\b/i.test(message)
    && !/^\s*(delivery|shipping|exchange|return|refund)\s*\??\s*$/i.test(message);
}

export async function getStoreKnowledge(message: string, productInfo: any): Promise<StoreKnowledge> {
  const [currentProduct, policyText] = await Promise.all([
    getStoreProduct({ handle: productInfo?.productHandle, productUrl: productInfo?.productUrl }),
    fetchRelevantPolicies(message, productInfo?.productUrl),
  ]);

  const suggestions = shouldSearchOtherProducts(message)
    ? await searchStoreProducts(message, productInfo?.productUrl)
    : [];

  const currentContext = currentProduct
    ? [
        `LIVE CURRENT PRODUCT: ${currentProduct.title}`,
        `Available: ${currentProduct.available ? 'yes' : 'no'}`,
        currentProduct.vendor ? `Vendor: ${currentProduct.vendor}` : '',
        currentProduct.productType ? `Type: ${currentProduct.productType}` : '',
        currentProduct.description ? `Description: ${currentProduct.description}` : '',
        currentProduct.tags.length ? `Tags: ${currentProduct.tags.join(', ')}` : '',
        currentProduct.options.length
          ? `Options: ${currentProduct.options.map(option => `${option.name}=[${option.values.join(', ')}]`).join('; ')}`
          : '',
        currentProduct.variants.length
          ? `Variants: ${currentProduct.variants.slice(0, 80).map(variant => `${variant.options.join(' / ')} | Rs.${variant.price} | ${variant.available ? 'in stock' : 'out of stock'}`).join('; ')}`
          : '',
      ].filter(Boolean).join('\n')
    : '';

  const suggestionContext = suggestions.length
    ? `STORE SEARCH RESULTS:\n${suggestions.map((product, index) => `${index + 1}. ${product.title}${product.price ? ` | ${product.price}` : ''} | ${product.productUrl}`).join('\n')}`
    : '';

  return {
    currentProduct,
    suggestions,
    policyText,
    contextText: [currentContext, policyText, suggestionContext].filter(Boolean).join('\n\n').slice(0, 14000),
  };
}

export async function resolveLiveVariant(productInfo: any, quantity = 1): Promise<{
  product: StoreProduct;
  variant: StoreProductVariant;
  quantity: number;
}> {
  const product = await getStoreProduct({ handle: productInfo?.productHandle, productUrl: productInfo?.productUrl });
  if (!product) throw new Error('Live Shopify product verify nahi ho saka. Product page se dobara order start karein.');

  const selectedId = String(productInfo?.variantId || '').replace(/\D/g, '');
  let variant = selectedId ? product.variants.find(item => item.id === selectedId) : undefined;

  if (!variant && Array.isArray(productInfo?.selectedOptions) && productInfo.selectedOptions.length > 0) {
    const selected = productInfo.selectedOptions.map((option: any) => String(option?.value || ''));
    variant = product.variants.find(item => item.options.every((value, index) => value === selected[index]));
  }

  if (!variant) throw new Error('Selected Size/Color ka live Shopify variant nahi mila. Options dobara select karein.');
  if (!variant.available) throw new Error('Selected variation ab out of stock hai. Doosra available option select karein.');

  const safeQuantity = Math.max(1, Math.min(20, Math.floor(Number(quantity) || 1)));
  return { product, variant, quantity: safeQuantity };
}
