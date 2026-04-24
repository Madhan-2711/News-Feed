import OpenAI from 'openai';

// Cerebras uses the OpenAI-compatible API — no extra SDK needed.
// Single key only: Cerebras is fast enough (2000+ tok/s) that key rotation
// is unnecessary and risks ToS violations.
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || '';

const MODEL = 'llama-3.3-70b'; // Cerebras hosted Llama 3.3 70B

function getClient() {
  if (!CEREBRAS_API_KEY) throw new Error('No Cerebras API key configured (CEREBRAS_API_KEY)');
  return new OpenAI({
    apiKey: CEREBRAS_API_KEY,
    baseURL: 'https://api.cerebras.ai/v1',
  });
}

/**
 * Generate content. keyIndex param kept for API compatibility with route.js
 * but is ignored — single key is sufficient at Cerebras speeds.
 */
export async function generateWithKey(prompt, keyIndex = 0) {
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 6000,
  });
  return completion.choices[0]?.message?.content || '';
}

/**
 * Generate content (single call). Alias of generateWithKey.
 */
export async function generateWithRetry(prompt) {
  return generateWithKey(prompt, 0);
}

/**
 * Returns 1 — single key, no rotation needed at Cerebras speeds.
 */
export function getKeyCount() {
  return 1;
}

/**
 * Quick health check — tests the key and returns status.
 */
export async function checkAllKeys() {
  const masked = CEREBRAS_API_KEY
    ? CEREBRAS_API_KEY.slice(0, 10) + '...' + CEREBRAS_API_KEY.slice(-4)
    : '(not set)';
  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: 'Say ok' }],
      max_tokens: 5,
    });
    const text = completion.choices[0]?.message?.content || '';
    return [{ index: 0, key: masked, status: 'ok', response: text }];
  } catch (err) {
    return [{
      index: 0,
      key: masked,
      status: 'error',
      code: err.status,
      message: err.message?.slice(0, 100),
    }];
  }
}

export const keys = [CEREBRAS_API_KEY].filter(Boolean);
