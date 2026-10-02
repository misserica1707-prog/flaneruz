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

## Production

Production URL (the Mini App origin): **https://flaneruz.onrender.com** (HTTPS is provided by Render). This is the URL
`@flaneruz_bot` opens (BotFather menu button), and it is the value the backend needs in `CORS_ORIGINS`.

It runs as a Render Web Service built from this repository:

| Setting | Value |
|---|---|
| Build Command | `npm install && npm run build` (or `npm ci && npm run build`) |
| Start Command | `npm start` (serves `dist/` with `vite preview` on `$PORT`) |
| Branch | `main` |
| Env | none required. `VITE_API_BASE_URL` defaults to `https://flaner.onrender.com` from `.env.production`; a value in the dashboard overrides it. |

The build fails on purpose when the backend URL is missing, is not https (http is allowed for localhost only) or has a path.
The old secrets of the previous Express version (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `ADMIN_*`, `GEMINI_API_KEY`,
`APP_URL`) are not used any more and should be removed from this service.

### Release order (matters)

1. **Backend first.** On the Flaner backend service add `https://flaneruz.onrender.com` to `CORS_ORIGINS` (keep existing
   values, comma separated, no trailing slash) and confirm `TELEGRAM_BOT_TOKEN` is the token of `@flaneruz_bot`. Wait for the
   restart. Until this is done the new Mini App cannot read the catalog (the browser blocks it).
2. **Then the Mini App.** Merge to `main`; Render builds and deploys. Open the site and check that the catalog loads.
3. **Smoke test in Telegram.** Send one lead from the real bot and check in the admin panel that it has source *Telegram*.
4. **Cleanup.** Remove the unused secrets from this service (see above).

Rollback: Render dashboard, this service, *Events/Deploys*: redeploy the previous successful deploy.

A Render **Static Site** (free, never sleeps) would also work for this app (build `npm ci && npm run build`, publish `dist`,
rewrite `/*` to `/index.html`); the origin and the CORS value would then be that site's URL.
