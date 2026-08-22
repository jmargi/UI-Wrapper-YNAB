// ─────────────────────────────────────────────────────────────────────────────
// LLM provider abstraction
//
// Default provider is Ollama (local, free, private — financial data never leaves
// the machine). Anthropic remains available by setting LLM_PROVIDER=anthropic.
//
// Runtime model switching: the active model is stored in the settings table
// (key "llm_model") and overrides OLLAMA_MODEL. Change it via POST /api/agent/model.
// ─────────────────────────────────────────────────────────────────────────────
import { getSetting, setSetting } from './db.js';

const PROVIDER     = (process.env.LLM_PROVIDER || 'ollama').toLowerCase();
const OLLAMA_HOST  = (process.env.OLLAMA_HOST  || 'http://localhost:11434').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

export function getProvider() {
  return PROVIDER;
}

export function getActiveModel() {
  return getSetting('llm_model') || DEFAULT_MODEL;
}

export function setActiveModel(model) {
  setSetting('llm_model', model);
  return getActiveModel();
}

// List models the Ollama server has pulled and can serve right now.
export async function listModels() {
  if (PROVIDER !== 'ollama') return [];
  const res = await fetch(`${OLLAMA_HOST}/api/tags`);
  if (!res.ok) throw new Error(`Ollama not reachable at ${OLLAMA_HOST} (${res.status})`);
  const data = await res.json();
  return (data.models || []).map((m) => ({
    name: m.name,
    size: m.size,
    family: m.details?.family,
    parameter_size: m.details?.parameter_size,
  }));
}

export async function getStatus() {
  if (PROVIDER === 'anthropic') {
    const configured = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'YOUR_KEY_HERE');
    return { provider: 'anthropic', configured, model: 'claude-sonnet-4-6', host: null };
  }
  // ollama
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/version`, { signal: AbortSignal.timeout(2000) });
    const reachable = res.ok;
    let hasModel = false;
    if (reachable) {
      try {
        const models = await listModels();
        const active = getActiveModel();
        // match exact name or family prefix (qwen2.5 matches qwen2.5:7b)
        hasModel = models.some((m) => m.name === active || m.name.startsWith(`${active.split(':')[0]}`));
      } catch { /* ignore */ }
    }
    return { provider: 'ollama', configured: reachable, model: getActiveModel(), host: OLLAMA_HOST, reachable, hasModel };
  } catch {
    return { provider: 'ollama', configured: false, model: getActiveModel(), host: OLLAMA_HOST, reachable: false, hasModel: false };
  }
}

// Convert Anthropic-style tool defs → Ollama/OpenAI function-tool format.
function toOllamaTools(tools = []) {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// streamChat — one round-trip. Streams assistant text via onText, returns the
// final { content, toolCalls } so the caller can run an agentic tool loop.
//
// messages are in Ollama-native format:
//   { role: 'user'|'assistant'|'tool'|'system', content, tool_calls? }
// returned toolCalls: [{ name, arguments }]
// ─────────────────────────────────────────────────────────────────────────────
// Cap on generated tokens per round-trip — keeps answers short and cheap.
// Enough for a ~10-row table; raise via LLM_MAX_TOKENS if answers get cut off.
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 700);

export async function streamChat({ system, messages, tools, onText, signal }) {
  if (PROVIDER === 'anthropic') {
    throw new Error('streamChat: anthropic path uses the SDK directly; use ollama or extend here.');
  }

  const body = {
    model: getActiveModel(),
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    stream: true,
    options: { temperature: 0.3, num_predict: MAX_TOKENS },
  };
  if (tools?.length) body.tools = toOllamaTools(tools);

  // signal aborts the request mid-stream — Ollama stops generating immediately.
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${text || res.statusText}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  let content   = '';
  let toolCalls = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      let chunk;
      try { chunk = JSON.parse(line); } catch { continue; }

      const msg = chunk.message;
      if (msg?.content) {
        content += msg.content;
        onText?.(msg.content);
      }
      if (msg?.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          toolCalls.push({
            name: tc.function?.name,
            // Ollama returns arguments already parsed as an object
            arguments: typeof tc.function?.arguments === 'string'
              ? safeParse(tc.function.arguments)
              : (tc.function?.arguments || {}),
          });
        }
      }
    }
  }

  return { content, toolCalls };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateJSON — non-streaming, forces JSON output. Used by categorize/insights.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateJSON({ system, prompt }) {
  if (PROVIDER === 'anthropic') {
    throw new Error('generateJSON: anthropic path uses the SDK directly; use ollama or extend here.');
  }

  const messages = system
    ? [{ role: 'system', content: system }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];

  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: getActiveModel(), messages, stream: false, format: 'json', options: { temperature: 0, num_predict: Math.max(MAX_TOKENS, 1500) } }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${text || res.statusText}`);
  }

  const data = await res.json();
  return data.message?.content ?? '';
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
