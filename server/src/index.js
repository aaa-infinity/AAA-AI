/**
 * AAA-AI Telegram bot server (Cloudflare Workers, free tier).
 *
 * Why a server (and not the app) holds bot tokens:
 *   Telegram bot tokens must stay server-side. The Android app never sees them.
 *   Telegram pushes updates to this Worker via webhooks (a public URL), which is
 *   free-tier friendly (no polling / cron required).
 *
 * Two bots:
 *   - AAA_Free_Ai_bot : relays a chat message to the free-AI endpoints and replies.
 *   - AAA_Login_bot   : issues a short-lived link code the app can show/verify.
 *
 * Secrets (set with `wrangler secret put`, never committed):
 *   FREE_AI_BOT_TOKEN, LOGIN_BOT_TOKEN, FELIX_BASE (optional override)
 *
 * KV (AAA_KV) holds pending login codes.
 */

const FELIX_BASE = (typeof FELIX_BASE_OVERRIDE !== "undefined" && FELIX_BASE_OVERRIDE) ||
  "https://felix-rdx-unlimited-free-apis.vercel.app/api/v1/api";

const TELEGRAM_API = "https://api.telegram.org/bot";

/** Send a text message back to a Telegram chat. */
async function tgSend(token, chatId, text) {
  const url = `${TELEGRAM_API}${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

/** Call a free-AI endpoint and return the (normalized) text. */
async function callFreeAi(endpoint, q) {
  const url = `${FELIX_BASE}/${endpoint}?q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { Accept: "*/*" } });
    const raw = await res.text();
    // Strip common wrappers best-effort.
    try {
      const obj = JSON.parse(raw);
      for (const k of ["result", "response", "text", "output", "answer"]) {
        if (obj[k] != null) return String(obj[k]);
      }
    } catch (_) { /* not json */ }
    return raw.slice(0, 4000);
  } catch (e) {
    return "⚠️ Free-AI request failed. Try again later.";
  }
}

/** Handle an update for the free-AI relay bot. */
async function handleFreeAi(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  if (text.startsWith("/start")) {
    await tgSend(FREE_AI_BOT_TOKEN, chatId,
      "*AAA Free AI*\nSend any message and I'll answer using the free AI endpoints.\nExample: `hello`");
    return;
  }
  await tgSend(FREE_AI_BOT_TOKEN, chatId, "🤖 Thinking…");
  const reply = await callFreeAi("gemini", text);
  await tgSend(FREE_AI_BOT_TOKEN, chatId, reply);
}

/** Handle an update for the login/link bot. */
async function handleLogin(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  if (text.startsWith("/start")) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const expires = Date.now() + 10 * 60 * 1000;
    await AAA_KV.put(`login:${code}`, String(chatId), { expirationTtl: 600 });
    await tgSend(LOGIN_BOT_TOKEN, chatId,
      "*AAA Login*\nYour link code:\n`" + code + "`\n\nOpen AAA-AI → Profile → Link Telegram and enter this code (valid 10 min).");
    return;
  }
  await tgSend(LOGIN_BOT_TOKEN, chatId, "Send /start to get a link code.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Telegram webhooks
    if (request.method === "POST" && url.pathname === "/telegram/free") {
      const update = await request.json().catch(() => ({}));
      await handleFreeAi(update);
      return new Response("ok");
    }
    if (request.method === "POST" && url.pathname === "/telegram/login") {
      const update = await request.json().catch(() => ({}));
      await handleLogin(update);
      return new Response("ok");
    }

    // App-facing: verify a login code -> returns chatId (app can then link the account).
    if (request.method === "GET" && url.pathname === "/api/verify") {
      const code = url.searchParams.get("code");
      if (!code) return new Response(JSON.stringify({ ok: false, error: "missing code" }), { status: 400 });
      const chatId = await AAA_KV.get(`login:${code.toUpperCase()}`);
      if (!chatId) return new Response(JSON.stringify({ ok: false, error: "invalid or expired code" }));
      return new Response(JSON.stringify({ ok: true, chatId }));
    }

    return new Response("AAA-AI bot server. POST /telegram/free or /telegram/login for webhooks.", {
      headers: { "content-type": "text/plain" },
    });
  },
};
