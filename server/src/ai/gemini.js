import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { SYSTEM_PROMPT } from './prompts.js';

let client = null;
let model = null;

function getModel() {
  if (!model && config.ai.google.apiKey) {
    client = new GoogleGenerativeAI(config.ai.google.apiKey);
    model = client.getGenerativeModel({
      model: config.ai.google.model,
      systemInstruction: SYSTEM_PROMPT
    });
  }
  return model;
}

export async function analyzeWithGemini(prompt) {
  const gemini = getModel();

  if (!gemini) {
    throw new Error('Gemini API key not configured. Set GOOGLE_AI_API_KEY in .env');
  }

  const startTime = Date.now();

  const result = await gemini.generateContent(prompt);
  const response = result.response;

  const duration = Date.now() - startTime;

  const content = response.text();

  // Try to parse as JSON
  let parsed = null;
  try {
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      content.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1]);
    }
  } catch (e) {
    // Keep as text if not valid JSON
  }

  // Gemini usage metadata
  const usage = response.usageMetadata || {};

  return {
    provider: 'gemini',
    model: config.ai.google.model,
    content,
    parsed,
    tokensUsed: {
      input: usage.promptTokenCount || 0,
      output: usage.candidatesTokenCount || 0,
      total: usage.totalTokenCount || 0
    },
    durationMs: duration
  };
}

export function isGeminiAvailable() {
  return !!config.ai.google.apiKey;
}
