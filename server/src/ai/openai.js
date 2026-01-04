import OpenAI from 'openai';
import { config } from '../config.js';
import { SYSTEM_PROMPT } from './prompts.js';

let client = null;

function getClient() {
  if (!client && config.ai.openai.apiKey) {
    client = new OpenAI({
      apiKey: config.ai.openai.apiKey
    });
  }
  return client;
}

export async function analyzeWithOpenAI(prompt) {
  const openai = getClient();

  if (!openai) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in .env');
  }

  const startTime = Date.now();

  const response = await openai.chat.completions.create({
    model: config.ai.openai.model,
    max_tokens: 4096,
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const duration = Date.now() - startTime;

  const content = response.choices[0]?.message?.content || '';

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

  return {
    provider: 'openai',
    model: config.ai.openai.model,
    content,
    parsed,
    tokensUsed: {
      input: response.usage?.prompt_tokens || 0,
      output: response.usage?.completion_tokens || 0,
      total: response.usage?.total_tokens || 0
    },
    durationMs: duration
  };
}

export function isOpenAIAvailable() {
  return !!config.ai.openai.apiKey;
}
