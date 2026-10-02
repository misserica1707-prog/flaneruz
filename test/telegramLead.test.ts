// Mini App <-> backend contract: what the client sends to POST /api/leads and how it reads Telegram's initData.
// The backend is the only trust boundary: it verifies the initData signature. The client must forward the raw,
// signed string untouched and never invent identity fields of its own.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { getTelegramInitData } from '../src/utils/telegram.ts';
import { postLead, type LeadRequest } from '../src/utils/leadApi.ts';

const request: LeadRequest = {
  firstName: 'Анна', lastName: 'Иванова', phone: '+998 90 123 45 67', comment: '',
  items: [{ productId: 'p-a', quantity: 2 }], idempotencyKey: 'lead-key-12345678'
};

const created = () =>
  new Response(JSON.stringify({ leadNumber: 'FL-TEST0001', status: 'new', createdAt: new Date().toISOString(), itemsTotal: 1, items: [], replayed: false }),
    { status: 201, headers: { 'Content-Type': 'application/json' } });

/** A fake fetch that records the call it received. */
function recorder() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return created(); }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('postLead -> backend contract', () => {
  it('sends to the configured backend origin, without cookies', async () => {
    const { calls, impl } = recorder();
    await postLead(request, impl, 'https://flaner.onrender.com');
    assert.equal(calls[0].url, 'https://flaner.onrender.com/api/leads');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.credentials, 'omit');
  });

  it('uses a same-origin path when no backend origin is configured (dev proxy)', async () => {
    const { calls, impl } = recorder();
    await postLead(request, impl);
    assert.equal(calls[0].url, '/api/leads');
  });

  it('forwards the raw signed initData byte for byte', async () => {
    const initData = 'query_id=AAH&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22A%22%7D&auth_date=1700000000&hash=' + 'a'.repeat(64);
    const { calls, impl } = recorder();
    await postLead({ ...request, initData }, impl, 'https://x.test');
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.initData, initData);
  });

  it('omits initData entirely for a plain web visitor, and never sends identity or source fields', async () => {
    const { calls, impl } = recorder();
    await postLead(request, impl, 'https://x.test');
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal('initData' in body, false);
    for (const forbidden of ['source', 'telegramId', 'telegram_id', 'telegramUsername', 'user']) {
      assert.equal(forbidden in body, false, `${forbidden} must come from the verified initData on the server, not from the client`);
    }
  });
});

describe('getTelegramInitData', () => {
  const g = globalThis as { window?: unknown };
  const original = g.window;
  afterEach(() => { if (original === undefined) delete g.window; else g.window = original; });

  it('is empty outside a browser', () => {
    delete g.window;
    assert.equal(getTelegramInitData(), '');
  });

  it('is empty in a normal browser tab (no Telegram SDK data)', () => {
    g.window = { Telegram: { WebApp: { initData: '' } } };
    assert.equal(getTelegramInitData(), '');
    g.window = {};
    assert.equal(getTelegramInitData(), '');
  });

  it('returns the raw signed string inside Telegram and ignores initDataUnsafe', () => {
    g.window = { Telegram: { WebApp: { initData: 'user=%7B%7D&hash=abc', initDataUnsafe: { user: { id: 999 } } } } };
    assert.equal(getTelegramInitData(), 'user=%7B%7D&hash=abc');
  });

  it('ignores non-string values', () => {
    g.window = { Telegram: { WebApp: { initData: { evil: true } } } };
    assert.equal(getTelegramInitData(), '');
  });

  it('is read at call time, never cached', () => {
    g.window = { Telegram: { WebApp: { initData: 'first' } } };
    assert.equal(getTelegramInitData(), 'first');
    g.window = { Telegram: { WebApp: { initData: 'second' } } };
    assert.equal(getTelegramInitData(), 'second');
  });
});
