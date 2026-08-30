import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { callAI, type AIMessage } from '@/lib/ai';
import { sendOrderWhatsAppNotifications } from '@/lib/whatsapp';
import {
  getShopifyShippingQuote,
  type ShippingQuote,
} from '@/lib/shopify-shipping';

const sessions: Record<string, Array<{ role: 'user' | 'assistant'; content: string }>> = {};
const MAX_USER_TURNS = 10;

type OrderDetails = {
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
};

type DetailField = keyof OrderDetails;

type DetailIssue = {
  field: DetailField;
  reason: string;
  suggestion?: string;
};

type ProductOptionValue = {
  name: string;
  value: string;
};

const VALID_FIELDS: DetailField[] = [
  'customerName',
  'customerPhone',
  'customerCity',
  'customerAddress',
];

const PAKISTANI_CITIES = [
  'karachi', 'lahore', 'islamabad', 'rawalpindi', 'faisalabad', 'multan',
  'peshawar', 'quetta', 'hyderabad', 'gujranwala', 'sialkot', 'bahawalpur',
  'sargodha', 'sukkur', 'larkana', 'abbottabad', 'mardan', 'gujrat', 'jhelum',
  'rahim yar khan', 'sheikhupura', 'kasur', 'sahiwal', 'okara', 'wah cantt',
  'taxila', 'mirpur khas', 'nawabshah', 'shaheed benazirabad',
  'dera ghazi khan', 'dera ismail khan', 'mingora', 'swat', 'burewala',
  'chiniot', 'jhang', 'hafizabad', 'kamoke', 'khanewal', 'muzaffargarh',
  'vehari', 'attock', 'chakwal', 'murree', 'bahawalnagar', 'mandi bahauddin',
  'khushab', 'toba tek singh', 'jacobabad', 'shikarpur', 'khairpur', 'thatta',
  'badin', 'gwadar', 'turbat', 'chaman', 'zhob', 'mansehra', 'haripur',
  'nowshera', 'kohat', 'bannu', 'swabi', 'charsadda', 'dir', 'chitral',
  'muzaffarabad', 'mirpur', 'kotli', 'bhimber', 'rawalakot', 'gilgit', 'skardu',
  'hunza', 'chilas', 'layyah', 'lodhran', 'pakpattan', 'narowal', 'nankana sahib',
  'wazirabad', 'daska', 'sambrial', 'gojra', 'jampur', 'kabirwala', 'mianwali',
  'bhakkar', 'chishtian', 'haroonabad', 'hasilpur', 'ahmadpur east', 'kot addu',
  'shorkot', 'pir mahal', 'arifwala', 'depalpur', 'pattoki', 'kharian', 'lala musa',
  'dina', 'kallar syedan', 'kahuta', 'hasan abdal', 'hattar', 'hub', 'khuzdar',
  'loralai', 'sibi', 'dera murad jamali', 'uch', 'matli', 'tando adam',
  'tando allahyar', 'tando muhammad khan', 'umerkot', 'sanghar', 'dadu',
  'sehwan', 'moro', 'naushahro feroze', 'kandhkot', 'ghotki', 'rohri', 'pano aqil',
];

const CITY_ALIASES: Record<string, string> = {
  khi: 'karachi',
  lhr: 'lahore',
  isb: 'islamabad',
  rwp: 'rawalpindi',
  hyd: 'hyderabad',
};

function normalizeSpaces(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeCity(value: string): string {
  return normalizeSpaces(value.toLowerCase().replace(/[^a-z\s]/g, ' '));
}

function prettyCity(value: string): string {
  return value.replace(/\b\w/g, char => char.toUpperCase());
}

function normalizePhone(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

function normalizeProductOptions(value: unknown): ProductOptionValue[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 10)
    .map(option => ({
      name: normalizeSpaces(String(option?.name || '')).slice(0, 80),
      value: normalizeSpaces(String(option?.value || '')).slice(0, 120),
    }))
    .filter(option => option.name && option.value);
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

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

function getCitySuggestion(value: string): string | null {
  const city = normalizeCity(value);
  if (!city || PAKISTANI_CITIES.includes(city)) return null;
  if (CITY_ALIASES[city]) return CITY_ALIASES[city];

  let bestCity: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const knownCity of PAKISTANI_CITIES) {
    const distance = levenshtein(city, knownCity);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCity = knownCity;
    }
  }

  const allowedDistance = city.length <= 6 ? 1 : 2;
  return bestDistance <= allowedDistance ? bestCity : null;
}

