require('dotenv').config();
const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 4173;
const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

const SYSTEM_PROMPT = 'You are Nova, a helpful, friendly AI assistant embedded in a chat app. Keep replies clear and concise, and use markdown (bold, code blocks) when it helps.';

// If the upstream API goes quiet (no bytes at all, or a stall mid-stream) for longer than this, give up
// rather than leaving the user's chat stuck on a typing indicator forever.
const WATCHDOG_MS = 20000;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function sendEvent(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** A timer that aborts `controller` if not reset within `ms`. */
function createWatchdog(ms, controller) {
  let timer = setTimeout(() => controller.abort(new Error('watchdog-timeout')), ms);
  return {
    reset() {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error('watchdog-timeout')), ms);
    },
    clear() { clearTimeout(timer); },
  };
}

/** Reads an SSE upstream body, extracting a text delta from each JSON record via `extractText`. */
async function pipeSSE(upstream, res, extractText, watchdog) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    watchdog.reset();
    const { value, done } = await reader.read();
    if (done) break;
    // Normalize CRLF: some providers (Gemini) separate SSE records with "\r\n\r\n" rather than "\n\n".
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const record = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const dataLine = record.split('\n').find(line => line.startsWith('data:'));
      if (!dataLine) continue;

      const payload = dataLine.slice(5).trim();
      if (payload === '[DONE]') continue;

      try {
        const json = JSON.parse(payload);
        const delta = extractText(json);
        if (delta) sendEvent(res, null, { text: delta });
      } catch {
        // Ignore partial/non-JSON keep-alive chunks from the upstream stream.
      }
    }
  }
}

async function upstreamErrorDetail(upstream) {
  try {
    const body = await upstream.json();
    return (body && body.error && body.error.message) ? body.error.message : JSON.stringify(body);
  } catch {
    try { return await upstream.text(); } catch { return ''; }
  }
}

/** Runs one provider call end-to-end: fetch (with timeout/abort), error reporting, and SSE relay. */
async function runProviderStream({ providerName, url, options, res, extractText }) {
  const controller = new AbortController();
  const watchdog = createWatchdog(WATCHDOG_MS, controller);
  // res (not req) 'close' fires if the client disconnects before we finish; writableEnded
  // guards against the event that also fires on our own normal res.end().
  const onClientClose = () => {
    if (!res.writableEnded) controller.abort(new Error('client-closed'));
  };
  res.on('close', onClientClose);

  try {
    let upstream;
    try {
      upstream = await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        sendEvent(res, 'error', { message: `${providerName} did not respond in time. Please try again.` });
      } else {
        sendEvent(res, 'error', { message: `Could not reach ${providerName}. Check your internet connection and try again.` });
      }
      return;
    }

    if (!upstream.ok || !upstream.body) {
      watchdog.reset();
      const detail = await upstreamErrorDetail(upstream).catch(() => '');
      sendEvent(res, 'error', { message: `${providerName} returned an error (${upstream.status}): ${String(detail).slice(0, 300)}` });
      return;
    }

    try {
      await pipeSSE(upstream, res, extractText, watchdog);
    } catch (err) {
      const message = err.name === 'AbortError'
        ? `${providerName} stopped responding mid-reply. Please try again.`
        : 'The response stream was interrupted.';
      sendEvent(res, 'error', { message });
    }
  } finally {
    watchdog.clear();
    res.off('close', onClientClose);
  }
}

function streamFromOpenAI(history, res) {
  if (!OPENAI_API_KEY) {
    sendEvent(res, 'error', { message: 'The server has no OPENAI_API_KEY configured. Add one to .env (see .env.example) and restart the server.' });
    return Promise.resolve();
  }

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];

  return runProviderStream({
    providerName: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages, stream: true, temperature: 0.7 }),
    },
    res,
    extractText: json => json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content,
  });
}

function streamFromGemini(history, res) {
  if (!GEMINI_API_KEY) {
    sendEvent(res, 'error', { message: 'The server has no GEMINI_API_KEY configured. Get a free key at https://aistudio.google.com/apikey, add it to .env (see .env.example), and restart the server.' });
    return Promise.resolve();
  }

  const contents = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(GEMINI_API_KEY)}`;

  return runProviderStream({
    providerName: 'Gemini',
    url,
    options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents }),
    },
    res,
    extractText: json => {
      const candidate = json.candidates && json.candidates[0];
      const part = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];
      return part && part.text;
    },
  });
}

app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const incoming = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  const history = incoming
    .filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .slice(-30)
    .map(m => ({ role: m.role, content: m.content }));

  if (history.length === 0) {
    sendEvent(res, 'error', { message: 'No message to respond to.' });
    return res.end();
  }

  if (PROVIDER === 'openai') {
    await streamFromOpenAI(history, res);
  } else {
    await streamFromGemini(history, res);
  }
  res.end();
});

app.listen(PORT, () => {
  console.log(`Nova is running at http://localhost:${PORT} (provider: ${PROVIDER})`);
});
