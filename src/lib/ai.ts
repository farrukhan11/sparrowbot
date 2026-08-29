export type AIMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

function normalizeSecret(value?: string): string {
  let secret = (value || '').trim();
  secret = secret.replace(/^["']|["']$/g, '');
  secret = secret.replace(/^Bearer\s+/i, '');
  secret = secret.replace(/^(?:GROQ_API_KEY|GEMINI_API_KEY(?:_[123])?)\s*=\s*/i, '');
  return secret.trim();
}

const GROQ_API_KEY = normalizeSecret(process.env.GROQ_API_KEY);

// Both models are available on Groq's free plan. Qwen has the larger daily
// token allowance; Llama provides a production-model fallback with a much
// larger requests-per-day allowance. GROQ_MODEL can still override priority.
const DEFAULT_GROQ_MODELS = [
  'qwen/qwen3.8-27b',
  'llama-3.1-8b-instant',
];

const GROQ_MODELS = [
  process.env.GROQ_MODEL?.trim(),
  ...DEFAULT_GROQ_MODELS,
].filter((model, index, models): model is string =>
  Boolean(model) && models.indexOf(model) === index
);

const GEMINI_API_KEYS = [
  process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || '',
  process.env.GEMINI_API_KEY_2 || '',
  process.env.GEMINI_API_KEY_3 || '',
]
  .map(normalizeSecret)
  .filter(Boolean);

const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';
let currentGeminiKeyIndex = 0;

function compactMessages(messages: AIMessage[]): AIMessage[] {
  const system = messages.find(message => message.role === 'system');
  const conversation = messages.filter(message => message.role !== 'system');

  // Standard checkout fits inside this window. Keeping only recent turns stops
  // long/off-topic sessions from repeatedly sending thousands of old tokens.
  const recentConversation = conversation.slice(-12);

  return system ? [system, ...recentConversation] : recentConversation;
}

async function callGroqModel(model: string, messages: AIMessage[]): Promise<string> {
  const requestBody: Record<string, unknown> = {
    model,
    messages: compactMessages(messages),
    temperature: 0.35,
    max_tokens: 300,
  };

  // Qwen supports non-thinking mode, which is ideal for short order-chat replies.
  if (model === 'qwen/qwen3.8-27b') {
    requestBody.reasoning_effort = 'none';
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 700)}`);
  }

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error('invalid JSON response');
  }

  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error('empty response');
  }

  const usage = data?.usage;
  if (usage) {
    console.log(
      `Groq ${model} usage: prompt=${usage.prompt_tokens ?? '-'}, completion=${usage.completion_tokens ?? '-'}, total=${usage.total_tokens ?? '-'}`
    );
  }

  return reply;
}

async function callGroq(messages: AIMessage[]): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const failures: string[] = [];

  for (const model of GROQ_MODELS) {
    try {
      return await callGroqModel(model, messages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      failures.push(`${model}: ${message}`);
      console.error(`Groq model ${model} failed; trying next free model:`, message);
    }
  }

  throw new Error(`All Groq models failed (${failures.join(' | ')})`);
}

async function callGemini(messages: AIMessage[]): Promise<string> {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error('No Gemini fallback API keys are configured');
  }

  const compacted = compactMessages(messages);
  const systemPrompt = compacted.find(message => message.role === 'system')?.content || '';
  const conversation = compacted
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

  const requestBody = JSON.stringify({
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: conversation,
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 300,
    },
  });

  const startIndex = currentGeminiKeyIndex % GEMINI_API_KEYS.length;
  currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
  const failures: string[] = [];

  for (let attempt = 0; attempt < GEMINI_API_KEYS.length; attempt++) {
    const keyIndex = (startIndex + attempt) % GEMINI_API_KEYS.length;
    const apiKey = GEMINI_API_KEYS[keyIndex];

    try {
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

      const responseText = await response.text();

      if (!response.ok) {
        failures.push(`key ${keyIndex + 1}: HTTP ${response.status}`);
        console.error(
          `Gemini fallback key ${keyIndex + 1} failed with HTTP ${response.status}:`,
          responseText.slice(0, 500)
        );
        continue;
      }

      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch {
        failures.push(`key ${keyIndex + 1}: invalid JSON`);
        continue;
      }

      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!reply) {
        failures.push(`key ${keyIndex + 1}: empty response`);
        continue;
      }

      return reply;
    } catch (error) {
      failures.push(`key ${keyIndex + 1}: network error`);
      console.error(`Gemini fallback key ${keyIndex + 1} request failed:`, error);
    }
  }

  throw new Error(`All Gemini fallback keys failed (${failures.join(', ')})`);
}

export async function callAI(messages: AIMessage[]): Promise<string> {
  const providerErrors: string[] = [];

  if (GROQ_API_KEY) {
    try {
      return await callGroq(messages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Groq error';
      providerErrors.push(message);
      console.error('All Groq free models failed, trying Gemini fallback:', message);
    }
  } else {
    providerErrors.push('GROQ_API_KEY is not configured');
  }

  if (GEMINI_API_KEYS.length > 0) {
    try {
      return await callGemini(messages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Gemini error';
      providerErrors.push(message);
    }
  } else {
    providerErrors.push('No Gemini fallback keys are configured');
  }

  throw new Error(`No AI provider succeeded. ${providerErrors.join(' | ')}`);
}
