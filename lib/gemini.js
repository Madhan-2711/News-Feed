import Groq from 'groq-sdk';

// Parse all keys from comma-separated env variable
const keys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '')
  .split(',').map(k => k.trim()).filter(Boolean);

const MODEL = 'llama-3.3-70b-versatile';

/**
 * Generate content using a specific Groq key by index.
 * Used to pin parallel batches to different keys simultaneously.
 */
export async function generateWithKey(prompt, keyIndex = 0) {
  if (!keys.length) throw new Error('No Groq API keys configured');

  const key = keys[keyIndex % keys.length];
  const groq = new Groq({ apiKey: key });

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 6000,
  });

  return completion.choices[0]?.message?.content || '';
}

/**
 * Generate content using round-robin key rotation (single calls).
 * For parallel batch workloads, prefer generateWithKey() instead.
 */
let currentIndex = 0;
export async function generateWithRetry(prompt) {
  const idx = currentIndex;
  currentIndex = (currentIndex + 1) % Math.max(keys.length, 1);
  return generateWithKey(prompt, idx);
}

/**
 * Returns the total number of configured API keys.
 * Use this to know how many truly parallel batches you can run.
 */
export function getKeyCount() {
  return keys.length;
}

/**
 * Quick health check — tests each key and returns status
 */
export async function checkAllKeys() {
  const results = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const masked = key.slice(0, 10) + '...' + key.slice(-4);
    try {
      const groq = new Groq({ apiKey: key });
      const completion = await groq.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: 'Say ok' }],
        max_tokens: 5,
      });
      const text = completion.choices[0]?.message?.content || '';
      results.push({ index: i, key: masked, status: 'ok', response: text });
    } catch (err) {
      results.push({
        index: i,
        key: masked,
        status: 'error',
        code: err.status,
        message: err.message?.slice(0, 100),
      });
    }
  }
  return results;
}

export { keys };
