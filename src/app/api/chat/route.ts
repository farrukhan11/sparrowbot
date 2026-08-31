import { NextRequest, NextResponse } from 'next/server';
import { db, type CartItemRecord } from '@/lib/db';
import { callAI, type AIMessage } from '@/lib/ai';
import { sendOrderWhatsAppNotifications } from '@/lib/whatsapp';
import { getShopifyShippingQuote, type ShippingQuote } from '@/lib/shopify-shipping';
import { getStoreKnowledge, resolveLiveVariant } from '@/lib/shopify-store';

const sessions: Record<string, Array<{ role: 'user' | 'assistant'; content: string }>> = {};
const MAX_USER_TURNS = 24;

type OrderDetails = {
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
};

type DetailField = keyof OrderDetails;
type DetailIssue = { field: DetailField; reason: string; suggestion?: string };
type ProductOptionValue = { name: string; value: string };
type CartItemInput = {
  productName?: string;
  productId?: string;
  productHandle?: string;
  productUrl?: string;
  image?: string;
  variantId?: string;
  selectedOptions?: ProductOptionValue[];
  quantity?: number;
};

type VerifiedCartItem = CartItemRecord;

const VALID_FIELDS: DetailField[] = ['customerName', 'customerPhone', 'customerCity', 'customerAddress'];

const PAKISTANI_CITIES = new Set([
  'karachi','lahore','islamabad','rawalpindi','faisalabad','multan','peshawar','quetta','hyderabad','gujranwala','sialkot','bahawalpur','sargodha','sukkur','larkana','abbottabad','mardan','gujrat','jhelum','rahim yar khan','sheikhupura','kasur','sahiwal','okara','wah cantt','taxila','mirpur khas','nawabshah','shaheed benazirabad','dera ghazi khan','dera ismail khan','mingora','swat','burewala','chiniot','jhang','hafizabad','kamoke','khanewal','muzaffargarh','vehari','attock','chakwal','murree','bahawalnagar','mandi bahauddin','khushab','toba tek singh','jacobabad','shikarpur','khairpur','thatta','badin','gwadar','turbat','chaman','zhob','mansehra','haripur','nowshera','kohat','bannu','swabi','charsadda','dir','chitral','muzaffarabad','mirpur','kotli','bhimber','rawalakot','gilgit','skardu','hunza','chilas','layyah','lodhran','pakpattan','narowal','nankana sahib','wazirabad','daska','sambrial','gojra','jampur','kabirwala','mianwali','bhakkar','chishtian','haroonabad','hasilpur','ahmadpur east','kot addu','shorkot','pir mahal','arifwala','depalpur','pattoki','kharian','lala musa','dina','kallar syedan','kahuta','hasan abdal','hattar','hub','khuzdar','loralai','sibi','dera murad jamali','uch','matli','tando adam','tando allahyar','tando muhammad khan','umerkot','sanghar','dadu','sehwan','moro','naushahro feroze','kandhkot','ghotki','rohri','pano aqil'
]);

const CITY_ALIASES: Record<string, string> = {
  khi: 'karachi', lhr: 'lahore', isb: 'islamabad', rwp: 'rawalpindi', hyd: 'hyderabad',
};

const LOCALITY_NOT_CITY = /\b(buffer\s*zone|gulshan|dha|clifton|nazimabad|north nazimabad|bahria|defence|johar|korangi|malir|saddar|f b area|fb area|sector\s*\d|phase\s*\d)\b/i;

function normalizeSpaces(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeCity(value: unknown): string {
  return normalizeSpaces(value).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function prettyCity(value: string): string {
  return value.replace(/\b\w/g, char => char.toUpperCase());
}

function normalizePhone(value: unknown): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^923\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^3\d{9}$/.test(digits)) return `0${digits}`;
  return digits;
}

function normalizeProductOptions(value: unknown): ProductOptionValue[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map(option => ({
    name: normalizeSpaces(option?.name).slice(0, 80),
    value: normalizeSpaces(option?.value).slice(0, 120),
  })).filter(option => option.name && option.value);
}

