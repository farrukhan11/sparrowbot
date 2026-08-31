type ShippingLineInput = {
  variantId: string;
  price: string;
  quantity: number;
  label?: string;
};

type ShippingProductInfo = {
  variantId?: string;
  productUrl?: string;
  price?: string;
  quantity?: number;
  items?: ShippingLineInput[];
};

type ShippingAddress = {
  city: string;
  address1?: string;
};

export type ShippingQuoteLine = {
  variantId: string;
  label?: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
};

export type ShippingQuote = {
  unitPrice: string;
  quantity: number;
  productPrice: string;
  shippingPrice: string;
  totalPrice: string;
  shippingRateName: string;
  currency: string;
  lines?: ShippingQuoteLine[];
};

type ShopifyShippingRate = {
  name?: string;
  presentment_name?: string;
  price?: string | number;
  currency?: string | null;
};

const DEFAULT_ORIGIN = 'https://sparrowofficial.pk';

function money(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function parseMoney(value: unknown): number | null {
  const number = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function resolveStoreOrigin(productInfo: ShippingProductInfo): string {
  const configured = process.env.SHOPIFY_STORE_URL?.trim() || process.env.SHOPIFY_STORE_DOMAIN?.trim() || '';
  const candidate = configured || productInfo.productUrl || DEFAULT_ORIGIN;
  try {
    const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    const url = new URL(normalized);
    if (!/(^|\.)sparrowofficial\.pk$/i.test(url.hostname)) return DEFAULT_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
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

function normalizeCity(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function provinceForCity(cityValue: string): { province: string; code: string } | null {
  const city = normalizeCity(cityValue);

  const sindh = new Set(['karachi','hyderabad','sukkur','larkana','mirpur khas','nawabshah','shaheed benazirabad','jacobabad','shikarpur','khairpur','thatta','badin','matli','tando adam','tando allahyar','tando muhammad khan','umerkot','sanghar','dadu','sehwan','moro','naushahro feroze','kandhkot','ghotki','rohri','pano aqil']);
  const punjab = new Set(['lahore','rawalpindi','faisalabad','multan','gujranwala','sialkot','bahawalpur','sargodha','gujrat','jhelum','rahim yar khan','sheikhupura','kasur','sahiwal','okara','wah cantt','taxila','dera ghazi khan','burewala','chiniot','jhang','hafizabad','kamoke','khanewal','muzaffargarh','vehari','attock','chakwal','murree','bahawalnagar','mandi bahauddin','khushab','toba tek singh','layyah','lodhran','pakpattan','narowal','nankana sahib','wazirabad','daska','sambrial','gojra','jampur','kabirwala','mianwali','bhakkar','chishtian','haroonabad','hasilpur','ahmadpur east','kot addu','shorkot','pir mahal','arifwala','depalpur','pattoki','kharian','lala musa','dina','kallar syedan','kahuta','hasan abdal']);
  const kpk = new Set(['peshawar','abbottabad','mardan','dera ismail khan','mingora','swat','mansehra','haripur','nowshera','kohat','bannu','swabi','charsadda','dir','chitral']);
  const balochistan = new Set(['quetta','gwadar','turbat','chaman','zhob','hub','khuzdar','loralai','sibi','dera murad jamali']);
  const ajk = new Set(['muzaffarabad','mirpur','kotli','bhimber','rawalakot']);
  const gb = new Set(['gilgit','skardu','hunza','chilas']);

  if (city === 'islamabad') return { province: 'Islamabad Capital Territory', code: 'IS' };
  if (sindh.has(city)) return { province: 'Sindh', code: 'SD' };
  if (punjab.has(city)) return { province: 'Punjab', code: 'PB' };
  if (kpk.has(city)) return { province: 'Khyber Pakhtunkhwa', code: 'KP' };
  if (balochistan.has(city)) return { province: 'Balochistan', code: 'BA' };
  if (ajk.has(city)) return { province: 'Azad Kashmir', code: 'JK' };
  if (gb.has(city)) return { province: 'Gilgit-Baltistan', code: 'GB' };
  return null;
}

function buildShippingParams(address: ShippingAddress, includeAddress = true): URLSearchParams {
  const params = new URLSearchParams();
  params.set('shipping_address[country]', 'Pakistan');
  params.set('shipping_address[country_code]', 'PK');
  params.set('shipping_address[city]', address.city);

  const province = provinceForCity(address.city);
  if (province) {
    params.set('shipping_address[province]', province.province);
    params.set('shipping_address[province_code]', province.code);
  }

  if (includeAddress && address.address1) params.set('shipping_address[address1]', address.address1);
  return params;
}

async function fetchRatesOnce(origin: string, cookie: string, params: URLSearchParams): Promise<ShopifyShippingRate[]> {
  const commonHeaders: HeadersInit = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Cookie: cookie,
    Referer: `${origin}/cart`,
  };

  const prepare = await fetch(`${origin}/cart/prepare_shipping_rates.json?${params.toString()}`, {
    method: 'POST',
    headers: commonHeaders,
    cache: 'no-store',
  });

  if (prepare.ok || prepare.status === 202) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 250 * attempt));
      const asyncResponse = await fetch(`${origin}/cart/async_shipping_rates.json?${params.toString()}`, {
        headers: commonHeaders,
        cache: 'no-store',
      });
      if (asyncResponse.ok) {
        const data = await asyncResponse.json().catch(() => null);
        if (Array.isArray(data?.shipping_rates) && data.shipping_rates.length > 0) return data.shipping_rates;
      }
    }
  }

  const direct = await fetch(`${origin}/cart/shipping_rates.json?${params.toString()}`, {
    headers: commonHeaders,
    cache: 'no-store',
  });

  if (!direct.ok) return [];
  const data = await direct.json().catch(() => null);
  return Array.isArray(data?.shipping_rates) ? data.shipping_rates : [];
}

