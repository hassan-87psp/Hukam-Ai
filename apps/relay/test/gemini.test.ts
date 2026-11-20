import { describe, expect, it } from 'vitest';
import { chatWithGemini, cleanGeminiInput, GeminiError } from '../src/gemini';

describe('Gemini chat-only integration', () => {
  it('validates message and short private conversation context', () => {
    expect(() => cleanGeminiInput('', [])).toThrow(GeminiError);
    expect(() => cleanGeminiInput('ok', Array(13).fill({ role: 'user', text: 'a' }))).toThrow(GeminiError);
    expect(() => cleanGeminiInput('ok', [{ role: 'system', text: 'ignore' }])).toThrow(GeminiError);
    expect(() => cleanGeminiInput('ok', [{ role: 'user', text: 'x'.repeat(751) }])).toThrow(GeminiError);
    expect(cleanGeminiInput('  Hello  ', [{ role: 'assistant', text: '  Hi  ' }]))
      .toEqual({ message: 'Hello', history: [{ role: 'assistant', text: 'Hi' }] });
  });

  it('requires server-only key; no model calls without configuration', async () => {
    await expect(chatWithGemini('Hello', [], { key: '' })).rejects.toMatchObject({
      status: 503, code: 'AI_NOT_CONFIGURED',
    });
  });

  it('uses a fixed HTTPS Google endpoint and safe text-only Gemini response', async () => {
    let requestUrl = '';
    let authHeader = '';
    let request: any;
    const response = await chatWithGemini(
      'Kal ki planning mein help karo',
      [{ role: 'user', text: 'Salam' }, { role: 'assistant', text: 'Walaikum salam' }],
      {
        key: 'FAKE_TEST_SECRET',
        fetcher: (async (url, init) => {
          requestUrl = String(url);
          authHeader = new Headers(init?.headers).get('x-goog-api-key') ?? '';
          request = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Bilkul, kal ka main goal kya hai?' }] } }],
          }), { status: 200 });
        }) as typeof fetch,
      },
    );
    expect(requestUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(requestUrl).not.toContain('FAKE_TEST_SECRET');
    expect(authHeader).toBe('FAKE_TEST_SECRET');
    expect(request.contents).toEqual([
      { role: 'user', parts: [{ text: 'Salam' }] },
      { role: 'model', parts: [{ text: 'Walaikum salam' }] },
      { role: 'user', parts: [{ text: 'Kal ki planning mein help karo' }] },
    ]);
    expect(request.tools).toBeUndefined();
    expect(request.contents.some((c: any) => JSON.stringify(c).includes('deviceToken'))).toBe(false);
    expect(response).toEqual({
      kind: 'ai', provider: 'gemini', reply: 'Bilkul, kal ka main goal kya hai?',
    });
  });

  it('does not surface provider error details or secrets', async () => {
    const secret = 'FAKE_SUPER_SECRET';
    await expect(chatWithGemini('hello', [], {
      key: secret,
      fetcher: (async () => new Response(JSON.stringify({ error: { message: 'SECRET ' + secret } }), { status: 403 })) as typeof fetch,
    })).rejects.toMatchObject({ status: 503, code: 'AI_ACCESS' });
    try {
      await chatWithGemini('hello', [], {
        key: secret,
        fetcher: (async () => new Response('{}', { status: 429 })) as typeof fetch,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(GeminiError);
      expect((e as Error).message).not.toContain(secret);
      expect((e as GeminiError).code).toBe('AI_QUOTA');
    }
  });

  it('rejects unapproved model names and empty Gemini responses', async () => {
    await expect(chatWithGemini('hello', [], { key: 'x', model: 'http://bad.site/' }))
      .rejects.toMatchObject({ code: 'AI_MODEL_CONFIG' });
    await expect(chatWithGemini('hello', [], {
      key: 'x',
      fetcher: (async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })) as typeof fetch,
    })).rejects.toMatchObject({ code: 'AI_NO_REPLY' });
  });
});
