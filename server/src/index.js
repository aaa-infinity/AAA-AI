/**
 * Ari AI server (Cloudflare Workers, free tier) — ES module format.
 *
 * Server-side only. Privileged credentials are SECRETS (never in code/APK):
 *   FREE_AI_BOT_TOKEN, LOGIN_BOT_TOKEN,
 *   SUPABASE_URL, SUPABASE_ANON, SUPABASE_SERVICE_ROLE,
 *   APP_SHARED_SECRET, FELIX_BASE
 *
 * 1. @AAA_Free_Ai_bot -> relays chat to free-AI endpoints, replies.
 * 2. @AAA_Login_bot   -> /start issues a 10-min KV link code.
 * 3. /api/verify      -> app verifies a link code (returns chatId).
 * 4. /api/points/add  -> server-side points credit (D1 authoritative wallet +
 *                         Supabase mirror), guarded by APP_SHARED_SECRET.
 */

const TELEGRAM_API = "https://api.telegram.org/bot";
// R2 object key for the downloadable Android APK (uploaded when the app is ready).
const APK_KEY = "app/aaa-ai.apk";
// Public "AAA FREE AI" Telegram channel (overridable via ENV.CHANNEL_ID secret).
const DEFAULT_CHANNEL_ID = "-1003932377927";
// Points charged per free-AI bot message (deducted server-side from the linked wallet).
const BOT_MSG_COST = 10;
// Daily free messages a Telegram user gets before points start being charged.
const BOT_DAILY_FREE = 15;

// Mirror schema SQL, embedded so the admin bot can send it to a phone.
const MIRROR_SQL = `
create table if not exists public.users (
  uid text primary key, points integer not null default 100,
  premium_until bigint not null default 0, email text, display_name text,
  lifetime_earned integer not null default 0,
  updated_at timestamptz not null default now(), created_at timestamptz not null default now());
create table if not exists public.promo_codes (
  code text primary key, premium_days integer not null default 7,
  max_redemptions integer not null default 30, redeemed integer not null default 0,
  expires_at bigint not null default 0, active boolean not null default true,
  created_at timestamptz not null default now());
create table if not exists public.promo_redemptions (
  code text not null, uid text not null, ts bigint not null, primary key (code, uid));
create table if not exists public.yt_subs (
  uid text primary key, subscribed boolean not null default false, checked_at bigint not null);
create table if not exists public.transactions (
  id bigserial primary key, uid text not null, type text not null,
  amount integer not null, reason text, ts bigint not null);
create index if not exists idx_users_premium on public.users(premium_until);
create index if not exists idx_promo_redeem_uid on public.promo_redemptions(uid);
create index if not exists idx_tx_uid on public.transactions(uid);
alter table public.users enable row level security;
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.yt_subs enable row level security;
alter table public.transactions enable row level security;
create or replace function public.aaa_provision_mirror() returns void language plpgsql as $$
begin
  create table if not exists public.users (uid text primary key, points integer not null default 100, premium_until bigint not null default 0, email text, display_name text, lifetime_earned integer not null default 0, updated_at timestamptz not null default now(), created_at timestamptz not null default now());
  create table if not exists public.promo_codes (code text primary key, premium_days integer not null default 7, max_redemptions integer not null default 30, redeemed integer not null default 0, expires_at bigint not null default 0, active boolean not null default true, created_at timestamptz not null default now());
  create table if not exists public.promo_redemptions (code text not null, uid text not null, ts bigint not null, primary key (code, uid));
  create table if not exists public.yt_subs (uid text primary key, subscribed boolean not null default false, checked_at bigint not null);
  create table if not exists public.transactions (id bigserial primary key, uid text not null, type text not null, amount integer not null, reason text, ts bigint not null);
end; $$;
`;
// Module-scoped env (secrets + bindings) assigned at request start.
let ENV = {};

/** Branded, responsive, animated download landing page with live data. */
function downloadPage(available, versionName, sizeLabel, stats, changelog, qr) {
  stats = stats || {};
  const ver = versionName ? "v" + versionName : "";
  const cta = available
    ? '<a class="btn primary" href="/app.apk" id="dl">' +
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1zM5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/></svg>' +
      '<span>Download for Android' + (sizeLabel ? ' &middot; ' + sizeLabel : '') + '</span></a>'
    : '<span class="btn disabled">Coming soon</span>';

  // Live stat counters (animate up on load).
  const statItems = [
    [Math.max(stats.users || 0, 0), 'Users'],
    [Math.max(stats.points || 0, 0), 'Points earned'],
    [Math.max(stats.profiles || 0, 0), 'Telegram logins'],
    [6, 'AI tools'],
  ].map(function (s) {
    return '<div class="stat reveal"><div class="statn" data-to="' + s[0] + '">0</div>' +
      '<div class="statl">' + s[1] + '</div></div>';
  }).join('');

  const changeBlock = changelog
    ? '<div class="divider"></div>' +
      '<section><div class="wrap"><h2>What\u2019s new' + (ver ? ' \u00b7 ' + ver : '') + '</h2>' +
      '<p class="lead">Latest release notes.</p>' +
      '<div class="changelog reveal">' + htmlEscape(changelog).replace(/\n/g, '<br>') + '</div>' +
      '</div></section>'
    : '';

  const features = [
    ['🤖', 'AI Chat', 'Chat with top models — Gemini, Groq, DeepSeek & more, completely free.'],
    ['🎨', 'Image Generation', 'Turn text into stunning art and photos in seconds.'],
    ['⬇️', 'Downloaders', 'Grab media from your favorite platforms in one tap.'],
    ['🛠️', 'Creative Studio', 'OCR, lyrics, facts, search and dozens of AI tools.'],
    ['🎁', 'Daily Rewards', 'Earn points every day and unlock more with streaks & invites.'],
    ['🔒', 'Private & Secure', 'Telegram login, no spam, your data stays yours.'],
  ].map(function (f) {
    return '<div class="feature reveal"><div class="fi">' + f[0] + '</div>' +
      '<div><h3>' + f[1] + '</h3><p>' + f[2] + '</p></div></div>';
  }).join('');

  const steps = [
    ['1', 'Download the APK', 'Tap the download button above to get the latest build.'],
    ['2', 'Allow install', 'When prompted, enable “Install from unknown sources” for your browser.'],
    ['3', 'Open & sign in', 'Install, open Ari AI, and log in with Telegram to start.'],
  ].map(function (s) {
    return '<div class="step reveal"><div class="num">' + s[0] + '</div>' +
      '<div><h4>' + s[1] + '</h4><p>' + s[2] + '</p></div></div>';
  }).join('');

  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="theme-color" content="#0b0b13">' +
    '<meta name="description" content="Ari AI — unlimited free AI chat, image generation, downloaders and creative studio for Android.">' +
    '<meta property="og:title" content="Ari AI — Free AI Super App">' +
    '<meta property="og:description" content="Unlimited free AI chat, image generation & downloaders. Download for Android.">' +
    '<meta property="og:image" content="/api/asset/public/Logo.png">' +
    '<meta property="og:type" content="website">' +
    '<title>Ari AI — Free AI Super App for Android</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}:root{color-scheme:dark}' +
    'html{scroll-behavior:smooth}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#08080f;' +
    'color:#f2f2f7;line-height:1.55;-webkit-font-smoothing:antialiased}' +
    '.wrap{max-width:960px;margin:0 auto;padding:0 20px}' +
    'a{color:inherit;text-decoration:none}' +
    '.nav{position:sticky;top:0;z-index:20;backdrop-filter:blur(12px);' +
    'background:rgba(8,8,15,.7);border-bottom:1px solid rgba(255,255,255,.06)}' +
    '.nav .wrap{display:flex;align-items:center;justify-content:space-between;padding:12px 20px}' +
    '.brand{display:flex;align-items:center;gap:10px;font-weight:800}' +
    '.brand img{width:30px;height:30px;border-radius:8px}' +
    '.nav a.dl{background:linear-gradient(135deg,#7c4dff,#ff4d9d);padding:9px 18px;border-radius:50px;font-weight:700;font-size:.9rem}' +
    '.nav-actions{display:flex;align-items:center;gap:10px}' +
    '.nav-fb{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;' +
    'background:rgba(59,89,152,.18);border:1px solid rgba(59,89,152,.5);color:#9db4ff;font-weight:800;font-size:.95rem}' +
    '.nav-fb:hover{background:rgba(59,89,152,.32)}' +
    '/* premium */' +
    '.premium{position:relative;overflow:hidden;text-align:center;background:linear-gradient(135deg,rgba(124,77,255,.12),rgba(255,77,157,.12));' +
    'border:1px solid rgba(124,77,255,.25);border-radius:28px;padding:44px 24px;margin:0 0 0}' +
    '.premium::before{content:"";position:absolute;inset:0;z-index:-1;background:' +
    'radial-gradient(circle at 80% 20%,rgba(255,215,0,.18),transparent 55%)}' +
    '.premium h2{margin-bottom:8px}.premium .lead{margin-bottom:28px}' +
    '.pcols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;max-width:720px;margin:0 auto}' +
    '.pcol{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:18px}' +
    '.pcol h4{font-size:1rem;margin-bottom:4px}.pcol p{color:#a6a6b8;font-size:.86rem}' +
    '.ptag{display:inline-block;background:linear-gradient(135deg,#ffcf5c,#ff8fc0);color:#1a1024;font-weight:800;' +
    'padding:5px 14px;border-radius:50px;font-size:.85rem;margin-bottom:16px}' +
    '.pbtn{display:inline-block;margin-top:24px;background:linear-gradient(135deg,#ffcf5c,#ff8fc0);color:#1a1024;' +
    'font-weight:800;padding:14px 30px;border-radius:50px;font-size:1.02rem;transition:transform .15s,box-shadow .2s}' +
    '.pbtn:hover{transform:translateY(-2px);box-shadow:0 14px 30px rgba(255,143,192,.4)}' +
    '.pbtn small{display:block;font-weight:600;font-size:.78rem;opacity:.8}' +
    '/* testimonials */' +
    '.testi{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}' +
    '.tcard{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:20px;text-align:left}' +
    '.tcard .stars{color:#ffcf5c;margin-bottom:8px;letter-spacing:2px}' +
    '.tcard p{color:#c9c9d8;font-size:.92rem}.tcard .who{color:#9d9daf;font-size:.82rem;margin-top:10px}' +
    '/* community */' +
    '.community{text-align:center}' +
    '.fb{display:inline-flex;align-items:center;gap:10px;background:rgba(59,89,152,.16);border:1px solid rgba(59,89,152,.45);' +
    'color:#aebbff;padding:14px 26px;border-radius:50px;font-weight:700;font-size:1.02rem;transition:transform .15s,background .2s}' +
    '.fb:hover{transform:translateY(-2px);background:rgba(59,89,152,.28)}' +
    '.fb b{font-weight:800}' +
    '.safe{display:inline-flex;align-items:center;gap:6px;margin-top:14px;font-size:.82rem;color:#9be3a8;' +
    'background:rgba(40,180,99,.12);border:1px solid rgba(40,180,99,.35);padding:5px 14px;border-radius:50px}' +
    '.qr{display:inline-block;margin-top:22px;padding:10px;background:#fff;border-radius:20px;box-shadow:0 16px 40px rgba(0,0,0,.4);transition:transform .15s}' +
    '.qr:hover{transform:translateY(-3px)}' +
    '.qrlabel{margin-top:8px;font-size:.8rem;color:#9d9daf}' +
    '.faq{max-width:680px;margin:0 auto;text-align:left}' +
    '.faq details{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);' +
    'border-radius:14px;padding:14px 18px;margin-bottom:10px}' +
    '.faq summary{cursor:pointer;font-weight:700;color:#eef}' +
    '.faq p{color:#a6a6b8;font-size:.9rem;margin-top:8px}' +
    'footer a{color:#9d9daf;text-decoration:underline;margin:0 6px}' +
    '/* hero */' +
    '.hero{position:relative;overflow:hidden;text-align:center;padding:72px 20px 60px}' +
    '.hero::before{content:"";position:absolute;inset:-40% -20% auto -20%;height:520px;z-index:-1;' +
    'background:radial-gradient(circle at 30% 30%,rgba(124,77,255,.45),transparent 60%),' +
    'radial-gradient(circle at 70% 40%,rgba(255,77,157,.4),transparent 55%);' +
    'filter:blur(40px);animation:float 12s ease-in-out infinite}' +
    '@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(24px)}}' +
    '.logo{width:104px;height:104px;border-radius:28px;margin:0 auto 22px;display:block;' +
    'object-fit:cover;box-shadow:0 20px 50px rgba(124,77,255,.35)}' +
    'h1{font-size:clamp(2rem,6vw,3.2rem);font-weight:800;line-height:1.1;margin-bottom:14px}' +
    '.grad{background:linear-gradient(135deg,#a98bff,#ff8fc0);-webkit-background-clip:text;background-clip:text;color:transparent}' +
    '.sub{color:#b9b9c9;font-size:clamp(1rem,2.6vw,1.2rem);max-width:560px;margin:0 auto 28px}' +
    '.btn{display:inline-flex;align-items:center;gap:10px;padding:16px 30px;border-radius:50px;' +
    'font-weight:700;font-size:1.05rem;transition:transform .15s ease,box-shadow .15s ease}' +
    '.btn svg{flex:0 0 auto}' +
    '.btn.primary{background:linear-gradient(135deg,#7c4dff,#ff4d9d);color:#fff;box-shadow:0 12px 30px rgba(255,77,157,.35)}' +
    '.btn.primary:hover{transform:translateY(-2px);box-shadow:0 16px 38px rgba(255,77,157,.45)}' +
    '.btn.disabled{background:#26263a;color:#8a8aa0;cursor:not-allowed}' +
    '.meta{margin-top:14px;font-size:.85rem;color:#8a8aa0}' +
    '.badges{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:18px}' +
    '.badge{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);' +
    'padding:6px 14px;border-radius:50px;font-size:.8rem;color:#cfcfdd}' +
    '/* sections */' +
    'section{padding:56px 0}h2{font-size:clamp(1.5rem,4vw,2rem);text-align:center;margin-bottom:8px}' +
    '.lead{text-align:center;color:#9d9daf;margin-bottom:36px}' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}' +
    '.feature{display:flex;gap:14px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);' +
    'border-radius:18px;padding:20px;transition:border-color .2s,transform .2s}' +
    '.feature:hover{border-color:rgba(124,77,255,.5);transform:translateY(-3px)}' +
    '.fi{font-size:1.8rem;line-height:1}.feature h3{font-size:1.05rem;margin-bottom:4px}' +
    '.feature p{color:#a6a6b8;font-size:.9rem}' +
    '.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}' +
    '.step{display:flex;gap:14px;align-items:flex-start}' +
    '.num{flex:0 0 auto;width:38px;height:38px;border-radius:12px;display:flex;align-items:center;' +
    'justify-content:center;font-weight:800;background:linear-gradient(135deg,#7c4dff,#ff4d9d)}' +
    '.step h4{margin-bottom:2px}.step p{color:#a6a6b8;font-size:.9rem}' +
    '.tg{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}' +
    '.tg a{background:rgba(34,158,217,.14);border:1px solid rgba(34,158,217,.4);' +
    'padding:12px 22px;border-radius:50px;font-weight:600;color:#8fd0f0}' +
    '.tg a:hover{background:rgba(34,158,217,.24)}' +
    'footer{text-align:center;padding:40px 20px;color:#6f6f82;font-size:.85rem;border-top:1px solid rgba(255,255,255,.06)}' +
    '.divider{height:1px;background:rgba(255,255,255,.06);max-width:960px;margin:0 auto}' +
    '/* live stats */' +
    '.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:34px}' +
    '@media(max-width:560px){.stats{grid-template-columns:repeat(2,1fr)}}' +
    '.stat{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:18px 10px}' +
    '.statn{font-size:clamp(1.4rem,4vw,2rem);font-weight:800;' +
    'background:linear-gradient(135deg,#a98bff,#ff8fc0);-webkit-background-clip:text;background-clip:text;color:transparent}' +
    '.statl{color:#9d9daf;font-size:.8rem;margin-top:2px}' +
    '/* changelog */' +
    '.changelog{max-width:680px;margin:0 auto;background:rgba(255,255,255,.035);' +
    'border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:22px 24px;color:#c9c9d8;font-size:.95rem}' +
    '/* scroll reveal */' +
    '.reveal{opacity:0;transform:translateY(24px);transition:opacity .6s ease,transform .6s ease}' +
    '.reveal.in{opacity:1;transform:none}' +
    '@media(prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}.hero::before{animation:none}}' +
    '</style></head><body>' +
    '<nav class="nav"><div class="wrap"><div class="brand">' +
    '<img src="/api/asset/public/Logo.png" width="30" height="30" alt="">Ari AI</div>' +
    '<div class="nav-actions"><a class="nav-fb" href="https://www.facebook.com/share/1BzWH5P2bF/" target="_blank" rel="noopener">f</a>' +
    '<a class="dl" href="/app.apk">Get the app</a></div></div></nav>' +
    // hero
    '<header class="hero"><div class="wrap">' +
    '<img class="logo" src="/api/asset/public/Logo.png" width="104" height="104" alt="Ari AI logo">' +
    '<h1>Ari AI <span class="grad">Super App</span></h1>' +
    '<p class="sub">Unlimited free AI chat, image generation, downloaders &amp; a full creative studio — all in one beautiful Android app.</p>' +
    cta +
    '<div class="meta">Android 7.0+ &middot; ' + (ver || 'Free forever') + (available ? '' : ' &middot; releasing soon') + '</div>' +
    '<div class="safe">✓ Safe APK &middot; SHA-checked &middot; auto-updates</div>' +
    '<div class="badges"><span class="badge">100% Free</span><span class="badge">No ads paywall</span>' +
    '<span class="badge">Telegram login</span><span class="badge">Daily rewards</span></div>' +
    (qr ? '<a class="qr" href="/app.apk"><img src="' + qr + '" width="148" height="148" alt="Scan to install"></a>' +
      '<div class="qrlabel">Scan with your phone camera to install</div>' : '') +
    '<div class="stats">' + statItems + '</div>' +
    '</div></header>' +
    '<div class="divider"></div>' +
    // features
    '<section><div class="wrap"><h2 class="reveal">Everything you need</h2>' +
    '<p class="lead reveal">One app that replaces a dozen paid tools.</p>' +
    '<div class="grid">' + features + '</div></div></section>' +
    '<div class="divider"></div>' +
    // premium
    '<section><div class="wrap"><div class="premium reveal">' +
    '<span class="ptag">✨ Ari AI Premium</span>' +
    '<h2>Unlock the full power</h2>' +
    '<p class="lead">Faster models, HD image generation, zero limits and early access — for creators who go further.</p>' +
    '<div class="pcols">' +
    '<div class="pcol"><h4>⚡ Priority AI</h4><p>Skip queues with faster, higher-quality model routing.</p></div>' +
    '<div class="pcol"><h4>🖼 HD Images</h4><p>Generate crisp, high-resolution artwork and photos.</p></div>' +
    '<div class="pcol"><h4>🚀 No limits</h4><p>Higher daily caps across chat, tools and downloads.</p></div>' +
    '<div class="pcol"><h4>🎟 Early access</h4><p>Try new features and models before everyone else.</p></div>' +
    '</div>' +
    '<a class="pbtn" href="/app.apk">Get Ari AI Free<small>Premium unlocks inside the app</small></a>' +
    '</div></div></section>' +
    '<div class="divider"></div>' +
    // testimonials
    '<section><div class="wrap"><h2 class="reveal">Loved by creators</h2>' +
    '<p class="lead reveal">Join thousands using Ari AI every day.</p>' +
    '<div class="testi">' +
    '<div class="tcard reveal"><div class="stars">★★★★★</div><p>"Best free AI app I\'ve used. Chat, images and downloads all in one place."</p><div class="who">— Ayesha R.</div></div>' +
    '<div class="tcard reveal"><div class="stars">★★★★★</div><p>"I generate art for my brand in seconds. The daily rewards keep me coming back."</p><div class="who">— Daniel K.</div></div>' +
    '<div class="tcard reveal"><div class="stars">★★★★★</div><p>"No credit card, no spam, just works. Linked my Telegram and I was set."</p><div class="who">— Maria S.</div></div>' +
    '</div></div></section>' +
    '<div class="divider"></div>' +
    // install steps
    '<section><div class="wrap"><h2 class="reveal">Install in 3 steps</h2>' +
    '<p class="lead reveal">Direct download — no Play Store required.</p>' +
    '<div class="steps">' + steps + '</div></div></section>' +
    changeBlock +
    '<div class="divider"></div>' +
    // install help / FAQ
    '<section><div class="wrap"><h2 class="reveal">Having trouble installing?</h2>' +
    '<p class="lead reveal">Quick fixes for the most common cases.</p>' +
    '<div class="faq">' +
    '<details class="reveal"><summary>"App not installed"</summary>' +
    '<p>If a previous version is on your phone, uninstall it first — a different signing key blocks the upgrade. Then retry.</p></details>' +
    '<details class="reveal"><summary>Blocked by Play Protect</summary>' +
    '<p>Google may warn about non-Play apps. Tap <b>Install anyway</b> — our APK is checksum-verified and auto-updating.</p></details>' +
    '<details class="reveal"><summary>"Install unknown apps" blocked</summary>' +
    '<p>On Samsung: Settings &rarr; Apps &rarr; (your browser) &rarr; Install unknown apps &rarr; enable. Then open the download again.</p></details>' +
    '<details class="reveal"><summary>Scan to install</summary>' +
    '<p>Use the QR code in the hero to open the download directly on your phone — no cable needed.</p></details>' +
    '</div></div></section>' +
    '<div class="divider"></div>' +
    // telegram
    '<section><div class="wrap"><h2 class="reveal">Or use our Telegram bots</h2>' +
    '<p class="lead reveal">Chat with AI right inside Telegram.</p>' +
    '<div class="tg reveal">' +
    '<a href="https://t.me/AAA_Free_Ai_bot">🤖 Free AI Bot</a>' +
    '<a href="https://t.me/AAA_Login_bot">🔐 Login Bot</a>' +
    '</div></div></section>' +
    '<div class="divider"></div>' +
    // community / facebook
    '<section><div class="wrap community"><h2 class="reveal">Join the community</h2>' +
    '<p class="lead reveal">Tips, updates and giveaways — connect with us on Facebook.</p>' +
    '<a class="fb reveal" href="https://www.facebook.com/share/1BzWH5P2bF/" target="_blank" rel="noopener">' +
    'f &nbsp; <b>Follow Ari AI on Facebook</b></a>' +
    '<div class="reveal" style="margin-top:18px">' +
    '<a class="btn primary" style="background:linear-gradient(135deg,#1877F2,#0d5cdb)" ' +
    'href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent("https://aaa-ai-bot.aaateam.workers.dev/download") +
    '" target="_blank" rel="noopener">Share Ari AI with friends</a></div></div></section>' +
    // footer
    '<footer>&copy; ' + new Date().getFullYear() + ' Ari AI &middot; Made for creators.<br>' +
    'By installing you agree to allow updates from this source.<br>' +
    '<a href="https://t.me/AAA_Free_Ai_bot">Telegram</a> &middot; ' +
    '<a href="https://www.facebook.com/share/1BzWH5P2bF/" target="_blank" rel="noopener">Facebook</a> &middot; ' +
    '<a href="/app.apk">Download APK</a></footer>' +
    // dynamic behaviour: scroll reveal + animated counters
    '<script>' +
    '(function(){' +
    'var io=new IntersectionObserver(function(es){es.forEach(function(e){' +
    'if(e.isIntersecting){e.target.classList.add("in");' +
    'if(e.target.classList.contains("stat")){var n=e.target.querySelector(".statn");if(n)count(n);}' +
    'io.unobserve(e.target);}});},{threshold:.15});' +
    'document.querySelectorAll(".reveal").forEach(function(el){io.observe(el);});' +
    'function count(el){var to=+el.getAttribute("data-to")||0,st=performance.now(),d=1200;' +
    'function tick(now){var p=Math.min((now-st)/d,1);var v=Math.floor(to*(1-Math.pow(1-p,3)));' +
    'el.textContent=v.toLocaleString();if(p<1)requestAnimationFrame(tick);}requestAnimationFrame(tick);}' +
    '})();' +
    '</script>' +
    '</body></html>';
}
const FELIX_BASE_URL = "https://felix-rdx-unlimited-free-apis.vercel.app/api/v1/api";