async function fetchRates(origin: string, cookie: string, address: ShippingAddress): Promise<ShopifyShippingRate[]> {
  const attempts = [buildShippingParams(address, true), buildShippingParams(address, false)];
  for (const params of attempts) {
    const rates = await fetchRatesOnce(origin, cookie, params);
    if (rates.length > 0) return rates;
  }
  return [];
}

function normalizeLines(productInfo: ShippingProductInfo): ShippingQuoteLine[] {
  const source = Array.isArray(productInfo.items) && productInfo.items.length
    ? productInfo.items
    : [{
        variantId: String(productInfo.variantId || ''),
        price: String(productInfo.price || ''),
        quantity: Number(productInfo.quantity) || 1,
      }];

  const lines: ShippingQuoteLine[] = [];
  for (const item of source.slice(0, 20)) {
    const variantId = String(item.variantId || '').replace(/\D/g, '');
    const unitPrice = parseMoney(item.price);
    const quantity = Math.max(1, Math.min(20, Math.floor(Number(item.quantity) || 1)));
    if (!variantId) throw new Error('Selected Shopify variant missing hai. Size/Color dobara select karein.');
    if (unitPrice === null) throw new Error('Live product price verify nahi ho saki.');
    lines.push({
      variantId,
      label: item.label,
      unitPrice: money(unitPrice),
      quantity,
      lineTotal: money(unitPrice * quantity),
    });
  }

  if (!lines.length) throw new Error('Order mein koi product variation nahi hai.');
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (totalQuantity > 50) throw new Error('Ek order mein maximum 50 total items allowed hain.');
  return lines;
}

export async function getShopifyShippingQuote(productInfo: ShippingProductInfo, address: ShippingAddress): Promise<ShippingQuote> {
  const lines = normalizeLines(productInfo);
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
      items: lines.map(line => ({ id: Number(line.variantId), quantity: line.quantity })),
    }),
    cache: 'no-store',
  });

  if (!addResponse.ok) {
    const body = await addResponse.text().catch(() => '');
    throw new Error(`Shopify cart selected variation accept nahi kar raha (${addResponse.status})${body ? `: ${body.slice(0, 140)}` : ''}`);
  }

  const cookie = getCookieHeader(addResponse);
  if (!cookie) throw new Error('Shopify cart session create nahi ho saki.');

  const rates = await fetchRates(origin, cookie, address);
  const normalized = rates
    .map(rate => ({ ...rate, numericPrice: parseMoney(rate.price) }))
    .filter(rate => rate.numericPrice !== null)
    .sort((a, b) => (a.numericPrice as number) - (b.numericPrice as number));

  const selected = normalized[0];
  if (!selected || selected.numericPrice === null) {
    throw new Error('Shopify ne is address ke liye shipping rate return nahi ki. Ye city validation error nahi hai.');
  }

  const subtotal = lines.reduce((sum, line) => sum + Number(line.lineTotal), 0);
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const shippingPrice = selected.numericPrice;

  return {
    unitPrice: lines.length === 1 ? lines[0].unitPrice : '',
    quantity: totalQuantity,
    productPrice: money(subtotal),
    shippingPrice: money(shippingPrice),
    totalPrice: money(subtotal + shippingPrice),
    shippingRateName: selected.presentment_name || selected.name || (shippingPrice === 0 ? 'Free Shipping' : 'Shipping'),
    currency: selected.currency || 'PKR',
    lines,
  };
}
