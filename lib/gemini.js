import OpenAI from 'openai';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || '';

/**
 * Configure provider pool with free/low-cost models
 */
function getProviders() {
  const pool = [];

  if (OPENROUTER_API_KEY) {
    pool.push({
      name: 'OpenRouter (Free Pool)',
      client: new OpenAI({
        apiKey: OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://newsfeed.local',
          'X-Title': 'NewsFeed',
        },
      }),
      model: 'openrouter/free',
      key: OPENROUTER_API_KEY,
    });
  }

  if (GROQ_API_KEY) {
    pool.push({
      name: 'Groq (Qwen 27B)',
      client: new OpenAI({
        apiKey: GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
      }),
      model: 'qwen/qwen3.8-27b',
      key: GROQ_API_KEY,
    });
  }

  if (OPENAI_API_KEY) {
    pool.push({
      name: 'OpenAI (GPT-4o mini)',
      client: new OpenAI({
        apiKey: OPENAI_API_KEY,
      }),
      model: 'gpt-4o-mini',
      key: OPENAI_API_KEY,
    });
  }

  return pool;
}

// Global round-robin index to distribute load across providers
let currentProviderIndex = 0;

/**
 * Generate content using round-robin distribution with automatic failover.
 * Distributes requests evenly across OpenRouter, Groq, and OpenAI to prevent hitting rate limits.
 */
export async function generateWithKey(prompt, keyIndex = 0) {
  const providers = getProviders();
  if (providers.length === 0) {
    throw new Error('No AI providers configured in environment variables');
  }

  // Start with the next provider in round-robin order
  const startIndex = currentProviderIndex % providers.length;
  currentProviderIndex = (currentProviderIndex + 1) % providers.length;

  let lastError = null;

  // Try each provider starting from startIndex, wrapping around if needed
  for (let i = 0; i < providers.length; i++) {
    const providerIdx = (startIndex + i) % providers.length;
    const provider = providers[providerIdx];

    try {
      const completion = await provider.client.chat.completions.create({
        model: provider.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
      });

      const responseText = completion.choices[0]?.message?.content || '';
      if (responseText) {
        return responseText;
      }
    } catch (err) {
      console.warn(`[AI Pool] Provider "${provider.name}" failed: ${err.message}. Rotating to next available provider...`);
      lastError = err;
    }
  }

  throw lastError || new Error('All AI providers in the pool failed to respond');
}

/**
 * Generate content (single call). Alias of generateWithKey.
 */
export async function generateWithRetry(prompt) {
  return generateWithKey(prompt, 0);
}

/**
 * Returns number of active providers in pool.
 */
export function getKeyCount() {
  return getProviders().length;
}

/**
 * Health check: tests all configured providers and returns their individual statuses.
 */
export async function checkAllKeys() {
  const providers = getProviders();
  const results = [];

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    const masked = p.key ? p.key.slice(0, 10) + '...' + p.key.slice(-4) : '(not set)';
    try {
      const completion = await p.client.chat.completions.create({
        model: p.model,
        messages: [{ role: 'user', content: 'Say ok' }],
        max_tokens: 5,
      });
      const text = completion.choices[0]?.message?.content || '';
      results.push({
        index: i,
        provider: p.name,
        key: masked,
        status: 'ok',
        response: text.trim(),
      });
    } catch (err) {
      results.push({
        index: i,
        provider: p.name,
        key: masked,
        status: 'error',
        code: err.status,
        message: err.message?.slice(0, 100),
      });
    }
  }

  return results;
}

export const keys = [OPENROUTER_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, CEREBRAS_API_KEY].filter(Boolean);
