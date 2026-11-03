const env = require('../config/env');
const { HttpError } = require('../utils/http');

/// Low-level DeepSeek chat-completion call that returns parsed JSON.
/// DeepSeek is OpenAI-compatible: POST {baseUrl}/chat/completions with a Bearer
/// key. JSON mode needs response_format json_object AND the prompt to ask for
/// JSON (the system prompt here does).
async function chatJSON({ system, user, temperature = 0.4, maxTokens = 4000 }) {
  if (!env.deepseek.apiKey) {
    throw new HttpError(
      503,
      'AI is not configured. Set DEEPSEEK_API_KEY (or AI_MOCK=true for local testing).',
      'AI_NOT_CONFIGURED'
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.deepseek.timeoutMs);

  let res;
  try {
    res = await fetch(`${env.deepseek.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.deepseek.apiKey}`,
      },
      body: JSON.stringify({
        model: env.deepseek.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new HttpError(
      502,
      err.name === 'AbortError' ? 'AI request timed out' : 'Could not reach the AI service',
      'AI_UPSTREAM_ERROR'
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(502, `AI service error (${res.status})`, 'AI_UPSTREAM_ERROR', text.slice(0, 500));
  }

  const payload = await res.json();
  const content = payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : '';

  try {
    return JSON.parse(content);
  } catch (err) {
    throw new HttpError(502, 'AI returned a non-JSON response', 'AI_BAD_RESPONSE');
  }
}

module.exports = { chatJSON };