function isValidName(value: unknown): boolean {
  const name = normalizeSpaces(value);
  const parts = name.split(' ').filter(Boolean);
  return parts.length >= 2 && name.length >= 5 && name.length <= 80 && /^[\p{L} .'-]+$/u.test(name) && !/^(test|abc|user|customer|unknown)(\s|$)/i.test(name);
}

function isValidPhone(value: unknown): boolean {
  const phone = normalizePhone(value);
  // Pakistan cellular ranges: 030x-034x plus SCOM 0355.
  if (!/^03(?:0\d|1\d|2\d|3\d|4\d|55)\d{7}$/.test(phone)) return false;
  const subscriber = phone.slice(4);
  return new Set(subscriber).size >= 3;
}

function isValidAddress(value: unknown): boolean {
  const address = normalizeSpaces(value);
  return address.length >= 12 && address.length <= 220 && address.split(' ').length >= 3 && /\p{L}/u.test(address) && /\d/.test(address) && !/^(test|abc|address|unknown)$/i.test(address);
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = previous[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost);
      diagonal = old;
    }
  }
  return previous[b.length];
}

function citySuggestion(value: unknown): string | null {
  const city = normalizeCity(value);
  if (!city) return null;
  if (CITY_ALIASES[city]) return CITY_ALIASES[city];
  if (PAKISTANI_CITIES.has(city)) return city;
  let best = '';
  let distance = Number.POSITIVE_INFINITY;
  for (const known of PAKISTANI_CITIES) {
    const current = levenshtein(city, known);
    if (current < distance) { distance = current; best = known; }
  }
  const allowed = city.length <= 6 ? 1 : 2;
  return distance <= allowed ? best : null;
}

function validateField(field: DetailField, rawValue: unknown): { valid: boolean; normalized: string; reason?: string; suggestion?: string } {
  if (field === 'customerName') {
    const normalized = normalizeSpaces(rawValue);
    return isValidName(normalized)
      ? { valid: true, normalized }
      : { valid: false, normalized, reason: 'Please apna poora first + last name likhein.' };
  }

  if (field === 'customerPhone') {
    const normalized = normalizePhone(rawValue);
    return isValidPhone(normalized)
      ? { valid: true, normalized }
      : { valid: false, normalized, reason: 'Valid Pakistani mobile number dein, misal 03340139169 ya +923340139169.' };
  }

  if (field === 'customerCity') {
    const normalizedRaw = normalizeSpaces(rawValue);
    const normalizedCity = normalizeCity(rawValue);
    const suggestion = citySuggestion(rawValue);
    if (LOCALITY_NOT_CITY.test(normalizedRaw) && !PAKISTANI_CITIES.has(normalizedCity)) {
      return { valid: false, normalized: normalizedRaw, reason: 'Ye area/locality lag rahi hai. City ka actual naam dein, misal Karachi.', suggestion: 'Karachi' };
    }
    if (PAKISTANI_CITIES.has(normalizedCity)) return { valid: true, normalized: prettyCity(normalizedCity) };
    if (suggestion) return { valid: false, normalized: normalizedRaw, reason: `City spelling verify nahi hui. Kya ${prettyCity(suggestion)} hai?`, suggestion: prettyCity(suggestion) };
    return { valid: false, normalized: normalizedRaw, reason: 'Actual Pakistani city/town ka naam dein.' };
  }

  const normalized = normalizeSpaces(rawValue);
  return isValidAddress(normalized)
    ? { valid: true, normalized }
    : { valid: false, normalized, reason: 'House/flat/building number aur street/sector/area ke saath full address dein.' };
}

function validateDetails(input: Partial<OrderDetails>): { data: OrderDetails; issues: DetailIssue[] } {
  const data: OrderDetails = {
    customerName: normalizeSpaces(input.customerName),
    customerPhone: normalizePhone(input.customerPhone),
    customerCity: normalizeSpaces(input.customerCity),
    customerAddress: normalizeSpaces(input.customerAddress),
  };
  const issues: DetailIssue[] = [];
  for (const field of VALID_FIELDS) {
    const result = validateField(field, data[field]);
    data[field] = result.normalized;
    if (!result.valid) issues.push({ field, reason: result.reason || 'Is detail ko check karein.', suggestion: result.suggestion });
  }
  return { data, issues };
}

