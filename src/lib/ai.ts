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
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || 'qwen/qwen3.8-27b';

const GEMINI_API_KEYS = [
  process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || '',
  process.env.GEMINI_API_KEY_2 || '',
  process.env.GEMINI_API_KEY_3 || '',
]
  .map(normalizeSecret)
  .filter(Boolean);

const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';
let currentGeminiKeyIndex = 0;

async function callGroq(messages: AIMessage[]): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.5,
      max_tokens: 500,
      reasoning_effort: 'none',
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Groq API error (${response.status}): ${responseText.slice(0, 1000)}`);
  }

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error('Groq returned invalid JSON');
  }

  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error('Groq returned an empty response');
  }

  return reply;
}

async function callGemini(messages: AIMessage[]): Promise<string> {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error('No Gemini fallback API keys are configured');
  }

  const systemPrompt = messages.find(message => message.role === 'system')?.content || '';
  const conversation = messages
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
      temperature: 0.5,
      maxOutputTokens: 500,
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
      console.error('Groq primary provider failed, trying Gemini fallback:', message);
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