// R2 (S3-compatible) helpers for generated assets (images/text downloads).
async function storeAsset(env, key, data, contentType) {
  if (!env.aaa_assets) return null;
  await env.aaa_assets.put(key, data, {
    httpMetadata: { contentType: contentType || "application/octet-stream" },
  });
  return "/" + key;
}
async function getAsset(env, key) {
  if (!env.aaa_assets) return null;
  return await env.aaa_assets.get(key);
}

/**
 * Native Telegram Login page. Embeds the official Telegram Login Widget for
 * @AAA_Login_bot, pointed at the configured Login domain. On success Telegram
 * POSTs the signed fields to `data-auth-url` (= /api/telegram-widget-verify),
 * which we verify (HMAC over the bot token) and then notify the opener window.
 */
function telegramLoginPage(origin, botUsername, domain) {
  const verifyUrl = origin + "/api/telegram-widget-verify";
  const back = origin + "/store";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="theme-color" content="#0b0b13">' +
    '<title>Sign in with Telegram · Ari AI</title>' +
    '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'background:radial-gradient(circle at 30% 20%,#2a1b5e,#0b0b13 60%);color:#f2f2f7;min-height:100vh;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center}' +
    '.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:36px 28px;max-width:420px;width:100%}' +
    'h1{font-size:1.5rem;margin-bottom:6px}.sub{color:#a6a6b8;margin-bottom:26px;font-size:.95rem}' +
    '.tg{margin:18px 0}.note{color:#8a8aa0;font-size:.8rem;margin-top:18px}' +
    'a.back{color:#9db4ff;font-size:.85rem;text-decoration:none}</style></head>' +
    '<body><div class="card"><h1>Sign in with Telegram</h1>' +
    '<p class="sub">Secure, one-tap login for the Ari AI App Store.</p>' +
    '<div class="tg"><script async src="https://telegram.org/js/telegram-widget.js?22" ' +
    'data-telegram-login="' + (botUsername || "AAA_Login_bot") + '" ' +
    'data-size="large" data-userpic="false" data-radius="16" ' +
    'data-auth-url="' + verifyUrl + '" data-request-access="write"></script></div>' +
    '<p class="note">By continuing you agree to link your Telegram account.</p>' +
    '<a class="back" href="' + back + '">← Back to store</a></div>' +
    // After the widget verifies, the server returns ok; Telegram then redirects
    // the opener. We also poll our own verify result and message the app.
    '<script>(function(){' +
    'function done(u){try{if(window.opener)window.opener.postMessage({type:"tg-login",user:u},"*");}catch(e){}' +
    'try{window.close();}catch(e){}}' +
    'window.addEventListener("message",function(e){if(e.data&&e.data.type==="tg-login-ok"){done(e.data.user);}});' +
    '})();</script>' +
    '</body></html>';
}

/** Build a QR-code data URI for a URL (best-effort; returns "" on failure). */
async function makeQr(target) {
  try {
    const u = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=" +
      encodeURIComponent(target);
    const r = await fetch(u, { cf: { cacheTtl: 86400 } });
    if (!r.ok) return "";
    const buf = await r.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return "data:image/png;base64," + b64;
  } catch (e) { return ""; }
}

// Scheduled cleanup: drop history older than 30 days, prune expired R2 objects.
async function cleanup(env) {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  let hist = 0, tx = 0;
  if (env.AAA_DB) {
    const h = await env.AAA_DB.prepare("DELETE FROM history WHERE ts < ?").bind(cutoff).run();
    const t = await env.AAA_DB.prepare("DELETE FROM transactions WHERE ts < ?").bind(cutoff).run();
    hist = h.meta?.changes || 0;
    tx = t.meta?.changes || 0;
  }
  let r2 = 0;
  if (env.aaa_assets) {
    const listed = await env.aaa_assets.list({ prefix: "tmp/" });
    for (const o of listed.objects) {
      if (o.uploaded && Date.parse(o.uploaded) < cutoff) {
        await env.aaa_assets.delete(o.key);
        r2++;
      }
    }
  }
  return { history_deleted: hist, transactions_deleted: tx, r2_deleted: r2 };
}

function htmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Read a provider key: KV override (set via /setkey) takes precedence over env secret. */
async function providerKey(env, kvName, secretName) {
  if (env.AAA_KV) {
    const kv = await env.AAA_KV.get("key_" + kvName);
    if (kv) return kv;
  }
  return env[secretName] || "";
}

async function tgSend(token, chatId, text, extra) {
  const payload = { chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true };
  if (extra && extra.reply_markup) payload.reply_markup = extra.reply_markup;
  await fetch(TELEGRAM_API + token + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Generic Telegram Bot API call (e.g. answerCallbackQuery, sendDocument). */
async function tgApi(token, method, payload) {
  const r = await fetch(TELEGRAM_API + token + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  return r.json().catch(function () { return {}; });
}

/** Post a message to the public AAA FREE AI channel. Returns success.
 *  Prefers the Free AI bot, which is the channel admin. */
async function postToChannel(text) {
  const channel = ENV.CHANNEL_ID || DEFAULT_CHANNEL_ID;
  if (!channel) return false;
  const tokens = [ENV.FREE_AI_BOT_TOKEN, ENV.LOGIN_BOT_TOKEN, ENV.ADMIN_BOT_TOKEN];
  for (const token of tokens) {
    if (!token) continue;
    if (await tgSendSafe(token, channel, text)) return true;
  }
  return false;
}

/** Post to the owner's YouTube. Community-tab posts are not available to normal
 *  OAuth apps, so we append the promo to the channel's latest video description
 *  (a reliable, working method). Best-effort: returns true on success. */
async function postToYouTube(text, env) {
  const refresh = env.AAA_KV ? await env.AAA_KV.get("yt_owner_refresh") : "";
  if (!refresh) return false;
  const accessToken = await googleAccessToken(env, refresh);
  if (!accessToken) return false;
  try {
    // Find the latest video id.
    const ch = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true",
      { headers: { Authorization: "Bearer " + accessToken } }).then(function (r) { return r.json(); });
    const uploads = ch.items && ch.items[0] &&
      ch.items[0].contentDetails && ch.items[0].contentDetails.relatedPlaylists &&
      ch.items[0].contentDetails.relatedPlaylists.uploads;
    if (!uploads) return false;
    const pl = await fetch(
      "https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=1&playlistId=" + uploads,
      { headers: { Authorization: "Bearer " + accessToken } }).then(function (r) { return r.json(); });
    const videoId = pl.items && pl.items[0] && pl.items[0].contentDetails && pl.items[0].contentDetails.videoId;
    if (!videoId) return false;
    // Get current description.
    const cur = await fetch(
      "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=" + videoId,
      { headers: { Authorization: "Bearer " + accessToken } }).then(function (r) { return r.json(); });
    const snip = cur.items && cur.items[0] && cur.items[0].snippet;
    if (!snip) return false;
    const promoLine = "\n\n🎁 Ari AI Promo: " + text.replace(/<[^>]+>/g, "");
    const desc = (snip.description || "").split("🎁 Ari AI Promo:")[0].trim() + promoLine;
    const res = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet", {
      method: "PUT",
      headers: { Authorization: "Bearer " + accessToken, "content-type": "application/json" },
      body: JSON.stringify({
        id: videoId,
        snippet: { title: snip.title, description: desc, categoryId: snip.categoryId || "22" },
      }),
    });
    return res.ok;
  } catch (e) { return false; }
}

/** Upload a generated promo video to the owner's YouTube channel (resumable).
 *  Best-effort: returns true on success. Requires the youtube.upload scope. */
async function uploadVideoToYouTube(videoBuf, title, description, env) {
  const refresh = env.AAA_KV ? await env.AAA_KV.get("yt_owner_refresh") : "";
  if (!refresh || !videoBuf) return false;
  const accessToken = await googleAccessToken(env, refresh);
  if (!accessToken) return false;
  try {
    const init = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "video/mp4",
          "X-Upload-Content-Length": String(videoBuf.byteLength),
        },
        body: JSON.stringify({
          snippet: { title: title, description: description, categoryId: "22" },
          status: { privacyStatus: "public" },
        }),
      });
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) return false;
    const up = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(videoBuf.byteLength) },
      body: videoBuf,
    });
    return up.ok || up.status === 201;
  } catch (e) { return false; }
}