function parseJsonObject(text: string): any | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

async function auditDetailsWithAI(details: OrderDetails): Promise<DetailIssue[]> {
  const messages: AIMessage[] = [
    {
      role: 'system',
      content: `Audit Pakistani ecommerce delivery details. Return JSON only. Independently inspect all four values together. Do not invent or silently fix anything. Phone ownership cannot be verified here; only flag implausible format. City must be an actual city/town, not a neighborhood. Address should plausibly belong with the city and include house/flat/building + locality/street/sector. If clearly valid return {"valid":true,"issues":[]}. Otherwise return {"valid":false,"issues":[{"field":"customerCity","reason":"short Roman Urdu reason","suggestion":"optional"}]}. Allowed fields: customerName, customerPhone, customerCity, customerAddress.`,
    },
    { role: 'user', content: JSON.stringify(details) },
  ];

  try {
    const parsed = parseJsonObject(await callAI(messages));
    if (!parsed || !Array.isArray(parsed.issues)) return [];
    return parsed.issues.filter((issue: any) => VALID_FIELDS.includes(issue?.field)).map((issue: any) => ({
      field: issue.field as DetailField,
      reason: normalizeSpaces(issue.reason || 'Is detail ko dobara check karein.'),
      suggestion: issue.suggestion ? normalizeSpaces(issue.suggestion) : undefined,
    }));
  } catch (error) {
    console.error('AI final detail audit failed; deterministic checks remain active:', error);
    return [];
  }
}

function isOrderIntent(message: string): boolean {
  return /\b(order\s*(karna|karni|karo|krna|place|confirm)|buy\s*(it|this)?|kharid|purchase|book\s*(kar|karo)|mujhe\s+(ye|this).*chahiye|lena\s+hai)\b/i.test(message);
}

function chatPrompt(productInfo: any, liveContext: string): string {
  const selectedOptions = normalizeProductOptions(productInfo?.selectedOptions).map(option => `${option.name}: ${option.value}`).join(', ');
  return `You are Sparrow, the sales assistant for Sparrow Official Pakistan. Speak natural Roman Urdu mixed with simple English, respectful Aap/Ji. The customer can chat freely before or during checkout.

CURRENT SELECTION FROM PRODUCT PAGE:
Product: ${normalizeSpaces(productInfo?.productName || 'Selected product')}
${selectedOptions ? `Selected options: ${selectedOptions}` : ''}
${productInfo?.price ? `Displayed price: Rs.${productInfo.price}` : ''}

LIVE STORE KNOWLEDGE (source of truth; if absent, say you cannot confirm):
${liveContext || 'Live store lookup unavailable for this request.'}

Rules:
- Answer product questions from live description/options/variants, and website policy questions only from provided live policy text.
- Never invent fabric, stock, size, price, delivery charge, return policy, or discount.
- If search results are present, recommend only those results.
- Customer may ask questions while an order is in progress; answer the question without losing checkout progress.
- If the customer wants multiple colors/sizes of the same product, explain that the cart can add each variation with its own quantity.
- Keep answers useful and concise, usually 1-4 sentences.
- Do not collect customer name/phone/city/address yourself. The application handles those fields securely when ordering starts.`;
}

function fallbackCartItem(productInfo: any, quantity: number): CartItemInput {
  return {
    productName: productInfo?.productName,
    productId: productInfo?.productId,
    productHandle: productInfo?.productHandle,
    productUrl: productInfo?.productUrl,
    image: productInfo?.image,
    variantId: productInfo?.variantId,
    selectedOptions: normalizeProductOptions(productInfo?.selectedOptions),
    quantity,
  };
}

