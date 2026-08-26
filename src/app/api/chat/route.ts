import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ============================================
// CONFIGURATION — Change these before deploying
// ============================================
const STORE_OWNER_WHATSAPP = '923001234567'; // Your WhatsApp number (92 + number without 0)
// API key rotation — add up to 3 keys for 3x free daily quota (1500 req/day)
const GEMINI_API_KEYS = [
  process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || '',
  process.env.GEMINI_API_KEY_2 || '',
  process.env.GEMINI_API_KEY_3 || '',
].filter(k => k.trim() !== '');

if (GEMINI_API_KEYS.length === 0) {
  console.error('No Gemini API keys configured!');
}

let currentKeyIndex = 0;
function getNextApiKey(): string {
  const key = GEMINI_API_KEYS[currentKeyIndex % GEMINI_API_KEYS.length];
  currentKeyIndex++;
  return key;
}

const GEMINI_MODEL = 'gemini-3.1-flash-lite';

// In-memory session store for conversation history
const sessions: Record<string, Array<{role: string; content: string}>> = {};
// Track terminated sessions — no more API calls allowed
const terminatedSessions = new Set<string>();
// Max messages before hard-stopping to save credits (10 = ~10 API calls per chat)
const MAX_MESSAGES = 10;

function getSystemPrompt(productInfo: {
  productName: string;
  color?: string;
  size?: string;
  price?: string;
}): string {
  return `You are "Sparrow" — a friendly, helpful order assistant for Sparrow Official (sparrowofficial.pk), a Pakistani clothing brand. You speak in a mix of Urdu and English (Roman Urdu) — exactly how Pakistanis casually chat on WhatsApp.

Your ONLY job is to collect order information from the customer for this specific product:
- Product: ${productInfo.productName}
${productInfo.color ? `- Color: ${productInfo.color}` : ''}
${productInfo.size ? `- Size: ${productInfo.size}` : ''}
${productInfo.price ? `- Price: Rs.${productInfo.price}` : ''}

You must collect these 4 pieces of information:
1. **Name** - Customer's full name (at least 2 words, only letters and spaces)
2. **Phone Number** - Pakistani mobile number (must be exactly 11 digits starting with 03, like 0312-3456789 or 03123456789)
3. **City** - Delivery city (a real Pakistani city name)
4. **Full Address** - Complete delivery address with area/sector details (at least 10 characters)

**CONVERSATION FLOW:**
- Start with a warm greeting, mention the product they're ordering
- Ask questions ONE AT A TIME — don't overwhelm the customer
- Always address the customer with respect: use "Aap", "Janab", "Bhai/Behen Ji" — NEVER use casual "tu" or "tum"
- Use phrases like "Ji bilkul", "Shukriya Janab", "Theek hai Ji", "Zaroor" naturally
- If they give multiple pieces of info in one message, acknowledge all of them
- Keep messages short (1-3 sentences max) — this is a chat, not an email

**STRICT VALIDATION RULES — Apply these BEFORE accepting any field:**
- **Phone Number Validation:** 
  - MUST be exactly 11 digits
  - MUST start with "03" (Pakistani mobile numbers)
  - Remove dashes/spaces when counting digits (e.g., "0312-3456789" = 11 digits ✓)
  - If the number has fewer than 11 digits, is missing leading zero, or doesn't start with 03, REJECT it and ask again politely
  - Example: "0334013916" = only 10 digits = INVALID — ask them to re-enter
  - Example: "03341234567" = 11 digits starting with 03 = VALID ✓
- **Name Validation:** Must have at least 2 words (first + last name). If only one word, ask for full name.
- **City Validation:** Must be a recognizable Pakistani city. If unclear, confirm with the customer.
- **Address Validation:** Must be detailed enough (house/flat number, street, area). If too vague (less than 10 characters), ask for more details.

**HANDLING ABUSE & RUDENESS:**
- If the customer uses abusive language, insults, or is rude — DO NOT respond with anger or rudeness
- Politely say something like: "Janab, hum aapki madad karna chahte hain. Meherbani farma kar theek se baat karein."
- Give them ONE more chance. If they continue being abusive, end the conversation gracefully:
  Respond with EXACTLY: {"conversation_ended": true, "reason": "abuse"}
  With a closing message BEFORE the JSON: "Janab, hum aapki service karne mein khushi mahsoos karte, lekin is tarah baat karna mumkin nahi. Allah Hafiz."

**HANDLING OFF-TOPIC / TIME-WASTING:**
- If the customer repeatedly goes off-topic (asks unrelated questions, chats randomly, ignores the order process), steer them back politely max 2 times
- After 2 failed redirects, end the conversation:
  Respond with EXACTLY: {"conversation_ended": true, "reason": "off_topic"}
  With a closing message BEFORE the JSON: "Janab lagta hai abhi order nahi karna. Jab chahein toh wapas aayen, hum haazir hain! Allah Hafiz."
- DO NOT entertain general chatting, jokes, or debates — stay focused on the order

**IMPORTANT RULES:**
- DO NOT ask about size, color, or quantity — those are already selected on the product page
- DO NOT discuss other products or redirect to the website
- DO NOT make up prices or delivery charges
- If customer asks about delivery, say: "Cash on delivery available all over Pakistan! Next day delivery within major cities."
- If customer asks about exchange/return, say: "7 days easy exchange policy hai. Size issue ho toh bata dein, replacement bhej dein ge."

**WHEN ALL 4 FIELDS ARE COLLECTED AND VALIDATED:**
Once you have valid name, phone, city, and address — respond with EXACTLY this JSON format (no markdown, no code blocks, just the raw JSON):
{"order_complete": true, "customer_name": "...", "customer_phone": "...", "customer_city": "...", "customer_address": "..."}

Also add a friendly closing message BEFORE the JSON, like:
"Shukriya bhai! Aapka order note kar liya hai. Abhi aapko order summary mil raha hai."

Then on the NEXT LINE put the JSON.

Just output it as plain text after your message.`;
}