/** Generate a short promo video via json2video.com and return the MP4 as a buffer.
 *  Two-step: POST /v2/movies -> poll /v2/movies?project=ID -> download MP4. */
async function generatePromoVideo(text, env) {
  const key = env.JSON2VIDEO_KEY || "";
  if (!key) return null;
  try {
    const submit = await fetch("https://api.json2video.com/v2/movies", {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        resolution: "hd",
        scenes: [
          { duration: 3, elements: [{ type: "text", text: "Ari AI", style: "001" }] },
          { duration: 4, elements: [{ type: "text", text: text.replace(/<[^>]+>/g, "").slice(0, 60), style: "001" }] },
        ],
      }),
    });
    const sub = await submit.json();
    if (!sub.success || !sub.project) return null;
    // Poll for completion (renders in ~10s).
    let url = null;
    for (let i = 0; i < 12; i++) {
      await new Promise(function (r) { setTimeout(r, 4000); });
      const pol = await fetch("https://api.json2video.com/v2/movies?project=" + sub.project, {
        headers: { "x-api-key": key },
      }).then(function (r) { return r.json(); });
      const m = pol.movie || pol;
      if (m.status === "done" && m.url) { url = m.url; break; }
    }
    if (!url) return null;
    const vid = await fetch(url);
    if (!vid.ok) return null;
    return await vid.arrayBuffer();
  } catch (e) { return null; }
}

/** Show a "typing…" indicator so replies feel responsive. */
async function tgAction(token, chatId, action) {
  try {
    await fetch(TELEGRAM_API + token + "/sendChatAction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: action || "typing" }),
    });
  } catch (e) {}
}

/** Like tgSend but returns whether Telegram accepted the message. */
async function tgSendSafe(token, chatId, text) {
  try {
    const r = await fetch(TELEGRAM_API + token + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j = await r.json();
    return !!j.ok;
  } catch (e) { return false; }
}

async function callFreeAi(endpoint, q) {
  try {
    const res = await fetch(FELIX_BASE_URL + "/" + endpoint + "?q=" + encodeURIComponent(q), {
      headers: { Accept: "*/*" },
    });
    const raw = await res.text();
    try {
      const obj = JSON.parse(raw);
      for (const k of ["result", "response", "text", "output", "answer"]) {
        if (obj[k] != null) return String(obj[k]);
      }
    } catch (e) {}
    return raw.slice(0, 4000);
  } catch (e) {
    return "⚠️ Free-AI request failed. Try again later.";
  }
}

// ---- Additional providers (server-side only; for system/Telegram/other) ----

/**
 * Mark a provider key as exhausted (quota/credits used up) in KV. The /credits
 * command and the AI router read this so they skip dead keys and can alert the
 * admin. Only set when we actually observe a 402/429/quota error.
 */
async function markKeyExhausted(env, name, reason) {
  if (!env.AAA_KV) return;
  await env.AAA_KV.put("exhausted:" + name, JSON.stringify({ at: Date.now(), reason: reason || "quota" }),
    { expirationTtl: 60 * 60 * 24 * 7 });
  // Alert the owner once per exhaustion event.
  const alerted = await env.AAA_KV.get("exhausted_alerted:" + name);
  if (!alerted && ENV.ADMIN_CHAT_ID && ENV.ADMIN_CHAT_ID !== "REPLACE_WITH_ADMIN_CHAT_ID") {
    await tgSend(ENV.ADMIN_BOT_TOKEN, ENV.ADMIN_CHAT_ID,
      "🔴 <b>Provider key exhausted:</b> " + name + "\nReason: " + htmlEscape(reason || "quota/rate-limit") +
      "\nSwap a fresh key with /setkey " + name + " &lt;value&gt;.");
    await env.AAA_KV.put("exhausted_alerted:" + name, "1", { expirationTtl: 60 * 60 * 24 });
  }
}

/** True if a provider key is currently marked exhausted. */
async function isExhausted(env, name) {
  if (!env.AAA_KV) return false;
  return !!(await env.AAA_KV.get("exhausted:" + name));
}

/** Detect a quota/credit/rate-limit error from a provider response. */
function isQuotaError(res, obj) {
  if (res && (res.status === 402 || res.status === 429)) return true;
  const msg = (obj && (obj.error?.message || (typeof obj.error === "string" ? obj.error : "")) || "").toLowerCase();
  return /quota|rate.?limit|credit|exceeded|exhausted|429|402/.test(msg);
}

async function callGemini(q, userKey) {
  const key = userKey || ENV.GEMINI_KEY;
  if (!key) return null;
  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + key;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: q }] }] }),
    });
    const obj = await res.json().catch(function () { return {}; });
    if (isQuotaError(res, obj)) { await markKeyExhausted(ENV, "gemini", obj?.error?.message || ("HTTP " + res.status)); return null; }
    return obj?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || null;
  } catch (e) { return null; }
}

async function callGroq(q, userKey) {
  const key = userKey || ENV.GROQ_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: q }] }),
    });
    const obj = await res.json().catch(function () { return {}; });
    if (isQuotaError(res, obj)) { await markKeyExhausted(ENV, "groq", obj?.error?.message || ("HTTP " + res.status)); return null; }
    return obj?.choices?.[0]?.message?.content || null;
  } catch (e) { return null; }
}

async function callHf(q, userKey) {
  const key = userKey || ENV.HF_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api-inference.huggingface.co/models/google/flan-t5-xxl", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ inputs: q, parameters: { max_new_tokens: 512 } }),
    });
    const obj = await res.json().catch(function () { return {}; });
    if (isQuotaError(res, obj)) { await markKeyExhausted(ENV, "hf", obj?.error?.message || ("HTTP " + res.status)); return null; }
    if (Array.isArray(obj)) return obj[0]?.generated_text || null;
    return obj?.generated_text || null;
  } catch (e) { return null; }
}

/**
 * Smart AI router with automatic fallback. Skips providers whose key is currently
 * marked exhausted (quota/credits used up) and falls through to the next healthy
 * provider, ending at the public felix endpoint. A single /setkey swaps a key live.
 */
export async function askAi(q, provider, userKey) {
  const gemOk = !(await isExhausted(ENV, "gemini"));
  const groqOk = !(await isExhausted(ENV, "groq"));
  const hfOk = !(await isExhausted(ENV, "hf"));
  let out = null;
  if (provider === "groq") {
    if (groqOk) out = await callGroq(q, userKey);
    if (!out && gemOk) out = await callGemini(q, userKey);
    if (!out) out = await callFreeAi("gemini", q);
  } else if (provider === "hf") {
    if (hfOk) out = await callHf(q, userKey);
    if (!out && gemOk) out = await callGemini(q, userKey);
    if (!out) out = await callFreeAi("gemini", q);
  } else {
    if (gemOk) out = await callGemini(q, userKey);
    if (!out && groqOk) out = await callGroq(q, userKey);
    if (!out) out = await callFreeAi("gemini", q);
  }
  return out || "⚠️ All AI providers are busy right now. Please try again in a moment.";
}

// ---- Background Admin AI ----------------------------------------------------
// A server-side AI assistant that runs on the provider keys (Gemini -> Groq ->
// HF). It powers: (a) the admin bot assistant, (b) smarter free-bot replies,
// and (c) the daily cron intelligence report. It never exposes the keys.

const ADMIN_AI_PERSONA =
  "You are AAA-Admin-AI, the built-in operations assistant for the Ari AI Android " +
  "super-app (free AI chat, image generation, downloaders, points & referrals). " +
  "You help the owner run the service: interpret stats, spot problems, suggest " +
  "growth ideas, draft announcements/broadcasts, and answer product questions. " +
  "Be concise, practical and use plain text (no markdown symbols). When given live " +
  "metrics, reason about them directly.";

/** Collect a live snapshot of the service for the admin AI to reason over. */
async function gatherStats(env) {
  const s = { users: 0, points: 0, pendingCodes: 0, keySubs: 0, profiles: 0, tx24h: 0, verifyFails: 0 };
  try {
    if (env.AAA_DB) {
      const u = await env.AAA_DB.prepare("SELECT COUNT(*) c, COALESCE(SUM(points),0) p FROM users").first();
      s.users = u?.c || 0; s.points = u?.p || 0;
      const since = Date.now() - 24 * 3600 * 1000;
      const t = await env.AAA_DB.prepare("SELECT COUNT(*) c FROM transactions WHERE ts >= ?").bind(since).first();
      s.tx24h = t?.c || 0;
    }
    s.pendingCodes = (await env.AAA_KV.list({ prefix: "login:" })).keys.length;
    s.keySubs = (await env.AAA_KV.list({ prefix: "key:" })).keys.length;
    s.profiles = (await env.AAA_KV.list({ prefix: "profile:" })).keys.length;
    s.verifyFails = parseInt(await env.AAA_KV.get("verify_fails") || "0", 10) || 0;
    // Collect any provider keys currently marked exhausted (quota/credits used up).
    const ex = await env.AAA_KV.list({ prefix: "exhausted:" });
    s.exhausted = ex.keys.map(function (k) { return k.name.slice("exhausted:".length); });
  } catch (e) {}
  return s;
}

function statsBlock(s) {
  let block = "LIVE METRICS:\n" +
    "- Registered users (D1): " + s.users + "\n" +
    "- Total points in circulation: " + s.points + "\n" +
    "- Telegram profiles linked: " + s.profiles + "\n" +
    "- Transactions (last 24h): " + s.tx24h + "\n" +
    "- Pending login codes: " + s.pendingCodes + "\n" +
    "- API key submissions: " + s.keySubs + "\n" +
    "- Failed verifications (abuse): " + (s.verifyFails || 0);
  if (s.exhausted && s.exhausted.length) {
    block += "\n- EXHAUSTED PROVIDER KEYS: " + s.exhausted.join(", ");
  }
  return block;
}

/** Ask the background admin AI a question, grounded with an optional context. */
export async function adminAi(question, context) {
  const prompt = ADMIN_AI_PERSONA + "\n\n" + (context ? context + "\n\n" : "") +
    "OWNER: " + question + "\nASSISTANT:";
  return await askAi(prompt, "gemini");
}

/** Forward a user-submitted API key to the admin chat via the admin bot. */
async function notifyAdmin(payload) {
  const token = ENV.ADMIN_BOT_TOKEN;
  const chatId = ENV.ADMIN_CHAT_ID;
  if (!token || !chatId || chatId === "REPLACE_WITH_ADMIN_CHAT_ID") return false;
  try {
    await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "🔑 <b>New API key submission</b>\nProvider: " + htmlEscape(payload.provider || "?") +
              "\nUser: " + htmlEscape(payload.userTag || "unknown") +
              "\nKey: <code>" + htmlEscape(payload.key || "") + "</code>",
        parse_mode: "HTML",
      }),
    });
    return true;
  } catch (e) { return false; }
}

/**
 * Canonical Telegram Login Widget SHA-256 verification.
 *
 * Given the fields returned by the Telegram widget (id, first_name, auth_date,
 * hash, optionally username/photo_url), recompute the expected hash as:
 *   sha256(auth_date + "\n" + first_name [+ "\n" + username] ... + "\n" + bot_token)
 * and compare (timing-safe) with the provided hash. This is the standard
 * Telegram Login Widget security check, computed server-side so the bot token
 * never reaches the app.
 */
async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

/** Base64-encode a (ASCII-safe) string for Telegram sendDocument data URI. */
function base64Encode(str) {
  try { return btoa(unescape(encodeURIComponent(str))); }
  catch (e) { return btoa(str); }
}

export async function verifyTelegramWidget(fields) {
  const token = ENV.LOGIN_BOT_TOKEN;
  if (!token || !fields || !fields.hash || !fields.auth_date) return false;
  // Optional strictness: ensure the widget came from our configured bot.
  if (ENV.LOGIN_BOT_ID && fields.id && String(fields.id) !== String(ENV.LOGIN_BOT_ID)) return false;
  const enc = new TextEncoder();
  // Build the data-check string exactly as Telegram specifies.
  const ordered = Object.keys(fields)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => k + "=" + fields[k])
    .join("\n");
  // secret_key = SHA256(bot_token); then HMAC-SHA256(data, secret_key).
  const secret = await sha256Bytes(enc.encode(token));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(ordered)));
  const computed = toHex(sig);
  // Constant-time compare.
  if (computed.length !== fields.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ fields.hash.charCodeAt(i);
  if (diff !== 0) return false;
  // Reject widgets older than 24h (auth_date is Unix seconds).
  const age = (Date.now() / 1000) - (parseInt(fields.auth_date, 10) || 0);
  if (!fields.auth_date || age < 0 || age > 24 * 3600) return false;
  return true;
}

/** Pollinations image generation (no key). Returns a URL. */
function pollinationsUrl(prompt, opts) {
  const p = encodeURIComponent(prompt);
  const w = opts?.width || 1024, h = opts?.height || 1024;
  return "https://image.pollinations.ai/prompt/" + p + "?width=" + w + "&height=" + h + "&nologo=true&model=flux";
}

/** DuckDuckGo HTML scrape -> top result snippets. */
async function searchDDG(q) {
  try {
    const html = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    }).then((r) => r.text());
    const out = [];
    const re = /class="result__snippet"[^>]*>(.*?)<\/a>/gs;
    let m;
    while ((m = re.exec(html)) && out.length < 5) {
      out.push(m[1].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim());
    }
    if (out.length === 0) {
      // fallback: grab any result__a titles
      const tre = /class="result__a"[^>]*>(.*?)<\/a>/gs;
      let t;
      while ((t = tre.exec(html)) && out.length < 5) {
        out.push(t[1].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim());
      }
    }
    return out.join("\n\n") || "No results.";
  } catch (e) { return "⚠️ Search failed."; }
}

const REFERRAL_BONUS = 300;

/**
 * Credit a referrer when a brand-new user opens their invite link.
 * Idempotent per new user (refdone:<newUserId>) and self-referral guarded.
 * The credited amount is queued under pendingref:<referrerId> for the app to claim.
 */