function normalizeCartInput(cartItems: unknown, productInfo: any, quantity: number): CartItemInput[] {
  const source = Array.isArray(cartItems) && cartItems.length ? cartItems : [fallbackCartItem(productInfo, quantity)];
  return source.slice(0, 20).map((item: any) => ({
    productName: normalizeSpaces(item?.productName || productInfo?.productName).slice(0, 200),
    productId: item?.productId ? String(item.productId).slice(0, 100) : productInfo?.productId,
    productHandle: normalizeSpaces(item?.productHandle || productInfo?.productHandle).slice(0, 180),
    productUrl: normalizeSpaces(item?.productUrl || productInfo?.productUrl).slice(0, 1000),
    image: normalizeSpaces(item?.image || productInfo?.image).slice(0, 1000),
    variantId: String(item?.variantId || '').replace(/\D/g, ''),
    selectedOptions: normalizeProductOptions(item?.selectedOptions),
    quantity: Math.max(1, Math.min(20, Math.floor(Number(item?.quantity) || 1))),
  }));
}

async function liveCartPricing(cartItems: CartItemInput[], details: OrderDetails): Promise<{
  pricing: ShippingQuote;
  verifiedCartItems: VerifiedCartItem[];
}> {
  if (!cartItems.length) throw new Error('Cart empty hai. Kam az kam ek variation add karein.');

  const resolvedLines = await Promise.all(cartItems.map(async item => {
    const resolved = await resolveLiveVariant(item, item.quantity || 1);
    const productOptions = resolved.product.options.map((definition, index) => ({
      name: definition.name,
      value: resolved.variant.options[index] || '',
    })).filter(option => option.name && option.value);
    const unit = Number(resolved.variant.price);
    const lineTotal = unit * resolved.quantity;

    return {
      productName: resolved.product.title,
      productId: resolved.product.id || null,
      productHandle: resolved.product.handle || null,
      productUrl: resolved.product.productUrl || null,
      productImage: resolved.product.image || null,
      variantId: resolved.variant.id,
      productOptions,
      quantity: resolved.quantity,
      unitPrice: resolved.variant.price,
      lineTotal: Number.isInteger(lineTotal) ? String(lineTotal) : lineTotal.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''),
    } satisfies VerifiedCartItem;
  }));

  const totalQuantity = resolvedLines.reduce((sum, item) => sum + item.quantity, 0);
  if (totalQuantity > 50) throw new Error('Ek order mein maximum 50 total items allowed hain.');

  const pricing = await getShopifyShippingQuote({
    productUrl: resolvedLines[0].productUrl || undefined,
    items: resolvedLines.map(item => ({
      variantId: item.variantId,
      price: item.unitPrice,
      quantity: item.quantity,
      label: `${item.productName} — ${item.productOptions.map(option => `${option.name}: ${option.value}`).join(' • ')}`,
    })),
  }, {
    city: details.customerCity,
    address1: details.customerAddress,
  });

  return { pricing, verifiedCartItems: resolvedLines };
}

