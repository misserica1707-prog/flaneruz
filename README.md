<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>
# Security configuration

Before deploying, create a private `.env` file or configure these values in your hosting provider's secret manager:

```env
TELEGRAM_BOT_TOKEN="new token from BotFather"
TELEGRAM_ADMIN_CHAT_ID="your chat id"
ADMIN_ACCESS_CODE="a long unique access code"
ADMIN_SESSION_SECRET="a different random secret of at least 32 characters"
ADMIN_EMAIL_ALLOWLIST="owner@example.com,manager@example.com"
```

The admin page is unavailable until all three `ADMIN_*` values are configured. The email field is an allow-list check; it does not itself prove access to that inbox. Use an email OTP provider or a full identity service if you need mailbox verification.
# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/ed8fd516-c842-4b2b-955b-977ca8bcbbb8

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
# flaneruz