function parseOrderCompletion(text: string): Record<string, string> | null {
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
    // JSON parse failed
  }
  return null;
}

async function callGeminiAPI(messages: Array<{role: string; content: string}>): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set. Add it to your .env file.');
  }

  // Convert our message format to Gemini format
  // First message is system prompt, rest are user/assistant
  const systemPrompt = messages[0]?.content || '';
  const conversationHistory = messages.slice(1);

  // Build Gemini contents array
  const contents: Array<{role: string; parts: Array<{text: string}>}> = [];
  
  for (const msg of conversationHistory) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  const apiKey = getNextApiKey();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorData}`);
  }

  const data = await response.json();
  const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!aiReply) {
    throw new Error('Gemini returned empty response');
  }

  return aiReply;
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

    // Block terminated sessions — no credits wasted
    if (terminatedSessions.has(sessionId)) {
      return NextResponse.json({
        reply: 'Is chat session ka waqt khatam ho gaya hai. Dobara order karne ke liye product page par wapas jayen.',
        orderComplete: false,
        sessionEnded: true,
      });
    }

    // Initialize session if needed
    if (!sessions[sessionId]) {
      sessions[sessionId] = [];
    }

    // Hard message limit — terminate session to save credits
    if (sessions[sessionId].length >= MAX_MESSAGES) {
      terminatedSessions.add(sessionId);
      delete sessions[sessionId];
      return NextResponse.json({
        reply: 'Janab, bohat der ho gayi hai. Agar order karna ho toh product page se dobara start karein. Shukriya!',
        orderComplete: false,
        sessionEnded: true,
      });
    }

    // Add user message to history
    sessions[sessionId].push({ role: 'user', content: message });

    // Build messages for LLM
    const systemPrompt = getSystemPrompt(productInfo || {});
    const llmMessages: Array<{role: string; content: string}> = [
      { role: 'system', content: systemPrompt },
      ...sessions[sessionId],
    ];

    // Call Gemini API
    const aiReply = await callGeminiAPI(llmMessages);

    // Add assistant reply to history
    sessions[sessionId].push({ role: 'assistant', content: aiReply });

    // Check if AI ended conversation (abuse or off-topic)
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

    // Check if order is complete
    const orderData = parseOrderCompletion(aiReply);

    let order = null;
    if (orderData) {
      // Save order to database
      order = await db.order.create({
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

      // Clean the AI reply - remove JSON from display text
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