async function saveOrder(sessionId: string, cartItems: VerifiedCartItem[], details: OrderDetails, pricing: ShippingQuote) {
  const first = cartItems[0];
  const firstOptions = first?.productOptions || [];
  const color = firstOptions.find(option => /colou?r/i.test(option.name))?.value || null;
  const size = firstOptions.find(option => /size/i.test(option.name))?.value || null;
  const totalQuantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  const order = await db.order.create({
    data: {
      sessionId,
      productName: first?.productName || 'Unknown Product',
      productId: first?.productId || null,
      productHandle: first?.productHandle || null,
      variantId: cartItems.length === 1 ? first?.variantId || null : null,
      productUrl: first?.productUrl || null,
      productImage: first?.productImage || null,
      productOptions: cartItems.length === 1 ? firstOptions : null,
      cartItems,
      color: cartItems.length === 1 ? color : null,
      size: cartItems.length === 1 ? size : null,
      price: cartItems.length === 1 ? first?.unitPrice || null : null,
      subtotalPrice: pricing.productPrice,
      shippingPrice: pricing.shippingPrice,
      shippingRateName: pricing.shippingRateName,
      totalPrice: pricing.totalPrice,
      quantity: String(totalQuantity),
      customerName: details.customerName,
      customerPhone: details.customerPhone,
      customerCity: details.customerCity,
      customerAddress: details.customerAddress,
      chatHistory: JSON.stringify(sessions[sessionId] || []),
      status: 'pending',
    },
  });

  const notifications = await sendOrderWhatsAppNotifications(order);
  delete sessions[sessionId];
  return { ...order, customerWhatsAppSent: notifications.customerSent, ownerWhatsAppSent: notifications.ownerSent };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      action = 'chat', message, sessionId, productInfo = {}, details = {}, field, value,
      quantity = 1, cartItems,
    } = body;
    if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

    if (action === 'validate_field') {
      if (!VALID_FIELDS.includes(field)) return NextResponse.json({ error: 'Invalid field' }, { status: 400 });
      return NextResponse.json(validateField(field, value));
    }

    if (action === 'verify_order_details') {
      const validation = validateDetails(details);
      if (validation.issues.length) return NextResponse.json({ verified: false, needsCorrection: true, details: validation.data, issues: validation.issues });
      const aiIssues = await auditDetailsWithAI(validation.data);
      if (aiIssues.length) return NextResponse.json({ verified: false, needsCorrection: true, details: validation.data, issues: aiIssues });
      return NextResponse.json({ verified: true, details: validation.data, reply: 'Delivery details verify ho gayi hain.' });
    }

    if (action === 'quote_order') {
      const validation = validateDetails(details);
      if (validation.issues.length) return NextResponse.json({ needsCorrection: true, details: validation.data, issues: validation.issues }, { status: 400 });
      try {
        const inputCart = normalizeCartInput(cartItems, productInfo, quantity);
        const { pricing, verifiedCartItems } = await liveCartPricing(inputCart, validation.data);
        return NextResponse.json({ pricing, verifiedCartItems });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Shipping/pricing verify nahi ho saki.';
        console.error('Order quote failed:', reason);
        return NextResponse.json({ pricingUnavailable: true, reason }, { status: 409 });
      }
    }

    if (action === 'confirm_order') {
      const validation = validateDetails(details);
      if (validation.issues.length) return NextResponse.json({ needsCorrection: true, details: validation.data, issues: validation.issues }, { status: 400 });
      try {
        const inputCart = normalizeCartInput(cartItems, productInfo, quantity);
        const { pricing, verifiedCartItems } = await liveCartPricing(inputCart, validation.data);
        const order = await saveOrder(sessionId, verifiedCartItems, validation.data, pricing);
        return NextResponse.json({
          orderComplete: true,
          reply: 'Shukriya! Aapka order successfully confirm ho gaya hai.',
          order,
          pricing,
          verifiedCartItems,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Order final verify nahi ho saka.';
        return NextResponse.json({ pricingUnavailable: true, reason }, { status: 409 });
      }
    }

    if (!message || !String(message).trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 });
    const text = String(message).trim();
    if (!sessions[sessionId]) sessions[sessionId] = [];
    const userTurns = sessions[sessionId].filter(item => item.role === 'user').length;
    if (userTurns >= MAX_USER_TURNS) return NextResponse.json({ reply: 'Chat kaafi lambi ho gayi hai. Naya session start karein ya order continue karein.', orderIntent: false });

    sessions[sessionId].push({ role: 'user', content: text });
    const knowledge = await getStoreKnowledge(text, productInfo);
    const recent = sessions[sessionId].slice(-10);
    const aiMessages: AIMessage[] = [
      { role: 'system', content: chatPrompt(productInfo, knowledge.contextText.slice(0, 8000)) },
      ...recent,
    ];
    const reply = await callAI(aiMessages);
    sessions[sessionId].push({ role: 'assistant', content: reply });

    return NextResponse.json({
      reply,
      orderIntent: isOrderIntent(text),
      productSuggestions: knowledge.suggestions,
      liveProduct: knowledge.currentProduct,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Internal server error: ${message}` }, { status: 500 });
  }
}