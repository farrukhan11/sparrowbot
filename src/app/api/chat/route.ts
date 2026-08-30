import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { callAI, type AIMessage } from '@/lib/ai';
import { sendOrderWhatsAppNotifications } from '@/lib/whatsapp';

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
  'nowshera', 'kohat', 'bannu',
];

function normalizeSpaces(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeCity(value: string): string {
  return normalizeSpaces(value.toLowerCase().replace(/[^a-z\s]/g, ' '));
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
  return parts.length >= 2 && name.length >= 5 && /^[\p{L} .'-]+$/u.test(name);
}

function isValidPhone(value: string): boolean {
  return /^03\d{9}$/.test(normalizePhone(value));
}

function isValidCity(value: string): boolean {
  const city = normalizeSpaces(value);
  return city.length >= 2 && city.length <= 50 && /^[\p{L} .'-]+$/u.test(city);
}

function isValidAddress(value: string): boolean {
  const address = normalizeSpaces(value);
  const words = address.split(' ').filter(Boolean);
  return address.length >= 12 && words.length >= 3 && /\p{L}/u.test(address);
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
    issues.push({ field: 'customerName', reason: 'Poora naam first aur last name ke saath likhein.' });
  }

  if (!isValidPhone(data.customerPhone)) {
    issues.push({ field: 'customerPhone', reason: '11-digit Pakistani mobile number dein jo 03 se start ho.' });
  }

  if (!isValidCity(data.customerCity)) {
    issues.push({ field: 'customerCity', reason: 'City ka sahi naam likhein.' });
  } else {
    const suggestion = getCitySuggestion(data.customerCity);
    if (suggestion) {
      const pretty = suggestion.replace(/\b\w/g, char => char.toUpperCase());
      issues.push({
        field: 'customerCity',
        reason: `City ka naam unclear lag raha hai. Kya aap ${pretty} kehna chah rahe hain?`,
        suggestion: pretty,
      });
    }
  }

  if (!isValidAddress(data.customerAddress)) {
    issues.push({
      field: 'customerAddress',
      reason: 'House/flat number, street/sector aur area ke saath mukammal address likhein.',
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
      content: `You audit Pakistani ecommerce delivery details. Return JSON only, no markdown.
Do not invent or silently repair any customer value. If anything looks doubtful, mark it as an issue so the customer can correct it.
Check all four fields:
- customerName: plausible full human name, normally first + last name, no digits.
- customerPhone: exactly 11 digits and starts with 03.
- customerCity: plausible Pakistani city/town. Treat obvious misspellings as doubtful and give a suggestion.
- customerAddress: realistically deliverable Pakistani address. Accept common formats such as R-57 Sector 15A/4 Buffer Zone; postal code is NOT required. It should contain a house/flat/building identifier plus locality/street/sector/area information.
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
Do not invent product facts, stock, price, fees or policies.
Payment: Cash on Delivery and advance payment are both available.
Delivery policy: delivery is available across Pakistan; next-day delivery is available in major cities where applicable.
Exchange policy: 7 days easy exchange for size issues.
Keep answers short, usually 1-3 sentences.`;
}

async function saveOrder({
  sessionId,
  productInfo,
  details,
}: {
  sessionId: string;
  productInfo: any;
  details: OrderDetails;
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
      price: productInfo?.price ? String(productInfo.price).slice(0, 50) : null,
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
          reply: 'Kuch details ko dobara check karna hai. Neeche highlighted fields correct kar dein.',
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

      return NextResponse.json({
        reply: 'Details verify ho gayi hain. Neeche summary check karke order confirm kar dein.',
        orderComplete: false,
        detailsVerified: true,
        details: validation.data,
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

      const order = await saveOrder({
        sessionId,
        productInfo: productInfo || {},
        details: validation.data,
      });

      return NextResponse.json({
        reply: 'Shukriya! Aapka order successfully confirm ho gaya hai.',
        orderComplete: true,
        order,
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