async function creditReferral(referrerId, newUserId) {
  referrerId = String(referrerId || "").replace(/[^0-9]/g, "");
  newUserId = String(newUserId || "");
  if (!referrerId || !newUserId || referrerId === newUserId) return false;
  const doneKey = "refdone:" + newUserId;
  if (await ENV.AAA_KV.get(doneKey)) return false;
  await ENV.AAA_KV.put(doneKey, referrerId, { expirationTtl: 60 * 60 * 24 * 365 });
  // Accumulate pending referral points for the referrer to claim in-app.
  const pendKey = "pendingref:" + referrerId;
  const cur = parseInt((await ENV.AAA_KV.get(pendKey)) || "0", 10) || 0;
  await ENV.AAA_KV.put(pendKey, String(cur + REFERRAL_BONUS), { expirationTtl: 60 * 60 * 24 * 90 });
  const cntKey = "refcount:" + referrerId;
  const cnt = (parseInt((await ENV.AAA_KV.get(cntKey)) || "0", 10) || 0) + 1;
  await ENV.AAA_KV.put(cntKey, String(cnt), { expirationTtl: 60 * 60 * 24 * 365 });
  return true;
}

async function handleFreeAi(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const from = msg.from || { id: chatId };
  const userId = String(from.id);
  const text = msg.text.trim();
  if (text.startsWith("/start")) {
    const arg = text.slice("/start".length).trim();
    if (arg.startsWith("ref_")) {
      const referrerId = arg.slice("ref_".length);
      const credited = await creditReferral(referrerId, from.id);
      if (credited) {
        await tgSend(ENV.FREE_AI_BOT_TOKEN, chatId,
          "🎉 <b>Welcome to AAA Free AI!</b>\nYou joined via a friend's invite — they just earned bonus points. Send any message to start chatting free.");
        return;
      }
    }
    const linked = env_AAA_KVget(ENV, userId);
    await tgSend(ENV.FREE_AI_BOT_TOKEN, chatId,
      "<b>AAA Free AI</b>\nSend any message and I'll answer using the free AI endpoints.\n\n" +
      "💡 Each message costs " + BOT_MSG_COST + " points (" + BOT_DAILY_FREE + " free per day). " +
      "Link the Ari AI app to share your wallet & earn daily rewards:\n" +
      "1) Install Ari AI (t.me/AAA_Free_Ai_bot has the link)\n2) Profile → Link Telegram.");
    return;
  }
  // Resolve wallet + daily free quota.
  const { uid, freeLeft } = await resolveBotUid(ENV, userId);
  // If not linked to the app, require linking before charging/answering.
  const isLinked = uid !== ("tg_" + userId);
  if (!isLinked && freeLeft <= 0) {
    await tgSend(ENV.FREE_AI_BOT_TOKEN, chatId,
      "🔒 <b>Free messages used up for today.</b>\nLink the Ari AI app to keep chatting " +
      "and earn daily reward points (Profile → Link Telegram), or reply tomorrow.");
    return;
  }
  await tgAction(ENV.FREE_AI_BOT_TOKEN, chatId);
  const persona =
    "You are Ari, a friendly, helpful free AI assistant inside a Telegram bot. " +
    "Answer clearly and concisely in plain text. If asked what you can do, mention " +
    "the Ari AI app has AI chat, image generation, downloaders and daily reward points.\n\n" +
    "User: " + text + "\nAri:";
  const reply = await askAi(persona, "gemini");
  if (freeLeft > 0) {
    await bumpFreeUsage(ENV, userId);
  } else {
    // If the wallet backend is unavailable, don't block the user — answer for free.
    if (!ENV.AAA_DB) {
      // no-op: degrade gracefully
    } else {
      const spend = await botSpend(uid, BOT_MSG_COST, "bot-chat", ENV);
      if (!spend.ok) {
        await tgSend(ENV.FREE_AI_BOT_TOKEN, chatId,
          "⚠️ <b>Not enough points.</b> You need " + BOT_MSG_COST + " points per message. " +
          "Link the Ari AI app and do daily check-ins / watch ads to earn more.");
        return;
      }
    }
  }
  await tgSend(ENV.FREE_AI_BOT_TOKEN, chatId, reply);
}

// Small helper so /start can report link status without awaiting resolveBotUid twice.
async function env_AAA_KVget(env, userId) {
  return env.AAA_KV ? await env.AAA_KV.get("tg_link:" + userId) : null;
}

/** Fetch the user's Telegram profile photo as a downloadable file URL. */
async function tgProfilePhotoUrl(userId) {
  try {
    const token = ENV.LOGIN_BOT_TOKEN;
    const photos = await fetch(TELEGRAM_API + token + "/getUserProfilePhotos?user_id=" + userId + "&limit=1")
      .then((r) => r.json());
    if (!photos.ok || !photos.result || !photos.result.photos.length) return "";
    const sizes = photos.result.photos[0];
    const fileId = sizes[sizes.length - 1].file_id;
    const file = await fetch(TELEGRAM_API + token + "/getFile?file_id=" + fileId).then((r) => r.json());
    if (!file.ok) return "";
    return "https://api.telegram.org/file/bot" + token + "/" + file.result.file_path;
  } catch (e) { return ""; }
}

/** Build and persist a Telegram profile object keyed by chat id. */
async function saveTgProfile(from, extra) {
  const profile = {
    id: from.id,
    firstName: from.first_name || "",
    lastName: from.last_name || "",
    username: from.username || "",
    languageCode: from.language_code || "",
    isPremium: !!from.is_premium,
    phone: (extra && extra.phone) || "",
    photoUrl: (extra && extra.photoUrl) || "",
    updatedAt: Date.now(),
  };
  await ENV.AAA_KV.put("profile:" + from.id, JSON.stringify(profile), { expirationTtl: 60 * 60 * 24 * 30 });
  return profile;
}

const contactKeyboard = {
  keyboard: [[{ text: "📱 Share my phone number", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

async function handleLogin(update) {
  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const from = msg.from || { id: chatId };

  // User shared their phone number via the contact button.
  if (msg.contact) {
    const photoUrl = await tgProfilePhotoUrl(from.id);
    await saveTgProfile(from, { phone: msg.contact.phone_number, photoUrl: photoUrl });
    await tgSend(ENV.LOGIN_BOT_TOKEN, chatId,
      "✅ <b>All set!</b>\nYour phone number was linked. Return to the Ari AI app — your profile is now synced.",
      { reply_markup: { remove_keyboard: true } });
    return;
  }

  const text = (msg.text || "").trim();
  if (text.startsWith("/start")) {
    const arg = text.slice("/start".length).trim();
    const photoUrl = await tgProfilePhotoUrl(from.id);
    // App deep-link flow: t.me/AAA_Login_bot?start=verify_<token>
    if (arg.startsWith("verify_")) {
      const token = arg.slice("verify_".length).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      if (token.length >= 6) {
        const profile = await saveTgProfile(from, { photoUrl: photoUrl });
        // Store so the app's polling loop can confirm verification (with profile).
        await ENV.AAA_KV.put("verify:" + token, JSON.stringify({ chatId: chatId, profile: profile }), { expirationTtl: 600 });
        const name = htmlEscape([from.first_name, from.last_name].filter(Boolean).join(" ") || "there");
        await tgSend(ENV.LOGIN_BOT_TOKEN, chatId,
          "✅ <b>Login verified</b>\nWelcome, " + name + "! You're signed in to Ari AI.\n\n" +
          "Tap below to also link your phone number (optional), then return to the app.",
          { reply_markup: contactKeyboard });
        return;
      }
    }
    // Manual code flow.
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    await saveTgProfile(from, { photoUrl: photoUrl });
    await ENV.AAA_KV.put("login:" + code, JSON.stringify({ chatId: chatId, profile: await saveTgProfile(from, { photoUrl: photoUrl }) }), { expirationTtl: 600 });
    await tgSend(ENV.LOGIN_BOT_TOKEN, chatId,
      "<b>Ari AI Login</b>\nYour link code (valid 10 min):\n\n<code>" + code + "</code>\n\n" +
      "Open Ari AI → Profile → Link Telegram and enter this code.\n\n" +
      "Optionally, share your phone number below to complete your profile.",
      { reply_markup: contactKeyboard });
    return;
  }
  await tgSend(ENV.LOGIN_BOT_TOKEN, chatId, "👋 Send /start to sign in to Ari AI.");
}

/** Send the colorful, full-grid admin menu (inline keyboard).
 *  Button labels are human-friendly (no slash commands shown). The actual
 *  command is hidden in callback_data so the panel looks clean. */
async function sendAdminMenu(chatId) {
  const b = (label, data) => ({ text: label, callback_data: data });
  const GRID = {
    inline_keyboard: [
      [b("🎁 Drop Promo", "/promo"), b("🤖 Auto Post", "/autopost"), b("📊 Report", "/report")],
      [b("💬 Ask Admin AI", "/ai"), b("📈 Credits", "/credits"), b("🗄 Get SQL", "/sql")],
      [b("🔗 YouTube", "/ytconnect"), b("📺 YT Stats", "/ytstats"), b("🔑 Swap Key", "/setkey")],
      [b("📣 Broadcast", "/broadcast"), b("👥 User Stats", "/stats"), b("🎟 Key List", "/keys")],
      [b("⭐ Grant Me", "/grantme"), b("🏆 Grant User", "/grant"), b("➕ Add Admin", "/adminadd")],
    ],
  };
  const head =
    "🤖 <b>Ari AI Control Center</b>\n" +
    "Tap any tile — everything runs from the grid, no typing needed.\n\n" +
    "🟣 <b>Growth</b> · 🔵 <b>Ops</b> · 🟠 <b>Media</b> · 🟢 <b>Users</b> · ⭐ <b>Access</b>";
  await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, head, { reply_markup: GRID });
}

/** Register the Worker's own webhooks on Telegram using the bot tokens it
 *  already holds as secrets. Calling this on deploy guarantees the login/free/
 *  admin bots always deliver updates to this Worker (no manual step needed). */
async function setupWebhooks(origin) {
  const base = (origin || (typeof URL !== "undefined" ? "" : "")) || "";
  const bots = [
    { token: ENV.FREE_AI_BOT_TOKEN, path: "/telegram/free", commands: [{ command: "start", description: "Start chatting with free AI" }] },
    { token: ENV.LOGIN_BOT_TOKEN, path: "/telegram/login", commands: [{ command: "start", description: "Sign in to the Ari AI app" }] },
    { token: ENV.ADMIN_BOT_TOKEN, path: "/telegram/admin", commands: [
      { command: "help", description: "Show admin commands" },
      { command: "keys", description: "List API key submissions" },
      { command: "key", description: "Submissions for one provider" },
      { command: "stats", description: "Users, points, pending codes" },
      { command: "setpoints", description: "Adjust a user balance" },
      { command: "broadcast", description: "Message all users" },
    ] },
  ];
  const out = [];
  for (const b of bots) {
    if (!b.token) { out.push("skip (no token)"); continue; }
    try {
      const url = base + b.path;
      await fetch(TELEGRAM_API + b.token + "/setWebhook", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url, drop_pending_updates: true, allowed_updates: ["message", "callback_query"] }),
      });
      await fetch(TELEGRAM_API + b.token + "/setMyCommands", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ commands: b.commands }),
      });
      out.push("ok");
    } catch (e) { out.push("err:" + (e && e.message)); }
  }
  return out;
}

/** Check the health/credit status of each connected provider. */
/** Build a one-line provider-health summary (live / exhausted / no-key). */
async function providerHealthLine(env) {
  const names = ["gemini", "groq", "hf", "json2video"];
  const out = [];
  for (const n of names) {
    const key = await providerKey(env, n, n.toUpperCase() + "_KEY");
    if (!key) { out.push(n + ": no-key"); continue; }
    const ex = env.AAA_KV ? await env.AAA_KV.get("exhausted:" + n) : null;
    out.push(n + (ex ? ": EXHAUSTED" : ": ok"));
  }
  return out.join(" · ");
}

/** Read the live json2video credit balance (number) for a given key, or null. */
async function json2videoBalance(env, key) {
  if (!key) return null;
  try {
    const ar = await fetch("https://api.json2video.com/v2/account", {
      headers: { Authorization: "Bearer " + key, "content-type": "application/json" },
    });
    if (!ar.ok) return null;
    const aj = await ar.json().catch(function () { return {}; });
    const bal = aj.credits != null ? aj.credits : (aj.balance != null ? aj.balance : aj.remaining);
    return (bal != null && !isNaN(bal)) ? Number(bal) : null;
  } catch (e) { return null; }
}

async function sendCredits(chatId) {
  const checks = [
    ["Gemini", "GEMINI_KEY", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="],
    ["Groq", "GROQ_KEY", "https://api.groq.com/openai/v1/models"],
    ["HF", "HF_KEY", "https://api-inference.huggingface.co/models/google/flan-t5-xxl"],
    ["json2video", "JSON2VIDEO_KEY", "https://api.json2video.com/v2/movies"],
    ["Supabase", "SUPABASE_SERVICE_ROLE", "https://gafutudfmyyhkmxvpcqt.supabase.co/rest/v1/users?select=uid&limit=1"],
  ];
  let out = "💳 <b>Service Credits / Health</b>\n";
  for (const [name, secret, url] of checks) {
    const kvName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = await providerKey(ENV, kvName, secret);
    if (!key) { out += "• " + name + ": ⚠️ no key\n"; continue; }
    const ex = ENV.AAA_KV ? await ENV.AAA_KV.get("exhausted:" + kvName) : null;
    if (ex) {
      try { const e = JSON.parse(ex); out += "• " + name + ": 🔴 EXHAUSTED (" + htmlEscape(e.reason || "quota") + ")\n"; continue; }
      catch (e) { out += "• " + name + ": 🔴 EXHAUSTED\n"; continue; }
    }
    // json2video reports live credit balance via /v2/account — show it.
    if (name === "json2video") {
      const bal = await json2videoBalance(ENV, key);
      if (bal == null) out += "• " + name + ": ❌ unreachable\n";
      else {
        const low = bal <= 20;
        out += "• " + name + ": ✅ live · credits left: <b>" + htmlEscape(String(bal)) + "</b>" +
          (low ? " 🔔 LOW — swap key with /setkey json2video &lt;new&gt;" : "") + "\n";
      }
      continue;
    }
    let ok = false;
    try {
      const r = await fetch(url + (name === "Gemini" ? key : ""), {
        headers: name === "HF" || name === "Groq" ? { Authorization: "Bearer " + key } :
          (name === "Supabase" ? { apikey: key, Authorization: "Bearer " + key } : {}),
      });
      ok = r.ok || r.status === 401 || r.status === 403; // 401/403 = key valid, just no perms
    } catch (e) { ok = false; }
    out += "• " + name + ": " + (ok ? "✅ live" : "❌ unreachable") + "\n";
  }
  out += "\nUse /setkey &lt;name&gt; &lt;value&gt; to swap a key live (json2video credits auto-checked), or /ai &lt;question&gt; to ask the ops AI.";
  await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, out);
}

