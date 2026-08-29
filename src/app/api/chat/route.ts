import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { callAI, type AIMessage } from '@/lib/ai';

const STORE_OWNER_WHATSAPP =
  process.env.WHATSAPP_ORDER_RECIPIENT?.replace(/\D/g, '') || '923001234567';

const sessions: Record<string, Array<{ role: 'user' | 'assistant'; content: string }>> = {};
const terminatedSessions = new Set<string>();
const MAX_USER_TURNS = 15;

type OrderDetails = {
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
};

type ExpectedField = 'name' | 'phone' | 'city' | 'address' | null;

const PAKISTANI_CITIES = [
  'karachi',
  'lahore',
  'islamabad',
  'rawalpindi',
  'faisalabad',
  'multan',
  'peshawar',
  'quetta',
  'hyderabad',
  'gujranwala',
  'sialkot',
  'bahawalpur',
  'sargodha',
  'sukkur',
  'larkana',
  'abbottabad',
  'mardan',
  'gujrat',
  'jhelum',
  'rahim yar khan',
  'sheikhupura',
  'kasur',
  'sahiwal',
  'okara',
  'wah cantt',
  'taxila',
  'mirpur khas',
  'nawabshah',
  'shaheed benazirabad',
  'dera ghazi khan',
  'dera ismail khan',
  'mingora',
  'swat',
  'burewala',
  'chiniot',
  'jhang',
  'hafizabad',
  'kamoke',
  'khanewal',
  'muzaffargarh',
  'vehari',
  'attock',
  'chakwal',
  'murree',
  'bahawalnagar',
  'mandi bahauddin',
  'khushab',
  'toba tek singh',
  'jacobabad',
  'shikarpur',
  'khairpur',
  'thatta',
  'badin',
  'gwadar',
  'turbat',
  'chaman',
  'zhob',
  'mansehra',
  'haripur',
  'nowshera',
  'kohat',
  'bannu',
];

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeCity(value: string): string {
  return normalizeSpaces(value.toLowerCase().replace(/[^a-z\s]/g, ' '));
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
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

function isConfirmationPrompt(lastAssistantMessage?: string): boolean {
  if (!lastAssistantMessage) return false;
  const text = lastAssistantMessage.toLowerCase();
  return /confirm|confirmation|sahi hai|sahi hain|correct|kehna chah|keh rahe|verify kar|details theek|details sahi|sab theek/.test(
    text
  );
}

function detectExpectedField(lastAssistantMessage?: string): ExpectedField {
  if (!lastAssistantMessage || isConfirmationPrompt(lastAssistantMessage)) return null;

  const text = lastAssistantMessage.toLowerCase();
  if (/address|house|flat|street|mukammal address|poora address|full address/.test(text)) return 'address';
  if (/city|shehar/.test(text)) return 'city';
  if (/phone|mobile|contact number|mobile number|11-digit/.test(text)) return 'phone';
  if (/full name|poora naam|pura naam|naam bata|aapka naam/.test(text)) return 'name';
  return null;
}

function validateExpectedInput(field: ExpectedField, value: string): string | null {
  if (!field) return null;

  if (field === 'name' && !isValidName(value)) {
    return 'Janab, naam verify nahi ho raha. Please apna poora naam first aur last name ke saath likhein.';
  }

  if (field === 'phone' && !isValidPhone(value)) {
    return 'Mobile number sahi nahi lag raha. Please exactly 11 digits ka Pakistani number dein jo 03 se start ho, misal 03341234567.';
  }

  if (field === 'city') {
    if (!isValidCity(value)) {
      return 'City ka naam verify nahi ho raha. Please apne shehar ka sahi naam dobara likhein.';
    }

    const suggestion = getCitySuggestion(value);
    if (suggestion) {
      const pretty = suggestion.replace(/\b\w/g, char => char.toUpperCase());
      return `Kya aap ${pretty} kehna chah rahe hain? Please yes/haan keh kar confirm karein, warna exact city name likhein.`;
    }
  }

  if (field === 'address' && !isValidAddress(value)) {
    return 'Address incomplete lag raha hai. Please house/flat number, street/sector aur area ke saath mukammal address likhein.';
  }

  return null;
}

function validateOrderData(data: OrderDetails):
  | { valid: true; data: OrderDetails }
  | { valid: false; reply: string } {
  const customerName = normalizeSpaces(data.customerName || '');
  const customerPhone = normalizePhone(data.customerPhone || '');
  const customerCity = normalizeSpaces(data.customerCity || '');
  const customerAddress = normalizeSpaces(data.customerAddress || '');

  if (!isValidName(customerName)) {
    return {
      valid: false,
      reply: 'Order complete karne se pehle full name verify karna zaroori hai. Please first aur last name dono bhejein.',
    };
  }

  if (!isValidPhone(customerPhone)) {
    return {
      valid: false,
      reply: 'Mobile number verify nahi hua. Please exactly 11-digit Pakistani number bhejein jo 03 se start ho.',
    };
  }

  if (!isValidCity(customerCity)) {
    return {
      valid: false,
      reply: 'City verify nahi ho saki. Please shehar ka sahi naam dobara bhejein.',
    };
  }

  const citySuggestion = getCitySuggestion(customerCity);
  if (citySuggestion) {
    const pretty = citySuggestion.replace(/\b\w/g, char => char.toUpperCase());
    return {
      valid: false,
      reply: `City ka naam unclear hai. Kya aap ${pretty} kehna chah rahe hain? Please confirm karein.`,
    };
  }

  if (!isValidAddress(customerAddress)) {
    return {
      valid: false,
      reply: 'Address incomplete lag raha hai. Please house/flat number, street/sector aur area ke saath mukammal address bhejein.',
    };
  }

  return {
    valid: true,
    data: {
      customerName,
      customerPhone,
      customerCity,
      customerAddress,
    },
  };
}

function getSystemPrompt(productInfo: {
  productName?: string;
  color?: string;
  size?: string;
  price?: string;
}): string {
  return `You are "Sparrow", the friendly order assistant for Sparrow Official, a Pakistani clothing brand. Speak natural Roman Urdu mixed with simple English, like a helpful WhatsApp sales assistant.

CURRENT PRODUCT:
- Product: ${productInfo.productName || 'Selected Product'}
${productInfo.color ? `- Color: ${productInfo.color}` : ''}
${productInfo.size ? `- Size: ${productInfo.size}` : ''}
${productInfo.price ? `- Price: Rs.${productInfo.price}` : ''}

COLLECT THESE 4 DETAILS, ONE AT A TIME:
1. Full name: at least first + last name
2. Pakistani mobile number: exactly 11 digits starting with 03
3. City: clear Pakistani city/town
4. Full delivery address: house/flat, street/sector and area

VERIFICATION RULES:
- Never invent, silently repair, or guess customer details.
- A valid 11-digit 03XXXXXXXXX phone passes verification; do NOT ask the customer to confirm it again. Move to city.
- A clearly spelled city passes verification; do NOT ask again. If it looks misspelled, ask a yes/no confirmation for your suggested city.
- If YOU ask a yes/no confirmation and the customer says yes, haan, han, ji, bilkul, correct, theek hai, yup or similar, use the exact value you proposed in your previous message and continue. Do not ask them to type it again.
- If they say no, ask for the corrected value.
- After receiving a sufficiently detailed address, show ONE final compact confirmation containing name, phone, city and address, then ask if all details are correct.
- If the customer confirms that final summary, immediately output order_complete JSON. Do not ask another confirmation.

STYLE:
- Ask only one thing at a time.
- Keep replies short, usually 1-3 sentences.
- Use respectful language: Aap, Ji, Janab. Never use tu/tum.
- Do not repeatedly confirm already valid fields.

HANDLING ABUSE/OFF-TOPIC:
- Give one polite warning for abuse. If abuse continues, write a short closing line then on the next line output:
{"conversation_ended": true, "reason": "abuse"}
- Redirect off-topic chat back to ordering up to 2 times. If it continues, write a short closing line then output:
{"conversation_ended": true, "reason": "off_topic"}

STORE RULES:
- Do not invent prices, stock, delivery fees, policies or product facts.
- Do not ask size/color/quantity if already supplied in CURRENT PRODUCT.
- If asked about delivery, say: "Cash on delivery available all over Pakistan! Next day delivery within major cities."
- If asked about exchange/return, say: "7 days easy exchange policy hai. Size issue ho toh bata dein, replacement bhej dein ge."

WHEN THE FINAL DETAILS ARE CONFIRMED:
Write one short friendly closing sentence, then on the NEXT line output exactly one raw JSON object with no markdown/code block:
{"order_complete": true, "customer_name": "...", "customer_phone": "...", "customer_city": "...", "customer_address": "..."}

Never output order_complete before all four values are present and the final details have been confirmed.`;
}

function parseOrderCompletion(text: string): OrderDetails | null {
  const jsonMatch = text.match(/\{[\s\S]*"order_complete"[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.order_complete) return null;

    return {
      customerName: parsed.customer_name || '',
      customerPhone: parsed.customer_phone || '',
      customerCity: parsed.customer_city || '',
      customerAddress: parsed.customer_address || '',
    };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, sessionId, productInfo } = body;

    if (!message || !sessionId) {
      return NextResponse.json(
        { error: 'Message and sessionId are required' },
        { status: 400 }
      );
    }

    if (terminatedSessions.has(sessionId)) {
      return NextResponse.json({
        reply: 'Is chat session ka waqt khatam ho gaya hai. Dobara order karne ke liye product page par wapas jayen.',
        orderComplete: false,
        sessionEnded: true,
      });
    }

    if (!sessions[sessionId]) {
      sessions[sessionId] = [];
    }

    const userTurns = sessions[sessionId].filter(item => item.role === 'user').length;
    if (userTurns >= MAX_USER_TURNS) {
      terminatedSessions.add(sessionId);
      delete sessions[sessionId];
      return NextResponse.json({
        reply: 'Janab, chat limit complete ho gayi hai. Agar order karna ho toh product page se dobara start karein. Shukriya!',
        orderComplete: false,
        sessionEnded: true,
      });
    }

    const lastAssistantMessage = [...sessions[sessionId]]
      .reverse()
      .find(item => item.role === 'assistant')?.content;

    const expectedField = detectExpectedField(lastAssistantMessage);
    const validationReply = validateExpectedInput(expectedField, String(message));

    if (validationReply) {
      sessions[sessionId].push({ role: 'user', content: String(message) });
      sessions[sessionId].push({ role: 'assistant', content: validationReply });
      return NextResponse.json({
        reply: validationReply,
        orderComplete: false,
      });
    }

    sessions[sessionId].push({ role: 'user', content: String(message) });

    const llmMessages: AIMessage[] = [
      { role: 'system', content: getSystemPrompt(productInfo || {}) },
      ...sessions[sessionId],
    ];

    const aiReply = await callAI(llmMessages);
    sessions[sessionId].push({ role: 'assistant', content: aiReply });

    const endedMatch = aiReply.match(/\{"conversation_ended"\s*:\s*true[^}]*\}/);
    if (endedMatch) {
      terminatedSessions.add(sessionId);
      delete sessions[sessionId];
      const cleanReply = aiReply.replace(/\{"conversation_ended"[^}]*\}/, '').trim();
      return NextResponse.json({
        reply: cleanReply,
        orderComplete: false,
        sessionEnded: true,
      });
    }

    const parsedOrderData = parseOrderCompletion(aiReply);

    if (parsedOrderData) {
      const validatedOrder = validateOrderData(parsedOrderData);

      if (!validatedOrder.valid) {
        sessions[sessionId][sessions[sessionId].length - 1] = {
          role: 'assistant',
          content: validatedOrder.reply,
        };

        return NextResponse.json({
          reply: validatedOrder.reply,
          orderComplete: false,
        });
      }

      const orderData = validatedOrder.data;
      const order = await db.order.create({
        data: {
          sessionId,
          productName: productInfo?.productName || 'Unknown Product',
          color: productInfo?.color || null,
          size: productInfo?.size || null,
          price: productInfo?.price || null,
          customerName: orderData.customerName,
          customerPhone: orderData.customerPhone,
          customerCity: orderData.customerCity,
          customerAddress: orderData.customerAddress,
          chatHistory: JSON.stringify(sessions[sessionId]),
          status: 'pending',
        },
      });

      const cleanReply = aiReply.replace(/\{[\s\S]*"order_complete"[\s\S]*\}/, '').trim();

      return NextResponse.json({
        reply: cleanReply,
        orderComplete: true,
        order: {
          id: order.id,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          customerCity: order.customerCity,
          customerAddress: order.customerAddress,
          productName: order.productName,
          color: order.color,
          size: order.size,
          price: order.price,
          whatsappLink: `https://wa.me/${STORE_OWNER_WHATSAPP}?text=${encodeURIComponent(
            `NEW ORDER - Sparrow Official\n\n` +
              `Product: ${order.productName}\n` +
              `${order.color ? `Color: ${order.color}\n` : ''}` +
              `${order.size ? `Size: ${order.size}\n` : ''}` +
              `${order.price ? `Price: Rs.${order.price}\n` : ''}\n` +
              `Name: ${order.customerName}\n` +
              `Phone: ${order.customerPhone}\n` +
              `City: ${order.customerCity}\n` +
              `Address: ${order.customerAddress}\n\n` +
              `Order ID: ${order.id}\n` +
              `Time: ${new Date().toLocaleString('en-PK')}`
          )}`,
        },
      });
    }

    return NextResponse.json({
      reply: aiReply,
      orderComplete: false,
    });
  } catch (error: unknown) {
    console.error('Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error: ' + errorMessage },
      { status: 500 }
    );
  }
}