function isValidName(value: string): boolean {
  const name = normalizeSpaces(value);
  const parts = name.split(' ').filter(Boolean);
  const placeholder = /^(test|testing|abc|user|customer|name|unknown)(\s|$)/i.test(name);
  return !placeholder && parts.length >= 2 && name.length >= 5 && /^[\p{L} .'-]+$/u.test(name);
}

function isValidPhone(value: string): boolean {
  return /^03\d{9}$/.test(normalizePhone(value));
}

function isKnownPakistaniCity(value: string): boolean {
  return PAKISTANI_CITIES.includes(normalizeCity(value));
}

function isValidAddress(value: string): boolean {
  const address = normalizeSpaces(value);
  const words = address.split(' ').filter(Boolean);
  const placeholder = /^(test|testing|abc|address|unknown)(\s|$)/i.test(address);
  return (
    !placeholder &&
    address.length >= 12 &&
    words.length >= 3 &&
    /\p{L}/u.test(address) &&
    /\d/.test(address)
  );
}

function validateDetails(details: Partial<OrderDetails>): {
  data: OrderDetails;
  issues: DetailIssue[];
} {
  const data: OrderDetails = {
    customerName: normalizeSpaces(details.customerName || ''),
    customerPhone: normalizePhone(details.customerPhone || ''),
    customerCity: normalizeSpaces(details.customerCity || ''),
    customerAddress: normalizeSpaces(details.customerAddress || ''),
  };

  const issues: DetailIssue[] = [];

  if (!isValidName(data.customerName)) {
    issues.push({ field: 'customerName', reason: 'Poora aur plausible first + last name likhein.' });
  }

  if (!isValidPhone(data.customerPhone)) {
    issues.push({ field: 'customerPhone', reason: '11-digit Pakistani mobile number dein jo 03 se start ho.' });
  }

  if (!isKnownPakistaniCity(data.customerCity)) {
    const suggestion = getCitySuggestion(data.customerCity);
    issues.push({
      field: 'customerCity',
      reason: suggestion
        ? `City ka naam verify nahi hua. Kya aap ${prettyCity(suggestion)} kehna chah rahe hain?`
        : 'Sirf actual Pakistani city/town ka naam likhein, area/locality nahi (misal: Karachi, Lahore, Islamabad).',
      suggestion: suggestion ? prettyCity(suggestion) : undefined,
    });
  }

  if (!isValidAddress(data.customerAddress)) {
    issues.push({
      field: 'customerAddress',
      reason: 'House/flat/building number aur street/sector/area ke saath mukammal deliverable address likhein.',
    });
  }

  return { data, issues };
}

function parseJsonObject(text: string): any | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function auditDetailsWithAI(details: OrderDetails): Promise<DetailIssue[]> {
  const messages: AIMessage[] = [
    {
      role: 'system',
      content: `You strictly audit Pakistani ecommerce delivery details. Return JSON only, no markdown.
Independently check EVERY field. Do not invent, silently repair, or assume any customer value. If a field is not clearly plausible, mark it as an issue.
- customerName: plausible full human name, normally first + last name, no digits, no placeholders such as test/user/abc.
- customerPhone: exactly 11 digits and starts with 03. Only validate format; do not claim ownership verification.
- customerCity: MUST be an actual Pakistani city/town. A neighborhood, society, locality, sector or area is NOT a city. Examples that must be rejected as city values: Buffer Zone, Gulshan-e-Iqbal, DHA, Clifton, Bahria Town, North Nazimabad. If the locality strongly implies a city, suggest the city instead.
- customerAddress: realistically deliverable Pakistani address with a house/flat/building identifier and locality/street/sector/area. Postal code is not required. City does not have to be repeated inside the address.
Also cross-check the fields together for obvious contradictions.
Reasons and suggestions must be short Roman Urdu.
Output exactly:
{"valid":true,"issues":[]}
or
{"valid":false,"issues":[{"field":"customerCity","reason":"...","suggestion":"Karachi"}]}
Allowed field values: customerName, customerPhone, customerCity, customerAddress.`,
    },
    { role: 'user', content: JSON.stringify(details) },
  ];

  try {
    const reply = await callAI(messages);
    const parsed = parseJsonObject(reply);

    if (!parsed || !Array.isArray(parsed.issues)) {
      console.warn('AI detail audit returned unparseable response; deterministic validation will be used.');
      return [];
    }

    return parsed.issues
      .filter((issue: any) => VALID_FIELDS.includes(issue?.field))
      .map((issue: any) => ({
        field: issue.field as DetailField,
        reason: normalizeSpaces(issue.reason || 'Is detail ko dobara check karein.'),
        suggestion: issue.suggestion ? normalizeSpaces(issue.suggestion) : undefined,
      }));
  } catch (error) {
    console.error('AI detail audit failed; using deterministic validation fallback:', error);
    return [];
  }
}

function getChatPrompt(productInfo: {
  productName?: string;
  color?: string;
  size?: string;
  price?: string;
  selectedOptions?: ProductOptionValue[];
}): string {
  const options = normalizeProductOptions(productInfo.selectedOptions)
    .map(option => `${option.name}: ${option.value}`)
    .join(', ');

  return `You are Sparrow, the concise sales assistant for Sparrow Official, a Pakistani clothing brand. Reply in natural Roman Urdu mixed with simple English and use respectful Aap/Ji language.

CURRENT PRODUCT:
Product: ${productInfo.productName || 'Selected Product'}
${options ? `Selected options: ${options}` : ''}
${productInfo.color ? `Color: ${productInfo.color}` : ''}
${productInfo.size ? `Size: ${productInfo.size}` : ''}
${productInfo.price ? `Price: Rs.${productInfo.price}` : ''}

The website has a separate product-options and delivery-details form. Do NOT collect name, phone, city or address one-by-one in chat. If the customer wants to order, tell them to use the form shown in the chat.
Do not invent product facts, stock, price, shipping fees or policies. Shipping is calculated live from Shopify after the delivery details are verified.
Payment: Cash on Delivery and advance payment are both available.
Delivery policy: delivery is available across Pakistan; next-day delivery is available in major cities where applicable.
Exchange policy: 7 days easy exchange for size issues.
Keep answers short, usually 1-3 sentences.`;
}

function shippingLabel(pricing: ShippingQuote): string {
  return Number(pricing.shippingPrice) === 0
    ? `Free (${pricing.shippingRateName})`
    : `Rs.${pricing.shippingPrice} (${pricing.shippingRateName})`;
}

async function calculatePricing(productInfo: any, details: OrderDetails): Promise<ShippingQuote> {
  return getShopifyShippingQuote(
    {
      variantId: productInfo?.variantId,
      productUrl: productInfo?.productUrl,
      price: productInfo?.price,
    },
    {
      city: details.customerCity,
      address1: details.customerAddress,
    }
  );
}

async function saveOrder({
  sessionId,
  productInfo,
  details,
  pricing,
}: {
  sessionId: string;
  productInfo: any;
  details: OrderDetails;
  pricing: ShippingQuote;
}) {
  const chatHistory = sessions[sessionId] || [];
  const productOptions = normalizeProductOptions(productInfo?.selectedOptions);
  const color = productOptions.find(option => /colou?r/i.test(option.name))?.value || productInfo?.color || null;
  const size = productOptions.find(option => /size/i.test(option.name))?.value || productInfo?.size || null;

  const order = await db.order.create({
    data: {
      sessionId,
      productName: normalizeSpaces(productInfo?.productName || 'Unknown Product').slice(0, 200),
      productId: productInfo?.productId ? String(productInfo.productId).slice(0, 100) : null,
      productHandle: productInfo?.productHandle ? String(productInfo.productHandle).slice(0, 180) : null,
      variantId: productInfo?.variantId ? String(productInfo.variantId).slice(0, 100) : null,
      productUrl: productInfo?.productUrl ? String(productInfo.productUrl).slice(0, 1000) : null,
      productImage: productInfo?.image ? String(productInfo.image).slice(0, 1000) : null,
      productOptions,
      color,
      size,
      price: pricing.productPrice,
      shippingPrice: pricing.shippingPrice,
      shippingRateName: pricing.shippingRateName,
      totalPrice: pricing.totalPrice,
      customerName: details.customerName,
      customerPhone: details.customerPhone,
      customerCity: details.customerCity,
      customerAddress: details.customerAddress,
      chatHistory: JSON.stringify(chatHistory),
      status: 'pending',
    },
  });

  const notifications = await sendOrderWhatsAppNotifications(order);
  delete sessions[sessionId];

  return {
    id: order.id,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerCity: order.customerCity,
    customerAddress: order.customerAddress,
    productName: order.productName,
    productOptions: order.productOptions,
    color: order.color,
    size: order.size,
    price: order.price,
    shippingPrice: order.shippingPrice,
    shippingRateName: order.shippingRateName,
    totalPrice: order.totalPrice,
    customerWhatsAppSent: notifications.customerSent,
    ownerWhatsAppSent: notifications.ownerSent,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, message, sessionId, productInfo, details } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    if (action === 'verify_details') {
      const validation = validateDetails(details || {});

      if (validation.issues.length > 0) {
        return NextResponse.json({
          reply: 'Har detail verify ki ja rahi hai. Kuch fields valid nahi hain; highlighted fields correct kar dein.',
          orderComplete: false,
          needsCorrection: true,
          issues: validation.issues,
          details: validation.data,
        });
      }

      const aiIssues = await auditDetailsWithAI(validation.data);

      if (aiIssues.length > 0) {
        return NextResponse.json({
          reply: 'AI verification mein kuch details doubtful lagi hain. Sirf highlighted fields check/correct kar dein.',
          orderComplete: false,
          needsCorrection: true,
          issues: aiIssues,
          details: validation.data,
        });
      }

      let pricing: ShippingQuote;
      try {
        pricing = await calculatePricing(productInfo || {}, validation.data);
      } catch (error) {
        console.error('Shopify shipping calculation failed:', error);
        return NextResponse.json({
          reply: 'Delivery details valid hain lekin Shopify se is city/address ki shipping rate confirm nahi hui. City/address dobara check karein.',
          orderComplete: false,
          needsCorrection: true,
          issues: [
            {
              field: 'customerCity',
              reason: 'Is city/address ke liye live Shopify shipping rate confirm nahi hui. City ka actual naam dobara check karein.',
            },
          ],
          details: validation.data,
        });
      }

      return NextResponse.json({
        reply: `Sab details verify ho gayi hain. Product: Rs.${pricing.productPrice} • Shipping: ${shippingLabel(pricing)} • Total: Rs.${pricing.totalPrice}. Neeche summary check karke order confirm kar dein.`,
        orderComplete: false,
        detailsVerified: true,
        details: validation.data,
        pricing,
      });
    }

    if (action === 'confirm_order') {
      const validation = validateDetails(details || {});

      if (validation.issues.length > 0) {
        return NextResponse.json({
          reply: 'Confirm karne se pehle kuch details correct karna zaroori hai.',
          orderComplete: false,
          needsCorrection: true,
          issues: validation.issues,
          details: validation.data,
        });
      }

      const aiIssues = await auditDetailsWithAI(validation.data);
      if (aiIssues.length > 0) {
        return NextResponse.json({
          reply: 'Final verification mein kuch details doubtful hain. Highlighted fields correct kar dein.',
          orderComplete: false,
          needsCorrection: true,
          issues: aiIssues,
          details: validation.data,
        });
      }

      let pricing: ShippingQuote;
      try {
        pricing = await calculatePricing(productInfo || {}, validation.data);
      } catch (error) {
        console.error('Final Shopify shipping calculation failed:', error);
        return NextResponse.json({
          reply: 'Order confirm karne se pehle live shipping rate verify nahi ho saki. City/address dobara check karein.',
          orderComplete: false,
          needsCorrection: true,
          issues: [
            {
              field: 'customerCity',
              reason: 'Live Shopify shipping rate verify nahi hui. City/address dobara check karein.',
            },
          ],
          details: validation.data,
        });
      }

      const order = await saveOrder({
        sessionId,
        productInfo: productInfo || {},
        details: validation.data,
        pricing,
      });

      return NextResponse.json({
        reply: `Shukriya! Aapka order successfully confirm ho gaya hai. Final total Rs.${pricing.totalPrice} hai.`,
        orderComplete: true,
        order,
        pricing,
      });
    }

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    if (!sessions[sessionId]) sessions[sessionId] = [];

    const userTurns = sessions[sessionId].filter(item => item.role === 'user').length;
    if (userTurns >= MAX_USER_TURNS) {
      return NextResponse.json({
        reply: 'Chat limit complete ho gayi hai. Order ke liye product options aur delivery details form fill kar dein.',
        orderComplete: false,
      });
    }

    sessions[sessionId].push({ role: 'user', content: String(message) });

    const recentHistory = sessions[sessionId].slice(-6);
    const llmMessages: AIMessage[] = [
      { role: 'system', content: getChatPrompt(productInfo || {}) },
      ...recentHistory,
    ];

    const aiReply = await callAI(llmMessages);
    sessions[sessionId].push({ role: 'assistant', content: aiReply });

    return NextResponse.json({ reply: aiReply, orderComplete: false });
  } catch (error: unknown) {
    console.error('Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error: ' + errorMessage },
      { status: 500 }
    );
  }
}
