import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ============================================
// CONFIGURATION — Change these before deploying
// ============================================
const STORE_OWNER_WHATSAPP = '923001234567'; // Your WhatsApp number (92 + number without 0)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';

// In-memory session store for conversation history
const sessions: Record<string, Array<{role: string; content: string}>> = {};

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
1. **Name** - Customer's full name
2. **Phone Number** - Their contact number (Pakistani format like 03XX-XXXXXXX)
3. **City** - Delivery city
4. **Full Address** - Complete delivery address with area/sector details

**CONVERSATION FLOW:**
- Start with a warm greeting, mention the product they're ordering
- Ask questions ONE AT A TIME — don't overwhelm the customer
- Be conversational and friendly, like a real shopkeeper talking to a customer
- Use phrases like "Bhai", "Ji", "Sure", "Theek hai", "Shukriya" naturally
- If they give multiple pieces of info in one message, acknowledge all of them
- Keep messages short (1-3 sentences max) — this is a chat, not an email

**IMPORTANT RULES:**
- DO NOT ask about size, color, or quantity — those are already selected on the product page
- DO NOT discuss other products or redirect to the website
- DO NOT make up prices or delivery charges
- If customer asks about delivery, say: "Cash on delivery available all over Pakistan! Next day delivery within major cities."
- If customer asks about exchange/return, say: "7 days easy exchange policy hai. Size issue ho toh bata dein, replacement bhej dein ge."

**WHEN ALL 4 FIELDS ARE COLLECTED:**
Once you have name, phone, city, and address — respond with EXACTLY this JSON format (no markdown, no code blocks, just the raw JSON):
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    // Initialize session if needed
    if (!sessions[sessionId]) {
      sessions[sessionId] = [];
    }

    // Add user message to history
    sessions[sessionId].push({ role: 'user', content: message });

    // Keep only last 20 messages for context window
    if (sessions[sessionId].length > 20) {
      sessions[sessionId] = sessions[sessionId].slice(-20);
    }

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