async function handleAdmin(update) {
  // Inline keyboard button taps (grid menu) are delivered as callback_query.
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message ? cq.message.chat.id : cq.from.id;
    const data = (cq.data || "").trim();
    try { await tgApi(ENV.ADMIN_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cq.id }); } catch (e) {}
    if (data && data.startsWith("/")) {
      // Re-route the button callback as if the admin typed the command.
      await handleAdmin({ message: { chat: { id: chatId }, text: data, from: cq.from } });
    } else if (data && (data.startsWith("approve:") || data.startsWith("reject:"))) {
      if (!authed && !listAuthed) {
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔐 Send: <code>/login Arif-Abid</code> first.");
      } else {
        const id = data.slice(data.indexOf(":") + 1);
        if (data.startsWith("approve:")) {
          await approveApp(ENV, id);
          await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Approved <code>" + htmlEscape(id) + "</code>.");
        } else {
          const reason = (args && args[1]) ? args.slice(1).join(" ") : "Rejected by admin";
          await rejectApp(ENV, id, reason);
          await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "❌ Rejected <code>" + htmlEscape(id) + "</code>.");
        }
        // Update the original review message to remove its buttons.
        try {
          await tgApi(ENV.ADMIN_BOT_TOKEN, "editMessageReplyMarkup", {
            chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] },
          });
        } catch (e) {}
      }
    }
    return;
  }

  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const args = text.split(/\s+/);
  const cmd = args[0].toLowerCase();

  // Admin auth via password (stored in KV, default "Arif-Abid"). No hardcoded chat id.
  // Optionally, a KV list "admin_list" (comma-separated chat ids) auto-grants access.
  const ADMIN_PASSWORD = (await ENV.AAA_KV.get("admin_password")) || "Arif-Abid";
  const adminList = (await ENV.AAA_KV.get("admin_list") || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  const listAuthed = adminList.indexOf(String(chatId)) >= 0;
  const authed = listAuthed || (await ENV.AAA_KV.get("admin_auth:" + chatId));
  if (cmd === "/login") {
    const pw = (args[1] || "").trim();
    if (pw === ADMIN_PASSWORD) {
      await ENV.AAA_KV.put("admin_auth:" + chatId, "1", { expirationTtl: 60 * 60 * 24 * 30 });
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Logged in as admin.");
      sendAdminMenu(chatId);
    } else if (!authed) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⛔ Wrong password. Use /login &lt;password&gt;");
    }
    return;
  }
  // Manage the multi-admin list (owner-only convenience helpers).
  if (cmd === "/adminadd" || cmd === "/adminrm") {
    if (!listAuthed && !authed) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔐 Send: <code>/login &lt;password&gt;</code> first.");
      return;
    }
    const target = (args[1] || "").trim();
    if (!target) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: " + cmd + " &lt;chatId&gt;"); return; }
    let list = (await ENV.AAA_KV.get("admin_list") || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (cmd === "/adminadd") { if (list.indexOf(target) < 0) list.push(target); }
    else { list = list.filter(function (x) { return x !== target; }); }
    await ENV.AAA_KV.put("admin_list", list.join(","));
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, (cmd === "/adminadd" ? "✅ Added " : "✅ Removed ") + target + " from admin list.");
    return;
  }
  if (!authed) {
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔐 Send: <code>/login Arif-Abid</code> to access the admin panel.");
    return;
  }

  if (cmd === "/start" || cmd === "/help" || cmd === "/menu") {
    sendAdminMenu(chatId);
    return;
  }

  if (cmd === "/ai") {
    const q = args.slice(1).join(" ");
    if (!q) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /ai &lt;question&gt;"); return; }
    await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
    const stats = await gatherStats(ENV);
    const ctx = statsBlock(stats) + "\n\nPROVIDER HEALTH:\n" + (await providerHealthLine(ENV));
    const ans = await adminAi(q, ctx);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 " + htmlEscape(ans));
    return;
  }

  if (cmd === "/report") {
    await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
    const stats = await gatherStats(ENV);
    const ans = await adminAi(
      "Give me a short operations report: health of the service, anything notable " +
      "or concerning, and 2-3 concrete suggestions to grow usage.",
      statsBlock(stats));
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "📊 <b>Admin AI Report</b>\n" + htmlEscape(ans) + "\n\n<code>" + htmlEscape(statsBlock(stats)) + "</code>");
    return;
  }

  if (cmd === "/announce") {
    const idea = args.slice(1).join(" ");
    if (!idea) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /announce &lt;what to announce&gt;"); return; }
    await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
    const draft = await adminAi(
      "Draft a short, friendly broadcast message (max 3 sentences, 1-2 emojis) for our " +
      "app users about: " + idea + ". Output only the message text.", "");
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "📝 <b>Draft broadcast</b>\n\n" + htmlEscape(draft) +
      "\n\nTo send it: /broadcast " + htmlEscape(draft));
    return;
  }

  if (cmd === "/channel") {
    const message = args.slice(1).join(" ");
    if (!message) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /channel &lt;message&gt;"); return; }
    const ok = await postToChannel(htmlEscape(message));
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, ok ? "✅ Posted to channel." : "⚠️ Could not post (check bot is admin in channel).");
    return;
  }

  if (cmd === "/setkey") {
    const name = (args[1] || "").toLowerCase();
    const value = args.slice(2).join(" ");
    const allowed = { json2video: "JSON2VIDEO_KEY", kie: "KIE_API_KEY", kiehmac: "KIE_HMAC_KEY", hf: "HF_KEY", gemini: "GEMINI_KEY", groq: "GROQ_KEY" };
    if (!allowed[name] || !value) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
        "Usage: /setkey &lt;json2video|kie|kiehmac|hf|gemini|groq&gt; &lt;value&gt;\nUpdates the provider key live (no redeploy needed).");
      return;
    }
    await ENV.AAA_KV.put("key_" + name, value);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Key <b>" + name + "</b> updated. Takes effect on next request.");
    return;
  }

  if (cmd === "/promo") {
    await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
    const r = await weeklyPromo(ENV);
    const chan = r.toChannel ? "✅ Posted to Telegram channel" : "⚠️ Channel post failed (is a bot admin in the channel?)";
    const yt = r.toYt ? "✅ Posted to YouTube (video description)" : "⚠️ YouTube description skipped (no video on channel)";
    const ytVid = r.toYtVideo ? "✅ Uploaded promo video to YouTube" : (r.hasVideo ? "⚠️ YouTube video upload failed (reconnect with youtube.upload scope)" : "⚠️ No video generated (HF unavailable)");
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "✅ Promo generated.\nCode: <b>" + r.promo.code + "</b>\n" +
      r.promo.premiumDays + " days premium · first " + r.promo.maxRedemptions + " users.\n\n" +
      chan + "\n" + yt + "\n" + ytVid);
    return;
  }

  if (cmd === "/autopost") {
    await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
    const r = await autoPostAi(ENV);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "🤖 Auto-post done.\nChannel: " + (r.toChannel ? "✅" : "❌") +
      "\nYouTube desc: " + (r.toYt ? "✅" : "❌") +
      "\nShort video: " + (r.toYtVideo ? "✅" : "— skipped (credits)"));
    return;
  }

  if (cmd === "/promostats") {
    const latest = JSON.parse((await ENV.AAA_KV.get("promo_latest")) || "null");
    if (!latest) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "No promo code generated yet. Use /promo."); return; }
    let redeemed = 0;
    if (ENV.AAA_DB) {
      const r = await ENV.AAA_DB.prepare("SELECT redeemed, max_redemptions FROM promo_codes WHERE code = ?").bind(latest.code).first();
      redeemed = (r && r.redeemed) || 0;
    }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "🎁 <b>" + latest.code + "</b>\nRedeemed: " + redeemed + " / " + latest.maxRedemptions +
      "\nPremium: " + latest.premiumDays + " days");
    return;
  }

  if (cmd === "/credits") {
    await sendCredits(chatId);
    return;
  }

  if (cmd === "/keys") {
    const provider = (args[1] || "").toLowerCase();
    const list = await ENV.AAA_KV.list({ prefix: "key:" });
    if (!list.keys.length) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔑 No API key submissions yet."); return; }
    let out = "🔑 <b>Submitted API keys</b> (" + list.keys.length + ")\n";
    const items = list.keys.slice(-15).reverse();
    for (const k of items) {
      const rec = await ENV.AAA_KV.get(k.name);
      let info = {};
      try { info = JSON.parse(rec); } catch (e) {}
      if (provider && info.provider !== provider) continue;
      out += "• <b>" + htmlEscape(info.provider || "?") + "</b> from " + htmlEscape(info.userTag || "unknown") +
        " — " + (info.key ? info.key.slice(0, 6) + "…" : "empty") + "\n";
    }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, out);
    return;
  }

  if (cmd === "/ytconnect") {
    const origin = ENV.PUBLIC_ORIGIN || "https://aaa-ai-bot.aaateam.workers.dev";
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "🔗 Connect your YouTube channel (one-time):\n" +
      origin + "/api/yt/connect?mode=owner\n\nOpen it, approve access, then use /ytstats.");
    return;
  }

  if (cmd === "/ytstats") {
    await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
    const s = await ytChannelStats(ENV);
    if (!s) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "YouTube not connected. Use /ytconnect first."); return; }
    const summary = await adminAi(
      "Summarize my YouTube channel health and suggest 2 content ideas.",
      "YOUTUBE: " + s.title + " — subs " + s.subscribers + ", views " + s.views + ", videos " + s.videos);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "📺 <b>" + htmlEscape(s.title || "Channel") + "</b>\n" +
      "Subscribers: " + s.subscribers + "\nViews: " + s.views + "\nVideos: " + s.videos +
      "\n\n🤖 " + htmlEscape(summary));
    return;
  }

  if (cmd === "/ytupdate") {
    const parts = text.slice("/ytupdate".length).split("|").map(function (p) { return p.trim(); });
    const videoId = parts[0];
    if (!videoId) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /ytupdate &lt;videoId&gt; | &lt;title&gt; | &lt;description&gt;"); return; }
    await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
    const r = await ytUpdateVideo(ENV, videoId, parts[1] || "", parts[2] != null ? parts[2] : null);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, r.ok ? "✅ Video updated." : "⚠️ " + (r.error || "update failed"));
    return;
  }

  if (cmd === "/supabase") {
    await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
    const ok = await supabaseProvision(ENV) && await supabaseKeepAlive(ENV);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      ok ? "🟢 Supabase active — mirror schema provisioned and reachable."
         : "🔴 Supabase unreachable — project paused, or keys missing.");
    return;
  }

  if (cmd === "/keys") {
    const listed = await ENV.AAA_KV.list({ prefix: "key:" });
    if (!listed.keys.length) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "No key submissions yet."); return; }
    const lines = [];
    for (const k of listed.keys.slice(-30)) {
      const raw = await ENV.AAA_KV.get(k.name);
      try { const o = JSON.parse(raw); lines.push("• " + htmlEscape(o.provider) + " | " + htmlEscape(o.userTag) + " | <code>" + htmlEscape(o.key) + "</code>"); }
      catch (e) { lines.push("• (unparsed) " + htmlEscape(k.name)); }
    }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "<b>Submissions (" + lines.length + "):</b>\n" + lines.join("\n"));
    return;
  }

  if (cmd === "/key") {
    const prov = (args[1] || "").toLowerCase();
    if (!prov) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /key <gemini|groq|hf>"); return; }
    const listed = await ENV.AAA_KV.list({ prefix: "key:" });
    const lines = [];
    for (const k of listed.keys) {
      const o = JSON.parse(await ENV.AAA_KV.get(k.name) || "{}");
      if (o.provider === prov) lines.push("• " + htmlEscape(o.userTag) + " | <code>" + htmlEscape(o.key) + "</code>");
    }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "<b>" + htmlEscape(prov) + " (" + lines.length + "):</b>\n" + (lines.join("\n") || "none"));
    return;
  }

  if (cmd === "/stats") {
    let info = "📊 <b>Stats</b>\n";
    if (ENV.AAA_DB) {
      const u = await ENV.AAA_DB.prepare("SELECT COUNT(*) c, COALESCE(SUM(points),0) p FROM users").first();
      info += "Users: " + (u?.c || 0) + "\nTotal points: " + (u?.p || 0) + "\n";
    }
    const codes = await ENV.AAA_KV.list({ prefix: "login:" });
    info += "Pending link codes: " + codes.keys.length + "\n";
    const subs = await ENV.AAA_KV.list({ prefix: "key:" });
    info += "Key submissions: " + subs.keys.length;
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, info);
    return;
  }

  if (cmd === "/setpoints") {
    const uid = args[1]; const amt = parseInt(args[2], 10);
    if (!uid || isNaN(amt)) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /setpoints <uid> <amount>"); return; }
    const r = await addPoints(uid, amt, "admin", ENV);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ " + uid + " -> " + (r.points ?? "n/a") + " pts");
    return;
  }

  if (cmd === "/sql") {
    // Phone-friendly: send the SQL file directly to Telegram (50MB limit is plenty).
    try {
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("caption", "📄 mirror_schema.sql — open in Supabase SQL Editor → New query → paste → Run.");
      form.append("document", new Blob([MIRROR_SQL.trim()], { type: "application/sql" }), "mirror_schema.sql");
      const r = await fetch(TELEGRAM_API + ENV.ADMIN_BOT_TOKEN + "/sendDocument", {
        method: "POST",
        body: form,
      });
      const j = await r.json().catch(function () { return {}; });
      if (!j.ok) throw new Error("sendDocument failed");
      return;
    } catch (e) {
      // Fallback 1: direct R2 download link.
      const origin = ENV.PUBLIC_ORIGIN || "https://aaa-ai-bot.aaateam.workers.dev";
      try {
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
          "📄 <b>mirror_schema.sql</b> (tap to download):\n" + origin + "/sql/mirror_schema.sql");
        return;
      } catch (e2) {}
      // Fallback 2: plain text.
      const chunks = MIRROR_SQL.match(/[\s\S]{1,3800}/g) || [MIRROR_SQL];
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "<code>" + htmlEscape(chunks[0]) + "</code>");
    }
    return;
  }

  if (cmd === "/broadcast") {
    const message = args.slice(1).join(" ");
    if (!message) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /broadcast &lt;message&gt;"); return; }
    // Broadcast to real users via their stored Telegram profile chat IDs.
    const listed = await ENV.AAA_KV.list({ prefix: "profile:" });
    let sent = 0, failed = 0;
    for (const k of listed.keys) {
      const id = k.name.slice("profile:".length);
      const ok = await tgSendSafe(ENV.LOGIN_BOT_TOKEN, id, "📣 <b>Ari AI</b>\n" + htmlEscape(message));
      if (ok) sent++; else failed++;
    }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "✅ Broadcast sent to " + sent + " user(s)" + (failed ? " (" + failed + " unreachable)" : "") + ".");
    return;
  }

  if (cmd === "/grantme") {
    // Owner/admin self-premium — grant 365 days to the chat id's linked app uid.
    const linked = ENV.AAA_KV ? await ENV.AAA_KV.get("tg_link:" + chatId) : null;
    const uid = linked || ("tg_" + chatId);
    await grantPremium(ENV, uid, 365);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Granted yourself Premium (365 days) on uid <code>" + htmlEscape(uid) + "</code>.");
    return;
  }

  if (cmd === "/grant") {
    // grant <uid> [days] — give a user premium time.
    const uid = (args[1] || "").trim();
    const days = parseInt((args[2] || "30"), 10) || 30;
    if (!uid) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /grant &lt;uid&gt; [days=30]"); return; }
    await grantPremium(ENV, uid, days);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Granted <code>" + htmlEscape(uid) + "</code> Premium for " + days + " days.");
    return;
  }

  // ---- App Store moderation (shared with the aaa-store worker) ----
  if (cmd === "/review") {
    if (!ENV.AAA_DB) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Store DB unavailable."); return; }
    const apps = await ENV.AAA_DB.prepare(
      "SELECT id, name, category, short_desc, owner_uid, version, package_name FROM store_apps WHERE status = 'pending' ORDER BY submitted_at ASC LIMIT 10"
    ).all();
    const rows = (apps && apps.results) || [];
    if (!rows.length) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ No apps waiting for review."); return; }
    for (const a of rows) {
      const owner = await getStoreUserName(ENV, a.owner_uid);
      const txt =
        "📦 <b>" + htmlEscape(a.name) + "</b>\n" +
        "Category: " + htmlEscape(a.category) + "\n" +
        "Version: " + htmlEscape(a.version || "?") + " · pkg: <code>" + htmlEscape(a.package_name || "?") + "</code>\n" +
        "By: " + htmlEscape(owner) + "\n" +
        (a.short_desc ? htmlEscape(a.short_desc) + "\n" : "") +
        "ID: <code>" + a.id + "</code>";
      const kb = {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: "approve:" + a.id },
          { text: "❌ Reject", callback_data: "reject:" + a.id },
        ]],
      };
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, txt, { reply_markup: kb });
    }
    return;
  }

  if (cmd === "/apps") {
    if (!ENV.AAA_DB) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Store DB unavailable."); return; }
    const apps = await ENV.AAA_DB.prepare(
      "SELECT id, name, status, downloads, owner_uid FROM store_apps ORDER BY submitted_at DESC LIMIT 12"
    ).all();
    const rows = (apps && apps.results) || [];
    if (!rows.length) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "No apps yet."); return; }
    let out = "📱 <b>Recent apps</b>\n";
    for (const a of rows) {
      out += "• [" + htmlEscape(a.status) + "] " + htmlEscape(a.name) + " — " + (a.downloads || 0) + " dl · by " + htmlEscape(await getStoreUserName(ENV, a.owner_uid)) + "\n";
    }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, out);
    return;
  }

  // Any non-command text is treated as a question for the background Admin AI.
  await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
  const stats = await gatherStats(ENV);
  const ans = await adminAi(text, statsBlock(stats));
  await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 " + htmlEscape(ans));
}

