# flaneruz — Flaner Telegram Mini App

Customer storefront that opens inside Telegram (bot `@flaneruz_bot`). It is a **static single-page app with no
backend of its own**: the catalog and the leads ("заявки") live in the Flaner backend, the same one that serves the
main site and its admin panel.

```
 Telegram client
      │  opens the Mini App (static site)
      ▼
┌──────────────────────────┐        HTTPS + CORS (no cookies)        ┌──────────────────────────────────────┐
│ flaneruz (this repo)     │ ──────────────────────────────────────► │ Flaner backend (Render)              │
│  React + Vite SPA        │   GET  /api/products                    │  /api/products   ← Postgres catalog  │
│  cart + favorites kept   │   POST /api/leads {items, contacts,     │  /api/leads      ← Postgres leads    │
│  on the device           │        idempotencyKey, initData}        │   └ verifies initData (HMAC, bot token)│
└──────────────────────────┘                                         │     ✔ valid  → source = telegram    │
                                                                     │     ✘ else   → source = web (guest)  │
                                                                     └──────────────────────────────────────┘
```

## What the Mini App does

- **Catalog**: `GET {API}/api/products`. There is no bundled product list, so prices and stock are never stale.
- **Cart**: stored on the device as `{ productId, quantity }`; names, images and prices are always joined from the live catalog.
- **Lead**: `POST {API}/api/leads` with the contacts, the cart lines, an idempotency key and Telegram's raw `initData`.
  The cart is emptied only after the server accepted the lead; on any failure it is kept and the shopper can retry
  (the same idempotency key is reused, so a retry never creates a duplicate).
- No payment, no delivery, no admin panel. Staff work with leads in the main site's admin panel.

## How Telegram identity is protected

The client never decides who the shopper is. It forwards `Telegram.WebApp.initData` untouched, read at submit time,
and sends **no** `source`, `telegramId` or `username` fields. The backend
(`server/src/modules/leads/telegramAuth.ts` in the Flaner repo) verifies the HMAC signature with the bot token and the
age of `auth_date` (24 h by default). Only then the lead gets `source = 'telegram'`, `telegram_id` and `telegram_username`.
Invalid, tampered, expired, other-bot or missing `initData` is not an error: the lead is accepted as a plain `web` guest.
`initDataUnsafe` is used only to pre-fill the name fields of the form.

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | build time of this app | Backend origin, e.g. `https://flaner.onrender.com` (no trailing slash needed). |
| `CORS_ORIGINS` | **backend** service | Must contain this Mini App's origin (comma separated), otherwise browsers block its requests. |
| `TELEGRAM_BOT_TOKEN` | **backend** service | Token of the bot that opens the Mini App. It is what makes `initData` verifiable. |

`VITE_*` values are public: never put a secret in them. This app holds no secrets.

## Run locally

```bash
cp .env.example .env.local   # point VITE_API_BASE_URL at a running Flaner backend, e.g. http://localhost:3000
npm install
npm run dev                  # http://localhost:5174
```

For the browser to accept the backend's answers, run the backend with
`CORS_ORIGINS=http://localhost:5174` (in `NODE_ENV=production`) or leave it in development mode, where only
`http://localhost:5173` is allowed implicitly, so add `http://localhost:5174` to `CORS_ORIGINS` as well.

```bash
npm run lint    # type check
npm test        # unit tests (cart, phone, lead request contract, initData handling)
npm run build   # static files in dist/
```

## Deploy

Publish `dist/` on any static host (for example a Render Static Site: build `npm ci && npm run build`, publish
directory `dist`, env `VITE_API_BASE_URL`). Then, in BotFather, set the Mini App / menu button URL to the site's
HTTPS address, and add that origin to `CORS_ORIGINS` on the Flaner backend.
