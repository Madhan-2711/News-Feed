// ── Local Vector Embeddings via Transformers.js ──────────────────
// Uses all-MiniLM-L6-v2 (22MB, 384 dims) to embed text locally.
// No API calls, no cost, runs in-process on Vercel serverless.
//
// The model is downloaded to /tmp on first cold start (~10-15s),
// then cached in memory for subsequent requests.

import { pipeline, env } from '@huggingface/transformers';

// Configure Transformers.js for serverless
env.useBrowserCache = false;
env.useCustomCache = false;
// Allow remote model download on first run
env.allowRemoteModels = true;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

// Singleton: model loads once, stays in memory across requests
let embeddingPipeline = null;

async function getPipeline() {
  if (!embeddingPipeline) {
    console.log('[embeddings] Loading MiniLM model (first run only)...');
    const startTime = Date.now();
    embeddingPipeline = await pipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8', // quantized — smaller + faster
    });
    console.log(`[embeddings] Model loaded in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  }
  return embeddingPipeline;
}

/**
 * Embed a single text string → 384-dim float array
 * @param {string} text - Text to embed (title + description, ~200 chars ideal)
 * @returns {Promise<number[]>} - 384-dimensional vector
 */
export async function embedText(text) {
  const pipe = await getPipeline();
  // Truncate to ~512 tokens (~256 words) for MiniLM's context window
  const truncated = (text || '').slice(0, 1000);
  const output = await pipe(truncated, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Embed multiple texts in one pass for efficiency.
 * @param {string[]} texts - Array of text strings
 * @returns {Promise<number[][]>} - Array of 384-dim vectors
 */
export async function embedBatch(texts) {
  const pipe = await getPipeline();
  const results = [];
  // Process individually to avoid memory spikes on Vercel (2GB limit)
  for (const text of texts) {
    const truncated = (text || '').slice(0, 1000);
    const output = await pipe(truncated, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data));
  }
  return results;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns value between -1 and 1 (1 = identical, 0 = unrelated).
 * Since MiniLM outputs are already normalized, dot product = cosine similarity.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}