async function getStoreUserName(env, uid) {
  if (!env.AAA_DB || !uid) return uid || "unknown";
  const r = await env.AAA_DB.prepare("SELECT display_name, tg_username FROM store_users WHERE uid = ?").bind(uid).first();
  if (r) return r.display_name || r.tg_username || uid;
  return uid;
}

async function approveApp(env, id) {
  if (!env.AAA_DB) return;
  const app = await env.AAA_DB.prepare("SELECT id, owner_uid, name, package_name, apk_r2_key FROM store_apps WHERE id = ?").bind(id).first();
  if (!app) return;
  // If this package already has an approved version, supersede it (delete its R2 blob).
  if (app.package_name) {
    const prev = await env.AAA_DB.prepare(
      "SELECT id, apk_r2_key FROM store_apps WHERE package_name = ? AND status = 'approved' LIMIT 1"
    ).bind(app.package_name).all();
    for (const p of (prev && prev.results) || []) {
      if (p.id !== app.id && p.apk_r2_key && env.aaa_assets) {
        try { await env.aaa_assets.delete(p.apk_r2_key); } catch (e) {}
        await env.AAA_DB.prepare("UPDATE store_apps SET status = 'superseded' WHERE id = ?").bind(p.id).run();
      }
    }
  }
  await env.AAA_DB.prepare(
    "UPDATE store_apps SET status = 'approved', approved_at = ? WHERE id = ?"
  ).bind(Date.now(), id).run();
  await env.AAA_DB.prepare(
    "UPDATE store_users SET apps_count = apps_count + 1 WHERE uid = ?"
  ).bind(app.owner_uid).run();
  // Notify the developer.
  if (env.AAA_KV) {
    const prof = await env.AAA_KV.get("profile:" + app.owner_uid);
    let chatId = null;
    if (prof) { try { chatId = JSON.parse(prof).uid; } catch (e) {} }
    if (!chatId && app.owner_uid.startsWith("tg_")) chatId = app.owner_uid.slice(3);
    if (chatId) {
      await tgSendSafe(env.LOGIN_BOT_TOKEN, chatId,
        "🎉 Your app <b>" + htmlEscape(app.name) + "</b> was approved and is now live in the store!");
    }
  }
}

async function rejectApp(env, id, reason) {
  if (!env.AAA_DB) return;
  const app = await env.AAA_DB.prepare("SELECT id, owner_uid, name FROM store_apps WHERE id = ?").bind(id).first();
  if (!app) return;
  await env.AAA_DB.prepare(
    "UPDATE store_apps SET status = 'rejected', reject_reason = ? WHERE id = ?"
  ).bind(reason || "Rejected by admin", id).run();
  if (env.AAA_KV) {
    let chatId = null;
    const prof = await env.AAA_KV.get("profile:" + app.owner_uid);
    if (prof) { try { chatId = JSON.parse(prof).uid; } catch (e) {} }
    if (!chatId && app.owner_uid.startsWith("tg_")) chatId = app.owner_uid.slice(3);
    if (chatId) {
      await tgSendSafe(env.LOGIN_BOT_TOKEN, chatId,
        "⚠️ Your app <b>" + htmlEscape(app.name) + "</b> was rejected. Reason: " + htmlEscape(reason || "—"));
    }
  }
}

async function addPointsD1(env, uid, amount, reason) {
  if (!env.AAA_DB) return null;
  const now = Date.now();
  // Parameterized upsert (no string interpolation -> no SQL injection).
  await env.AAA_DB.prepare(
    "INSERT OR IGNORE INTO users(uid, points, lifetime_earned, created_at) VALUES (?, 100, 0, ?)"
  ).bind(uid, now).run();
  // Guard against overspending: a debit that would drive the balance negative is
  // rejected (returns -1) so the caller can report "insufficient balance" without
  // mutating the wallet or writing a transaction.
  if (amount < 0) {
    const bal = await env.AAA_DB.prepare(
      "SELECT points FROM users WHERE uid = ?"
    ).bind(uid).first();
    const current = bal ? (bal.points || 0) : 0;
    if (current + amount < 0) return -1;
  }
  const info = await env.AAA_DB.prepare(
    "UPDATE users SET points = points + ?, lifetime_earned = lifetime_earned + ? " +
    "WHERE uid = ? RETURNING points"
  ).bind(amount, Math.max(amount, 0), uid).first();
  if (info == null) return null;
  const newPoints = info.points;
  await env.AAA_DB.prepare(
    "INSERT INTO transactions(uid, type, amount, reason, ts) VALUES (?, ?, ?, ?, ?)"
  ).bind(uid, amount >= 0 ? "credit" : "debit", amount, reason, now).run();
  await supabaseUpsert(env, "transactions",
    { uid: uid, type: amount >= 0 ? "credit" : "debit", amount: amount, reason: reason, ts: now });
  return newPoints;
}

/**
 * Generic Supabase upsert (D1 stays authoritative; this keeps a browsable
 * mirror in sync). Uses Postgres ON CONFLICT via Prefer: merge-duplicates.
 * `onConflict` is the unique column(s) to merge on. Fire-and-forget safe.
 */
async function supabaseUpsert(env, table, row, onConflict) {
  const base = env.SUPABASE_URL || "";
  const key = env.SUPABASE_SERVICE_ROLE || "";
  if (!base || !key) return false;
  try {
    const url = base + "/rest/v1/" + table + (onConflict ? "?on_conflict=" + onConflict : "");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(Array.isArray(row) ? row : [row]),
    });
    return res.ok;
  } catch (e) { return false; }
}

/** Lightweight ping to keep a free Supabase project from auto-pausing. */
async function supabaseKeepAlive(env) {
  const base = env.SUPABASE_URL || "";
  const key = env.SUPABASE_SERVICE_ROLE || "";
  if (!base || !key) return false;
  try {
    const res = await fetch(base + "/rest/v1/users?select=uid&limit=1", {
      headers: { apikey: key, Authorization: "Bearer " + key },
    });
    return res.ok;
  } catch (e) { return false; }
}

/** Create the mirror tables if missing (idempotent via RPC). */
async function supabaseProvision(env) {
  const base = env.SUPABASE_URL || "";
  const key = env.SUPABASE_SERVICE_ROLE || "";
  if (!base || !key) return false;
  try {
    const res = await fetch(base + "/rest/v1/rpc/aaa_provision_mirror", {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "content-type": "application/json" },
      body: "{}",
    });
    return res.ok;
  } catch (e) { return false; }
}

async function addPoints(uid, amount, reason, env) {
  const d1 = await addPointsD1(env, uid, amount, reason);
  if (d1 == null && !(env.SUPABASE_URL)) return { ok: false, error: "no datastore configured" };
  // Mirror the authoritative D1 balance to Supabase.
  const mirrored = await supabaseUpsert(env, "users",
    { uid: uid, points: d1 != null ? d1 : 0 }, "uid");
  return { ok: true, points: d1, d1: d1, mirrored: mirrored };
}

/**
 * Spend [amount] points for a Telegram/ bot user (keyed by chat id). Returns
 * { ok, points } where ok=false means insufficient balance (points unchanged).
 */
async function botSpend(uid, amount, reason, env) {
  const r = await addPoints(uid, -Math.abs(amount), reason, env);
  if (!r || r.d1 == null) return { ok: false, points: 0, error: "no datastore" };
  if (r.d1 === -1) return { ok: false, points: 0, error: "insufficient" };
  return { ok: true, points: r.d1 };
}

/** Read the current balance for any uid (Telegram chat id or app uid). */
async function getBalance(uid, env) {
  if (!env.AAA_DB) return 0;
  const row = await env.AAA_DB.prepare("SELECT points FROM users WHERE uid = ?").bind(uid).first();
  return row ? (row.points || 0) : 0;
}

/**
 * Resolve the wallet uid for a Telegram user. If they linked the app, points are
 * shared with the app wallet (app uid); otherwise a dedicated tg_<userId> wallet
 * is used. Also enforces the daily free-message quota: returns { uid, freeLeft }.
 */
async function resolveBotUid(env, userId) {
  const linked = env.AAA_KV ? await env.AAA_KV.get("tg_link:" + userId) : null;
  const uid = linked || ("tg_" + userId);
  let freeLeft = 0;
  if (env.AAA_KV) {
    const day = new Date().toISOString().slice(0, 10);
    const used = parseInt(await env.AAA_KV.get("tgfree:" + userId + ":" + day) || "0", 10) || 0;
    freeLeft = Math.max(0, BOT_DAILY_FREE - used);
  }
  return { uid: uid, freeLeft: freeLeft };
}

/** Increment a Telegram user's daily free-message usage by 1. */
async function bumpFreeUsage(env, userId) {
  if (!env.AAA_KV) return;
  const day = new Date().toISOString().slice(0, 10);
  const key = "tgfree:" + userId + ":" + day;
  const used = parseInt(await env.AAA_KV.get(key) || "0", 10) || 0;
  await env.AAA_KV.put(key, String(used + 1), { expirationTtl: 60 * 60 * 24 * 2 });
}

// ---- YouTube integration ----------------------------------------------------
// Uses the Google OAuth Web client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
// secrets). The OWNER connects once (refresh token stored in KV) to let the
// Admin AI read stats, post community posts, and edit video metadata. Individual
// USERS connect their own Google to verify channel subscription.

const YT_CHANNEL_HANDLE = "AAA-FREE-AI";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Exchange an OAuth authorization code for tokens. */
async function googleExchangeCode(env, code, redirectUri) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: code,
      client_id: env.GOOGLE_CLIENT_ID || "",
      client_secret: env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  return await res.json();
}

/** Get a fresh access token from a stored refresh token. */
async function googleAccessToken(env, refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID || "",
      client_secret: env.GOOGLE_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }),
  });
  const j = await res.json();
  return j.access_token || null;
}

/** Owner access token (from KV-stored refresh token). */
async function ytOwnerToken(env) {
  const refresh = await env.AAA_KV.get("yt_owner_refresh");
  if (!refresh) return null;
  return await googleAccessToken(env, refresh);
}

/** Read the owner channel's public statistics. */
async function ytChannelStats(env) {
  const token = await ytOwnerToken(env);
  if (!token) return null;
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true",
    { headers: { Authorization: "Bearer " + token } });
  const j = await res.json();
  const ch = j.items && j.items[0];
  if (!ch) return null;
  return {
    id: ch.id,
    title: ch.snippet && ch.snippet.title,
    subscribers: ch.statistics && ch.statistics.subscriberCount,
    views: ch.statistics && ch.statistics.viewCount,
    videos: ch.statistics && ch.statistics.videoCount,
  };
}

/** Update an existing video's title/description. */
async function ytUpdateVideo(env, videoId, title, description) {
  const token = await ytOwnerToken(env);
  if (!token) return { ok: false, error: "owner not connected" };
  // Need current category to satisfy the API's required snippet fields.
  const cur = await fetch(
    "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=" + videoId,
    { headers: { Authorization: "Bearer " + token } }).then(function (r) { return r.json(); });
  const snip = cur.items && cur.items[0] && cur.items[0].snippet;
  if (!snip) return { ok: false, error: "video not found" };
  const res = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet", {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({
      id: videoId,
      snippet: {
        title: title || snip.title,
        description: description != null ? description : snip.description,
        categoryId: snip.categoryId || "22",
      },
    }),
  });
  return { ok: res.ok };
}

/**
 * Verify a specific user is subscribed to the owner channel, using the USER's
 * own OAuth access token (subscriptions.list?forChannelId requires the
 * subscriber's own consent — the owner's token cannot check this).
 */
async function ytVerifyUserSubscription(env, userAccessToken) {
  const stats = await ytChannelStats(env);
  const channelId = (stats && stats.id) || (await env.AAA_KV.get("yt_channel_id"));
  if (!channelId) return { ok: false, error: "owner channel unknown" };
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/subscriptions?part=id&mine=true&forChannelId=" + channelId,
    { headers: { Authorization: "Bearer " + userAccessToken } });
  const j = await res.json();
  const subscribed = !!(j.items && j.items.length > 0);
  return { ok: true, subscribed: subscribed, channelId: channelId };
}

// ---- Premium + Promo codes --------------------------------------------------

/** Grant premium time (in days) to a user; extends existing premium. */
async function grantPremium(env, uid, days) {
  if (!env.AAA_DB) return 0;
  const now = Date.now();
  const add = days * 24 * 3600 * 1000;
  await env.AAA_DB.prepare(
    "INSERT OR IGNORE INTO users(uid, points, lifetime_earned, created_at) VALUES (?, 100, 0, ?)"
  ).bind(uid, now).run();
  const row = await env.AAA_DB.prepare(
    "UPDATE users SET premium_until = MAX(COALESCE(premium_until,0), ?) + ? WHERE uid = ? RETURNING premium_until"
  ).bind(now, add, uid).first();
  const premiumUntil = row ? row.premium_until : 0;
  await supabaseUpsert(env, "users", { uid: uid, premium_until: premiumUntil }, "uid");
  return premiumUntil;
}

