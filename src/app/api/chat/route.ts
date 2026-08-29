import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const STORE_OWNER_WHATSAPP = '923001234567';

function normalizeApiKey(value?: string): string {
  let key = (value || '').trim();
  key = key.replace(/^["']|["']$/g, '');
  key = key.replace(/^Bearer\s+/i, '');
  key = key.replace(/^GEMINI_API_KEY(?:_[123])?\s*=\s*/i, '');
  return key.trim();
}

const GEMINI_API_KEYS = [
  process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || '',
  process.env.GEMINI_API_KEY_2 || '',
  process.env.GEMINI_API_KEY_3 || '',
]
  .map(normalizeApiKey)
  .filter(Boolean);

if (GEMINI_API_KEYS.length === 0) {
  console.error('No Gemini API keys configured!');
}

let currentKeyIndex = 0;
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

const sessions: Record<string, Array<{ role: string; content: string }>> = {};
const terminatedSessions = new Set<string>();

// Count CUSTOMER turns only. Previously both user + assistant messages were counted,
// which made a normal name/phone/city/address flow expire too early.
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
  return parts.length >= 2 && /^[\p{L} .'-]+$/u.test(name) && name.length >= 5;
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
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
  const hasLetter = /\p{L}/u.test(address);
  return address.length >= 12 && words.length >= 3 && hasLetter;
}

function detectExpectedField(lastAssistantMessage?: string): ExpectedField {
  if (!lastAssistantMessage) return null;
  const text = lastAssistantMessage.toLowerCase();

  if (/address|house|flat|street|mukammal address|poora address/.test(text)) return 'address';
  if (/city|shehar/.test(text)) return 'city';
  if (/phone|mobile|contact number|mobile number|11-digit/.test(text)) return 'phone';
  if (/full name|poora naam|pura naam|naam bata|aapka naam/.test(text)) return 'name';

  return null;
}

function validateExpectedInput(field: ExpectedField, value: string): string | null {
  if (!field) return null;

  if (field === 'name' && !isValidName(value)) {
    return 'Janab, naam verify nahi ho raha. Meherbani karke apna poora naam first name aur last name ke saath likhein.';
  }

  if (field === 'phone' && !isValidPhone(value)) {
    return 'Meherbani farma kar sahi Pakistani mobile number dein: exactly 11 digits aur 03 se start hona chahiye, misal 03341234567.';
  }

  if (field === 'city') {
    if (!isValidCity(value)) {
      return 'City ka naam verify nahi ho raha. Meherbani karke apne shehar ka sahi naam dobara likhein.';
    }

    const suggestion = getCitySuggestion(value);
    if (suggestion) {
      const pretty = suggestion.replace(/\b\w/g, char => char.toUpperCase());
      return `City ka naam thora unclear hai. Kya aap ${pretty} kehna chah rahe hain? Please exact city name confirm karein.`;
    }
  }

  if (field === 'address' && !isValidAddress(value)) {
    return 'Address verify nahi ho raha. Please house/flat number, street/sector aur area ke saath mukammal address likhein.';
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
      reply: 'Janab, order complete karne se pehle aapka full name verify karna zaroori hai. Please first aur last name dono bhejein.',
    };
  }

  if (!isValidPhone(customerPhone)) {
    return {
      valid: false,
      reply: 'Aapka mobile number verify nahi hua. Please exactly 11-digit Pakistani number bhejein jo 03 se start ho.',
    };
  }

  if (!isValidCity(customerCity)) {
    return {
      valid: false,
      reply: 'Aapki city verify nahi ho saki. Please shehar ka sahi naam dobara bhejein.',
    };
  }

  const citySuggestion = getCitySuggestion(customerCity);
  if (citySuggestion) {
    const pretty = citySuggestion.replace(/\b\w/g, char => char.toUpperCase());
    return {
      valid: false,
      reply: `City ka naam verify karna hai. Kya aap ${pretty} kehna chah rahe hain? Please exact city name confirm karein.`,
    };
  }

  if (!isValidAddress(customerAddress)) {
    return {
      valid: false,
      reply: 'Aapka address incomplete lag raha hai. Please house/flat number, street/sector aur area ke saath mukammal address bhejein.',
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
  productName: string;
  color?: string;
  size?: string;
  price?: string;
}): string {
  return `You are "Sparrow" — a friendly, helpful order assistant for Sparrow Official (sparrowofficial.pk), a Pakistani clothing brand. You speak in a mix of Urdu and English (Roman Urdu) — exactly how Pakistanis casually chat on WhatsApp.

Your ONLY job is to collect order information from the customer for this specific product:
- Product: ${productInfo.productName || 'Selected Product'}
${productInfo.color ? `- Color: ${productInfo.color}` : ''}
${productInfo.size ? `- Size: ${productInfo.size}` : ''}
${productInfo.price ? `- Price: Rs.${productInfo.price}` : ''}

You must collect and VERIFY these 4 pieces of information:
1. **Name** - Customer's full name (at least 2 words, only letters/spaces/common name punctuation)
2. **Phone Number** - Pakistani mobile number (exactly 11 digits starting with 03)
3. **City** - A clearly identifiable Pakistani city/town
4. **Full Address** - Complete delivery address with house/flat, street/sector and area details

**VERY IMPORTANT VERIFICATION BEHAVIOR:**
- NEVER accept a field just because you can guess what the customer probably meant.
- Verify EACH field before moving to the next question.
- If there is a typo, ambiguity, missing digit, incomplete value, or something looks suspicious, ASK FOR CONFIRMATION instead of silently correcting it.
- Example: if customer writes "karahi", do NOT silently accept it as Karachi. Ask: "Kya aap Karachi kehna chah rahe hain? Please confirm."
- Example: a 10-digit phone number must be rejected even if it looks close to a valid number.
- Do not claim "confirm ho gaya" unless the value actually passes the rules.

**CONVERSATION FLOW:**
- Start with a warm greeting and mention the product they're ordering
- Ask questions ONE AT A TIME
- Always address the customer respectfully with "Aap", "Janab", "Bhai/Behen Ji" — NEVER use "tu" or "tum"
- Use phrases like "Ji bilkul", "Shukriya Janab", "Theek hai Ji", "Zaroor" naturally
- If they provide multiple valid pieces of information in one message, acknowledge them and only ask for what is still missing
- Keep messages short (1-3 sentences max)

**STRICT VALIDATION RULES:**
- Phone: remove spaces/dashes only for checking; final value must be exactly 11 digits and match 03XXXXXXXXX
- Name: minimum 2 words; if one word only, ask for full name
- City: must be clearly recognizable. For a likely misspelling or ambiguous city, ask the customer to confirm the exact city name
- Address: must be detailed enough for delivery; vague area-only addresses are not acceptable

**HANDLING ABUSE & RUDENESS:**
- Stay polite. Give one warning if abusive.
- If abuse continues, first write a short closing message and then on the next line output exactly:
{"conversation_ended": true, "reason": "abuse"}

**HANDLING OFF-TOPIC / TIME-WASTING:**
- Redirect back to the order process up to 2 times.
- If the customer keeps wasting time, first write a short closing message and then on the next line output exactly:
{"conversation_ended": true, "reason": "off_topic"}

**IMPORTANT RULES:**
- DO NOT ask about size, color, or quantity — those are already selected on the product page
- DO NOT discuss other products or redirect to the website
- DO NOT make up prices or delivery charges
- If customer asks about delivery, say: "Cash on delivery available all over Pakistan! Next day delivery within major cities."
- If customer asks about exchange/return, say: "7 days easy exchange policy hai. Size issue ho toh bata dein, replacement bhej dein ge."

**WHEN ALL 4 FIELDS ARE COLLECTED AND VERIFIED:**
Only after valid name, phone, city and address, first send a short friendly closing sentence and then on the next line output this raw JSON (no markdown/code block):
{"order_complete": true, "customer_name": "...", "customer_phone": "...", "customer_city": "...", "customer_address": "..."}

Never output order_complete until all four values have actually been verified.`;
}

function parseOrderCompletion(text: string): OrderDetails | null {
  const jsonMatch = text.match(/\{[\s\S]*"order_complete"[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.order_complete) {
      return {
        customerName: parsed.customer_name || '',
        customerPhone: parsed.customer_phone || '',
        customerCity: parsed.customer_city || '',
        customerAddress: parsed.customer_address || '',
      };
    }
  } catch {
    // Invalid completion JSON: continue the chat rather than creating an order.
  }

  return null;
}

async function callGeminiAPI(messages: Array<{ role: string; content: string }>): Promise<string> {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error(
      'No Gemini API keys are configured. Add GEMINI_API_KEY_1, GEMINI_API_KEY_2, or GEMINI_API_KEY_3 to your environment.'
    );
  }

  const systemPrompt = messages[0]?.content || '';
  const conversationHistory = messages.slice(1);
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  for (const msg of conversationHistory) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  const requestBody = JSON.stringify({
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 500,
    },
  });

  const startIndex = currentKeyIndex % GEMINI_API_KEYS.length;
  currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
  const failures: string[] = [];

  for (let attempt = 0; attempt < GEMINI_API_KEYS.length; attempt++) {
    const keyIndex = (startIndex + attempt) % GEMINI_API_KEYS.length;
    const apiKey = GEMINI_API_KEYS[keyIndex];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: requestBody,
      }
    );

    if (response.ok) {
      const data = await response.json();
      const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!aiReply) {
        throw new Error('Gemini returned empty response');
      }

      return aiReply;
    }

    const errorData = await response.text();
    failures.push(`key ${keyIndex + 1}: HTTP ${response.status}`);
    console.error(
      `Gemini API key ${keyIndex + 1} failed with HTTP ${response.status}:`,
      errorData.slice(0, 500)
    );

    if (![401, 403, 429].includes(response.status)) {
      throw new Error(`Gemini API error (${response.status}): ${errorData}`);
    }
  }

  throw new Error(
    `All configured Gemini API keys failed (${failures.join(', ')}). Regenerate the keys in Google AI Studio and update the Vercel environment variables.`
  );
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

    const systemPrompt = getSystemPrompt(productInfo || {});
    const llmMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...sessions[sessionId],
    ];

    const aiReply = await callGeminiAPI(llmMessages);
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
        // Replace Gemini's invalid completion JSON in history with the corrective
        // response so the next turn continues naturally instead of thinking the order finished.
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
              `${order.price ? `Price: Rs.${order.price}\n` : ''}\n\n` +
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