/** Ask the AI to invent a short, catchy promo code (fallback = random). */
async function aiPromoCode() {
  try {
    const raw = await askAi(
      "Invent ONE short catchy uppercase promo code for a free AI app, 6-10 chars, " +
      "letters and digits only, no spaces. Output ONLY the code.", "gemini");
    const cleaned = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    if (cleaned.length >= 6) return cleaned;
  } catch (e) {}
  return "AAA" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Create a new promo code (premium reward) and store it in D1. */
async function createPromoCode(env, opts) {
  opts = opts || {};
  const code = opts.code || (await aiPromoCode());
  const premiumDays = opts.premiumDays || 7;
  const maxRedemptions = opts.maxRedemptions || 30;
  const now = Date.now();
  const expiresAt = now + (opts.validDays || 7) * 24 * 3600 * 1000;
  if (env.AAA_DB) {
    await env.AAA_DB.prepare(
      "INSERT OR REPLACE INTO promo_codes(code, premium_days, max_redemptions, redeemed, created_at, expires_at, active) " +
      "VALUES (?, ?, ?, 0, ?, ?, 1)"
    ).bind(code, premiumDays, maxRedemptions, now, expiresAt).run();
  }
  await env.AAA_KV.put("promo_latest", JSON.stringify({ code, premiumDays, maxRedemptions, expiresAt }),
    { expirationTtl: 60 * 60 * 24 * 30 });
  await supabaseUpsert(env, "promo_codes",
    { code: code, premium_days: premiumDays, max_redemptions: maxRedemptions, redeemed: 0, expires_at: expiresAt, active: true }, "code");
  return { code, premiumDays, maxRedemptions, expiresAt };
}

/** Redeem a promo code for a user. Enforces max redemptions + one-per-user. */
async function redeemPromoCode(env, code, uid) {
  code = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) return { ok: false, error: "missing code" };
  if (!uid) return { ok: false, error: "missing user" };
  if (!env.AAA_DB) return { ok: false, error: "no datastore" };
  const now = Date.now();
  const promo = await env.AAA_DB.prepare(
    "SELECT code, premium_days, max_redemptions, redeemed, expires_at, active FROM promo_codes WHERE code = ?"
  ).bind(code).first();
  if (!promo || !promo.active) return { ok: false, error: "invalid code" };
  if (promo.expires_at && now > promo.expires_at) return { ok: false, error: "code expired" };
  if (promo.redeemed >= promo.max_redemptions) return { ok: false, error: "code fully claimed" };
  // Atomic-ish one-per-user guard: PK on (code, uid).
  try {
    await env.AAA_DB.prepare(
      "INSERT INTO promo_redemptions(code, uid, ts) VALUES (?, ?, ?)"
    ).bind(code, uid, now).run();
  } catch (e) {
    return { ok: false, error: "already redeemed" };
  }
  await env.AAA_DB.prepare("UPDATE promo_codes SET redeemed = redeemed + 1 WHERE code = ?").bind(code).run();
  const premiumUntil = await grantPremium(env, uid, promo.premium_days);
  await supabaseUpsert(env, "promo_redemptions", { code: code, uid: uid, ts: now }, "code,uid");
  return { ok: true, code: code, premiumDays: promo.premium_days, premiumUntil: premiumUntil };
}

/** Generate + announce the weekly promo code via the Admin AI to the channel and YouTube. */
async function weeklyPromo(env) {
  const promo = await createPromoCode(env, { premiumDays: 7, maxRedemptions: 30, validDays: 7 });
  const msg = await adminAi(
    "Write an exciting short Telegram channel post (2-3 sentences, a few emojis) announcing a " +
    "limited promo code that unlocks 7 days of Ari AI PREMIUM for only the first 30 people. " +
    "The code is " + promo.code + ". Tell them to open the Ari AI app and redeem it in Profile. " +
    "Output only the post text.", "");
  const post = (msg && msg.length > 5 ? htmlEscape(msg) : ("🎁 Limited drop! First 30 users get 7 days PREMIUM free.")) +
    "\n\n🔑 Code: <b>" + promo.code + "</b>\n👥 First " + promo.maxRedemptions + " users only!";
  // Generate a promo VIDEO via json2video and post it to Telegram + YouTube.
  let videoBuf = null;
  try { videoBuf = await generatePromoVideo(post, env); } catch (e) {}
  let toChannel = false;
  let toYtVideo = false;
  if (videoBuf) {
    // Post video to Telegram channel (Free AI bot is channel admin).
    try {
      const form = new FormData();
      form.append("chat_id", String(env.CHANNEL_ID || DEFAULT_CHANNEL_ID));
      form.append("caption", post);
      form.append("video", new Blob([videoBuf], { type: "video/mp4" }), "aaa_promo.mp4");
      const r = await fetch(TELEGRAM_API + (env.FREE_AI_BOT_TOKEN) + "/sendVideo", { method: "POST", body: form });
      const j = await r.json().catch(function () { return {}; });
      toChannel = !!j.ok;
    } catch (e) {}
    if (!toChannel) toChannel = await postToChannel(post);
    // Upload the video directly to YouTube.
    toYtVideo = await uploadVideoToYouTube(videoBuf,
      "Ari AI Promo " + promo.code + " — 7 Days Premium Free",
      "Limited promo! Use code " + promo.code + " in the Ari AI app to unlock 7 days of Premium. First 30 users only.\n\nGet the app: https://aaa-ai-bot.aaateam.workers.dev/download",
      env);
  } else {
    // Fallback: post a generated image to the channel.
    const imgPrompt = "Ari AI promo, neon purple pink gradient, code " + promo.code + ", premium badge, modern app, 4k";
    const imgUrl = pollinationsUrl(imgPrompt, { width: 1024, height: 1024 });
    try {
      const imgResp = await fetch(imgUrl);
      if (imgResp.ok) {
        const imgBuf = await imgResp.arrayBuffer();
        const form = new FormData();
        form.append("chat_id", String(env.CHANNEL_ID || DEFAULT_CHANNEL_ID));
        form.append("caption", post);
        form.append("photo", new Blob([imgBuf], { type: "image/png" }), "aaa_promo.png");
        const r = await fetch(TELEGRAM_API + (env.FREE_AI_BOT_TOKEN) + "/sendPhoto", { method: "POST", body: form });
        const j = await r.json().catch(function () { return {}; });
        toChannel = !!j.ok;
      }
    } catch (e) {}
    if (!toChannel) toChannel = await postToChannel(post);
  }
  // Also update the channel's latest YouTube video description (if any video exists).
  const toYt = await postToYouTube(post, env);
  return { promo: promo, toChannel: toChannel, toYt: toYt, toYtVideo: toYtVideo, hasVideo: !!videoBuf };
}

/**
 * Auto-post AI-generated content (a "tip of the day" / fun fact / prompt idea)
 * to the Telegram channel and the channel's latest YouTube video description.
 * Each post is paired with a generated image, and when json2video credits are
 * available it also renders a short promo video. Used by the daily cron to keep
 * the community active without manual effort.
 */
async function autoPostAi(env) {
  const topics = [
    "a short, punchy AI tip a beginner would love",
    "a clever ChatGPT / Gemini prompt idea people can try today",
    "a little-known free AI tool or trick",
    "a one-line productivity hack using AI chat",
    "a fun creative use of AI image generation",
    "a myth about AI debunked in a friendly way",
  ];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const msg = await adminAi(
    "Write a friendly, upbeat Telegram channel post (2-3 sentences, 1-3 emojis) about " +
    topic + " for our Ari AI app community. Mention Ari AI naturally. Output only the post text.", "");
  const cleanMsg = (msg && msg.length > 5) ? msg : "✨ New AI trick just dropped — open Ari AI and try it now!";
  const post = htmlEscape(cleanMsg) + "\n\n📲 Get the app: https://aaa-ai-bot.aaateam.workers.dev/download";

  // 1) Generate a matching image and post it to the channel.
  const imgPrompt = "Ari AI app, " + topic + ", neon purple and pink gradient, modern flat illustration, 4k, no text";
  let toChannel = false;
  try {
    const imgResp = await fetch(pollinationsUrl(imgPrompt, { width: 1024, height: 1024 }));
    if (imgResp.ok) {
      const imgBuf = await imgResp.arrayBuffer();
      const form = new FormData();
      form.append("chat_id", String(env.CHANNEL_ID || DEFAULT_CHANNEL_ID));
      form.append("caption", post);
      form.append("photo", new Blob([imgBuf], { type: "image/png" }), "aaa_tip.png");
      const r = await fetch(TELEGRAM_API + (env.FREE_AI_BOT_TOKEN) + "/sendPhoto", { method: "POST", body: form });
      const j = await r.json().catch(function () { return {}; });
      toChannel = !!j.ok;
    }
  } catch (e) {}
  if (!toChannel) toChannel = await postToChannel(post);

  // 2) When json2video credits remain, render a short promo video and post it too.
  let toYtVideo = false;
  try {
    const j2vKey = await providerKey(env, "json2video", "JSON2VIDEO_KEY");
    const bal = await json2videoBalance(env, j2vKey);
    if (bal != null && bal > 5) {
      const vbuf = await generatePromoVideo(cleanMsg, env);
      if (vbuf) {
        const form = new FormData();
        form.append("chat_id", String(env.CHANNEL_ID || DEFAULT_CHANNEL_ID));
        form.append("caption", post);
        form.append("video", new Blob([vbuf], { type: "video/mp4" }), "aaa_tip.mp4");
        const r = await fetch(TELEGRAM_API + (env.FREE_AI_BOT_TOKEN) + "/sendVideo", { method: "POST", body: form });
        const j = await r.json().catch(function () { return {}; });
        toYtVideo = !!j.ok;
      }
    }
  } catch (e) {}

  // 3) Keep the channel's latest YouTube video description in sync.
  const toYt = await postToYouTube(post, env);
  return { toChannel: toChannel, toYt: toYt, toYtVideo: toYtVideo };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Guard for privileged, state-changing endpoints. Rejects any request whose
 * `x-app-secret` header does not exactly match the Worker's APP_SHARED_SECRET.
 * Returns null when authorized, or a 401 Response when not.
 */
function requireSecret(request, env) {
  if (request.headers.get("x-app-secret") !== env.APP_SHARED_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  return null;
}

/**
 * Simple fixed-window rate limiter backed by KV. Returns true if the caller is
 * over the limit (and should be blocked). [key] namespaces the limit (e.g. an IP
 * + route), [max] attempts allowed within [windowSec].
 */
async function rateLimited(env, key, max, windowSec) {
  if (!env.AAA_KV) return false;
  const k = "ratelimit:" + key;
  const rec = await env.AAA_KV.get(k);
  let count = rec ? (parseInt(rec, 10) || 0) : 0;
  count += 1;
  await env.AAA_KV.put(k, String(count), { expirationTtl: windowSec });
  return count > max;
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      return new Response("ERR: " + (e && e.message ? e.message : String(e)), {
        status: 500, headers: { "content-type": "text/plain" },
      });
    }
  },
};

async function handle(request, env) {
    ENV = env || {};
    const url = new URL(request.url);

    // Self-healing webhook registration: if the bots' webhooks haven't been
    // registered (or the flag is stale), (re)register them once per ~24h. This
    // keeps Telegram login + bots working even if a deploy forgot the explicit
    // setup step. Fire-and-forget (no await) so it never slows requests.
    if (env.AAA_KV) {
      const flag = await env.AAA_KV.get("webhooks_ok");
      if (!flag) {
        setupWebhooks(url.origin).then(function (res) {
          env.AAA_KV.put("webhooks_ok", JSON.stringify(res), { expirationTtl: 60 * 60 * 24 }).catch(function () {});
        }).catch(function () {});
      }
    }

    if (request.method === "POST" && url.pathname === "/telegram/free") {
      const update = await request.json().catch(function () { return {}; });
      await handleFreeAi(update);
      return new Response("ok");
    }
    if (request.method === "POST" && url.pathname === "/telegram/login") {
      const update = await request.json().catch(function () { return {}; });
      const r = await handleLogin(update);
      return r || new Response("ok");
    }
    // Re-register the bot webhooks (guarded). Lets you repair Telegram login
    // from anywhere without re-running setup scripts.
    if (request.method === "POST" && url.pathname === "/api/setup-webhooks") {
      const denied = requireSecret(request, ENV);
      if (denied) return denied;
      const r = await setupWebhooks(url.origin);
      // Reset the self-heal flag so the new registration is trusted immediately.
      if (ENV.AAA_KV) await ENV.AAA_KV.put("webhooks_ok", JSON.stringify(r), { expirationTtl: 60 * 60 * 24 }).catch(function () {});
      return json({ ok: true, result: r });
    }
    if (request.method === "GET" && url.pathname === "/api/verify") {
      const raw = (url.searchParams.get("code") || "").trim();
      if (!raw) return json({ ok: false, error: "missing code" }, 400);
      // Rate-limit brute-force attempts per client IP (20 tries / 10 min).
      const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "anon";
      if (await rateLimited(ENV, "verify:" + clientIp, 20, 600)) {
        return json({ ok: false, error: "too many attempts, slow down" }, 429);
      }
      // Normalize: strip a possible "verify_" prefix, then uppercase the token only.
      const token = (raw.startsWith("verify_") ? raw.slice("verify_".length) : raw).toUpperCase();
      if (!token) return json({ ok: false, error: "missing code" }, 400);
      // Support both manual link codes (login:) and app deep-link tokens (verify:).
      const verifyKey = "verify:" + token;
      const loginKey = "login:" + token;
      const stored = (await ENV.AAA_KV.get(verifyKey)) || (await ENV.AAA_KV.get(loginKey));
      if (!stored) {
        // Track abuse: number of failed verifications (visible in admin stats).
        const f = parseInt(await ENV.AAA_KV.get("verify_fails") || "0", 10) || 0;
        await ENV.AAA_KV.put("verify_fails", String(f + 1), { expirationTtl: 60 * 60 * 24 * 30 });
        return json({ ok: false, error: "invalid or expired code" });
      }
      // Consume the one-time deep-link token so it cannot be replayed.
      if (await ENV.AAA_KV.get(verifyKey)) await ENV.AAA_KV.delete(verifyKey);
      // New format stores JSON {chatId, profile}; legacy stored a bare chatId string.
      let chatId = stored, profile = null;
      try {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.chatId) { chatId = String(parsed.chatId); profile = parsed.profile || null; }
      } catch (e) { /* legacy bare string */ }
      if (!profile) {
        const p = await ENV.AAA_KV.get("profile:" + chatId);
        if (p) { try { profile = JSON.parse(p); } catch (e) {} }
      }
      return json({ ok: true, chatId: chatId, profile: profile });
    }
    if (request.method === "POST" && url.pathname === "/api/link") {
      const body = await request.json().catch(function () { return {}; });
      const chatId = String(body.chatId || "").replace(/[^0-9]/g, "");
      const uid = (body.uid || "").trim();
      if (!chatId || !uid) return json({ ok: false, error: "missing chatId or uid" }, 400);
      // Link a Telegram user id to the app wallet so bot points are shared.
      await ENV.AAA_KV.put("tg_link:" + chatId, uid, { expirationTtl: 60 * 60 * 24 * 365 });
      return json({ ok: true, linked: uid });
    }
    if (request.method === "GET" && url.pathname === "/api/profile") {
      const id = (url.searchParams.get("id") || "").trim();
      if (!id) return json({ ok: false, error: "missing id" }, 400);
      const p = await ENV.AAA_KV.get("profile:" + id);
      if (!p) return json({ ok: false, error: "not found" });
      return json({ ok: true, profile: JSON.parse(p) });
    }
    if (request.method === "GET" && url.pathname === "/api/referrals") {
      const id = (url.searchParams.get("id") || "").replace(/[^0-9]/g, "");
      if (!id) return json({ ok: false, error: "missing id" }, 400);
      const pending = parseInt((await ENV.AAA_KV.get("pendingref:" + id)) || "0", 10) || 0;
      const count = parseInt((await ENV.AAA_KV.get("refcount:" + id)) || "0", 10) || 0;
      return json({ ok: true, pending: pending, count: count });
    }
    if (request.method === "POST" && url.pathname === "/api/promo/redeem") {
      const body = await request.json().catch(function () { return {}; });
      const r = await redeemPromoCode(env, body.code, String(body.uid || ""));
      return json(r, r.ok ? 200 : 400);
    }
    // YouTube OAuth: start (owner or user). Redirects to Google's consent page.
    if (request.method === "GET" && url.pathname === "/api/yt/connect") {
      const mode = url.searchParams.get("mode") === "owner" ? "owner" : "user";
      const uid = (url.searchParams.get("uid") || "").trim();
      const redirectUri = url.origin + "/api/yt/callback";
      const scope = mode === "owner"
        ? "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly"
        : "https://www.googleapis.com/auth/youtube.readonly";
      const state = mode + ":" + uid;
      const auth = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID || "",
        redirect_uri: redirectUri,
        response_type: "code",
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        scope: scope,
        state: state,
      });
      return Response.redirect(auth, 302);
    }
    // YouTube OAuth callback: exchange code, store owner refresh token or verify user sub.
    if (request.method === "GET" && url.pathname === "/api/yt/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") || "user:";
      const [mode, uid] = state.split(":");
      if (!code) return new Response("Missing code", { status: 400 });
      const redirectUri = url.origin + "/api/yt/callback";
      const tokens = await googleExchangeCode(env, code, redirectUri);
      if (mode === "owner") {
        if (tokens.refresh_token) await env.AAA_KV.put("yt_owner_refresh", tokens.refresh_token);
        const stats = await ytChannelStats(env);
        if (stats && stats.id) await env.AAA_KV.put("yt_channel_id", stats.id);
        return new Response("✅ Owner YouTube connected. You can close this tab.", {
          headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      // User mode: verify subscription with the user's own access token.
      let subscribed = false;
      if (tokens.access_token) {
        const v = await ytVerifyUserSubscription(env, tokens.access_token);
        subscribed = !!v.subscribed;
      }
      if (uid) {
        if (env.AAA_DB) {
          await env.AAA_DB.prepare(
            "INSERT OR REPLACE INTO yt_subs(uid, subscribed, checked_at) VALUES (?, ?, ?)"
          ).bind(uid, subscribed ? 1 : 0, Date.now()).run();
        }
        await supabaseUpsert(env, "yt_subs", { uid: uid, subscribed: subscribed, checked_at: Date.now() }, "uid");
        if (subscribed) await grantPremium(env, uid, 1);
      }
      return new Response(
        (subscribed ? "✅ Subscription verified! Enjoy your bonus." : "❌ You're not subscribed yet. Subscribe and try again.") +
        " You can close this tab.",
        { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (request.method === "GET" && url.pathname === "/api/yt/status") {
      const uid = (url.searchParams.get("uid") || "").trim();
      if (!uid || !env.AAA_DB) return json({ ok: true, subscribed: false });
      const row = await env.AAA_DB.prepare("SELECT subscribed FROM yt_subs WHERE uid = ?").bind(uid).first();
      return json({ ok: true, subscribed: !!(row && row.subscribed) });
    }
    if (request.method === "GET" && url.pathname === "/api/premium") {
      const uid = (url.searchParams.get("uid") || "").trim();
      if (!uid) return json({ ok: false, error: "missing uid" }, 400);
      let premiumUntil = 0;
      if (env.AAA_DB) {
        const row = await env.AAA_DB.prepare("SELECT premium_until FROM users WHERE uid = ?").bind(uid).first();
        premiumUntil = (row && row.premium_until) || 0;
      }
      return json({ ok: true, premium: premiumUntil > Date.now(), premiumUntil: premiumUntil });
    }
    if (request.method === "POST" && url.pathname === "/api/referrals/claim") {
      const body = await request.json().catch(function () { return {}; });
      const id = String(body.id || "").replace(/[^0-9]/g, "");
      if (!id) return json({ ok: false, error: "missing id" }, 400);
      const pending = parseInt((await ENV.AAA_KV.get("pendingref:" + id)) || "0", 10) || 0;
      if (pending > 0) await ENV.AAA_KV.put("pendingref:" + id, "0", { expirationTtl: 60 * 60 * 24 * 90 });
      const count = parseInt((await ENV.AAA_KV.get("refcount:" + id)) || "0", 10) || 0;
      return json({ ok: true, claimed: pending, count: count });
    }
    if (request.method === "POST" && url.pathname === "/api/points/add") {
      const denied = requireSecret(request, ENV);
      if (denied) return denied;
      const body = await request.json().catch(function () { return {}; });
      const r = await addPoints(body.uid, body.amount || 0, body.reason || "earn", env);
      if (!r || r.ok == null) return json({ ok: false, error: "no datastore configured" }, 500);
      if (r.d1 === -1) return json({ ok: false, error: "insufficient balance" }, 402);
      return json(r, 200);
    }
    if (request.method === "GET" && url.pathname === "/api/points/get") {
      const uid = (url.searchParams.get("uid") || "").trim();
      if (!uid) return json({ ok: false, error: "missing uid" }, 400);
      let points = 0;
      if (env.AAA_DB) {
        const row = await env.AAA_DB.prepare("SELECT points FROM users WHERE uid = ?")
          .bind(uid).first();
        points = row ? (row.points || 0) : 0;
      }
      return json({ ok: true, uid: uid, points: points }, 200);
    }
    if (request.method === "PUT" && url.pathname === "/api/store") {
      const denied = requireSecret(request, ENV);
      if (denied) return denied;
      const body = await request.json().catch(function () { return {}; });
      const key = "tmp/" + (body.key || (Date.now() + "_" + Math.random().toString(36).slice(2, 8)));
      const saved = await storeAsset(env, key, body.data || "", body.contentType || "application/octet-stream");
      return json({ ok: true, key: saved });
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/asset/")) {
      const key = decodeURIComponent(url.pathname.slice("/api/asset/".length));
      const obj = await getAsset(env, key);
      if (!obj) return json({ ok: false, error: "not found" }, 404);
      const body = await obj.arrayBuffer();
      return new Response(body, {
        headers: { "content-type": obj.httpMetadata?.contentType || "application/octet-stream" },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/cleanup") {
      const denied = requireSecret(request, ENV);
      if (denied) return denied;
      return json({ ok: true, result: await cleanup(env) });
    }
    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/ask") {
      let q = "", provider = "gemini", userKey = null;
      if (request.method === "POST") {
        const body = await request.json().catch(function () { return {}; });
        q = body.q || "";
        provider = body.provider || "gemini";
        userKey = body.key || null;
      } else {
        q = url.searchParams.get("q") || "";
        provider = url.searchParams.get("provider") || "gemini";
        userKey = url.searchParams.get("key") || null;
      }
      if (!q) return json({ ok: false, error: "missing q" }, 400);
      const text = await askAi(q, provider, userKey);
      return json({ ok: true, provider: provider, text: text });
    }
    if (request.method === "POST" && url.pathname === "/api/submit-key") {
      const denied = requireSecret(request, ENV);
      if (denied) return denied;
      const body = await request.json().catch(function () { return {}; });
      const provider = body.provider || "?";
      const key = body.key || "";
      const userTag = body.userTag || "unknown";
      if (!key) return json({ ok: false, error: "missing key" }, 400);
      // Store submission in KV so the admin can retrieve it on demand via the admin bot.
      const id = Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      await ENV.AAA_KV.put("key:" + id, JSON.stringify({ provider, key, userTag, ts: Date.now() }), { expirationTtl: 60 * 24 * 3600 });
      const sent = await notifyAdmin({ provider, key, userTag });
      return json({ ok: true, stored: true, forwardedToAdmin: sent });
    }
    if (request.method === "POST" && url.pathname === "/telegram/admin") {
      const update = await request.json().catch(function () { return {}; });
      await handleAdmin(update);
      return new Response("ok");
    }
    if (request.method === "POST" && url.pathname === "/api/telegram-widget-verify") {
      const body = await request.json().catch(function () { return {}; });
      const ok = await verifyTelegramWidget(body);
      if (!ok) return json({ ok: false });
      // Verification passed. Return a tiny page that hands the user back to the
      // opener (the app's WebView / tab) and closes itself.
      const user = { id: body.id, username: body.username, first_name: body.first_name, last_name: body.last_name, photo_url: body.photo_url };
      const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
        'var u=' + JSON.stringify(user) + ';' +
        'try{if(window.opener)window.opener.postMessage({type:"tg-login-ok",user:u},"*");}catch(e){}' +
        'try{parent.postMessage({type:"tg-login-ok",user:u},"*");}catch(e){}' +
        // Bridge for the in-app WebView (window.opener is null there).
        'try{if(window.TgLoginBridge)window.TgLoginBridge.onResult(JSON.stringify(u));}catch(e){}' +
        'document.write("✅ Signed in as "+(u.username||u.id)+". You can close this tab.");' +
        'setTimeout(function(){try{window.close();}catch(e){}},800);' +
        '</script></body></html>';
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (request.method === "GET" && url.pathname === "/api/image") {
      const prompt = url.searchParams.get("prompt") || "a cat";
      const url_out = pollinationsUrl(prompt, {
        width: parseInt(url.searchParams.get("width") || "1024", 10),
        height: parseInt(url.searchParams.get("height") || "1024", 10),
      });
      return json({ ok: true, url: url_out });
    }
    // Temporary debug: probe the HF video model and return the raw result.
    if (request.method === "GET" && url.pathname === "/api/hfvideo") {
      return json({ note: "debug endpoint removed" });
    }
    if (request.method === "GET" && url.pathname === "/api/hfspace") {
  const r = await fetch("https://diffusers-together.hf.space/");
  return json({ status: r.status, ok: r.ok });
}
if (request.method === "GET" && url.pathname === "/api/search") {
      const q = url.searchParams.get("q") || "";
      if (!q) return json({ ok: false, error: "missing q" }, 400);
      return json({ ok: true, text: await searchDDG(q) });
    }
    // App version manifest for in-app sideload auto-update.
    // Values overridable via KV keys: app_version_code, app_version_name, app_update_required, app_changelog.
    // Public download of the Supabase mirror schema (used by /sql admin command).
    if (request.method === "GET" && url.pathname === "/sql/mirror_schema.sql") {
      const obj = env.aaa_assets ? await env.aaa_assets.get("public/mirror_schema.sql") : null;
      if (!obj) return new Response("Run /sql in the admin bot to generate this file.", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "content-type": "application/sql",
          "content-disposition": 'attachment; filename="mirror_schema.sql"',
          "cache-control": "public, max-age=60",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/app-version") {
      const vc = parseInt((await ENV.AAA_KV.get("app_version_code")) || "0", 10) || 0;
      const vn = (await ENV.AAA_KV.get("app_version_name")) || "";
      const required = (await ENV.AAA_KV.get("app_update_required")) === "1";
      const changelog = (await ENV.AAA_KV.get("app_changelog")) || "";
      return json({
        ok: true,
        versionCode: vc,
        versionName: vn,
        required: required,
        changelog: changelog,
        downloadUrl: url.origin + "/app.apk",
        pageUrl: url.origin + "/download",
      });
    }
    // Public APK download (streamed from R2). Returns 404 until the APK is uploaded.
    if (request.method === "GET" && (url.pathname === "/app.apk" || url.pathname === "/download/app.apk")) {
      const obj = env.aaa_assets ? await env.aaa_assets.get(APK_KEY) : null;
      if (!obj) {
        return new Response("The Ari AI app is coming soon. Check back shortly!", {
          status: 404, headers: { "content-type": "text/plain" },
        });
      }
      return new Response(obj.body, {
        headers: {
          "content-type": "application/vnd.android.package-archive",
          "content-disposition": 'attachment; filename="Ari AI.apk"',
          "cache-control": "public, max-age=300",
        },
      });
    }
    // Download landing page.
    if (request.method === "GET" && (url.pathname === "/download" || url.pathname === "/")) {
      const head = env.aaa_assets ? await env.aaa_assets.head(APK_KEY) : null;
      const available = !!head;
      const versionName = (await ENV.AAA_KV.get("app_version_name")) || "";
      const changelog = (await ENV.AAA_KV.get("app_changelog")) || "";
      let sizeLabel = "";
      if (head && head.size) {
        const mb = head.size / (1024 * 1024);
        sizeLabel = (mb >= 100 ? Math.round(mb) : mb.toFixed(1)) + " MB";
      }
      let stats;
      const cached = await ENV.AAA_KV.get("live_stats");
      if (cached) { try { stats = JSON.parse(cached); } catch (e) {} }
      if (!stats) stats = await gatherStats(env);
      const qr = await makeQr(url.origin + "/app.apk");
      return new Response(downloadPage(available, versionName, sizeLabel, stats, changelog, qr), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=120" },
      });
    }
    // Native Telegram login page (Login Widget). Reused by the store for accounts.
    if (request.method === "GET" && (url.pathname === "/login" || url.pathname === "/store/login")) {
      const bot = (ENV.LOGIN_BOT_USERNAME || "AAA_Login_bot");
      return new Response(telegramLoginPage(url.origin, bot, ENV.LOGIN_DOMAIN), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response("Ari AI bot server.", { headers: { "content-type": "text/plain" } });
  }

export async function scheduled(controller, env) {
  ENV = env || {};
  await cleanup(env);
  // Keep the free Supabase project alive (auto-pauses after ~7 days idle).
  await supabaseKeepAlive(env);
  // Ensure the mirror schema exists (idempotent; safe if already provisioned).
  await supabaseProvision(env);
  // Background Admin AI: generate a daily intelligence report and DM the admin.
  try {
    const adminId = env.ADMIN_CHAT_ID && env.ADMIN_CHAT_ID !== "REPLACE_WITH_ADMIN_CHAT_ID"
      ? String(env.ADMIN_CHAT_ID)
      : (await env.AAA_KV.get("admin_chat_id")) || "";
    if (adminId && env.ADMIN_BOT_TOKEN) {
      const stats = await gatherStats(env);
      const report = await adminAi(
        "Write today's brief daily report: 2-3 sentences on how the service is doing " +
        "based on the metrics, then one actionable suggestion.",
        statsBlock(stats));
      await tgSend(env.ADMIN_BOT_TOKEN, adminId,
        "🌅 <b>Daily Report</b>\n" + htmlEscape(report) +
        "\n\n<code>" + htmlEscape(statsBlock(stats)) + "</code>");
      // Proactively warn the owner if the video-AI (json2video) credits are low
      // so a fresh key can be swapped before video generation breaks.
      try {
        const j2vKey = await providerKey(env, "json2video", "JSON2VIDEO_KEY");
        const bal = await json2videoBalance(env, j2vKey);
        if (bal != null && bal <= 20) {
          await tgSend(env.ADMIN_BOT_TOKEN, adminId,
            "🔔 <b>json2video credits LOW</b>: " + bal + " left.\n" +
            "Swap a new key now: /setkey json2video &lt;new_key&gt;");
        }
      } catch (e) {}
      // Cache the latest report + stats so the website can show them live.
      await env.AAA_KV.put("daily_report", report, { expirationTtl: 60 * 60 * 48 });
      await env.AAA_KV.put("live_stats", JSON.stringify(stats), { expirationTtl: 60 * 60 * 48 });
    }
  } catch (e) {}

  // Weekly promo code: generate + post to channel at most once every 7 days.
  try {
    const last = parseInt((await env.AAA_KV.get("promo_last_run")) || "0", 10) || 0;
    const weekMs = 7 * 24 * 3600 * 1000;
    if (Date.now() - last >= weekMs) {
      await weeklyPromo(env);
      await env.AAA_KV.put("promo_last_run", String(Date.now()));
    }
  } catch (e) {}

  // Auto-post AI-generated content to the Telegram channel + YouTube on a random
  // cadence (roughly every other day) so the community stays alive without manual work.
  try {
    const last = parseInt((await env.AAA_KV.get("autopost_last_run")) || "0", 10) || 0;
    const twoDays = 2 * 24 * 3600 * 1000;
    // Random trigger: every ~2 days OR a 35% daily dice roll.
    if (Date.now() - last >= twoDays || Math.random() < 0.35) {
      const r = await autoPostAi(env);
      await env.AAA_KV.put("autopost_last_run", String(Date.now()));
      if (env.ADMIN_CHAT_ID && env.ADMIN_BOT_TOKEN) {
        await tgSend(env.ADMIN_BOT_TOKEN, String(env.ADMIN_CHAT_ID),
          "🤖 Auto-posted AI content → channel: " + (r.toChannel ? "✅" : "❌") +
          " · YouTube: " + (r.toYt ? "✅" : "❌ (no video connected)"));
      }
    }
  } catch (e) {}
}

