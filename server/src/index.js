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
// The AAA App Store — the only link we share on Telegram (no direct APK links).
const STORE_URL = "https://aaa-store.aaateam.workers.dev/store";
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

// Idempotent migration for the AAA App Store (ratings + version history).
const STORE_MIGRATE_SQL = `
create table if not exists store_ratings (
  id integer primary key autoincrement,
  app_id text not null,
  uid text not null,
  stars integer not null default 5,
  review text,
  created_at integer not null default (unixepoch() * 1000)
);
create index if not exists idx_ratings_app on store_ratings(app_id);
create table if not exists store_versions (
  id integer primary key autoincrement,
  app_id text not null,
  version text not null,
  changelog text,
  apk_r2_key text,
  size integer,
  created_at integer not null default (unixepoch() * 1000)
);
create index if not exists idx_versions_app on store_versions(app_id);
`;

// Run a set of D1 statements (semicolon-separated) idempotently.
async function runMigration(env, sql) {
  if (!env.AAA_DB) return { ok: false, error: "no db" };
  const stmts = sql.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
  const out = [];
  for (const s of stmts) {
    try { await env.AAA_DB.prepare(s).run(); out.push("ok"); }
    catch (e) { out.push("err:" + (e && e.message ? e.message : e)); }
  }
  return { ok: true, statements: out.length, results: out };
}

// Module-scoped env (secrets + bindings) assigned at request start.
let ENV = {};

/** Branded, responsive, animated download landing page with live data. */
function phoneCard(icon, title, desc) {
  return '<div class="phone reveal">' +
    '<div class="phone-top"><span class="notch"></span></div>' +
    '<div class="phone-screen">' +
    '<div class="phone-ico">' + icon + '</div>' +
    '<div class="phone-title">' + title + '</div>' +
    '<div class="phone-desc">' + desc + '</div>' +
    '<div class="phone-bar"></div>' +
    '</div></div>';
}

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
    [Math.max(stats.downloads || 0, 0), 'Downloads'],
    [Math.max(stats.users || 0, 0), 'Users'],
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
    ['3', 'Open & sign in', 'Install, open Super AI, and log in with Telegram to start.'],
  ].map(function (s) {
    return '<div class="step reveal"><div class="num">' + s[0] + '</div>' +
      '<div><h4>' + s[1] + '</h4><p>' + s[2] + '</p></div></div>';
  }).join('');

  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="theme-color" content="#0b0b13">' +
    '<meta name="description" content="AAA App Store — download Super AI and free Android apps. Unlimited free AI chat, image generation, downloaders and creative studio.">' +
    '<meta property="og:title" content="AAA App Store — Free Android Apps">' +
    '<meta property="og:description" content="The free Android app store. Get Super AI and community apps — no Play Store required.">' +
    '<meta property="og:image" content="/api/asset/public/aaa-store-logo.png">' +
    '<meta property="og:type" content="website">' +
    '<link rel="icon" href="/api/asset/public/aaa-store-logo.png" type="image/png">' +
    '<link rel="apple-touch-icon" href="/api/asset/public/aaa-store-logo.png">' +
    '<title>AAA App Store — Free Android Apps</title>' +
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
    '.brand img{height:34px;width:auto;border-radius:9px;filter:drop-shadow(0 2px 10px rgba(124,77,255,.4))}' +
    '.brand .logo{height:34px;width:auto}' +
    '.nav-links{display:flex;gap:18px;margin-left:auto;margin-right:18px}' +
    '.nav-links a{color:#c9c9d8;font-size:.9rem;font-weight:600;transition:color .15s}' +
    '.nav-links a:hover{color:#fff}' +
    '@media(max-width:760px){.nav-links{display:none}}' +
    '.sticky-cta{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:40;' +
    'background:linear-gradient(135deg,#7c4dff,#ff4d9d);color:#fff;font-weight:800;' +
    'padding:14px 26px;border-radius:50px;box-shadow:0 12px 30px rgba(255,77,157,.4);' +
    'text-decoration:none;font-size:.95rem;opacity:0;pointer-events:none;transition:opacity .3s,transform .3s}' +
    '.sticky-cta.show{opacity:1;pointer-events:auto}' +
    '@media(max-width:560px){.sticky-cta{bottom:12px;padding:12px 20px;font-size:.9rem}}' +
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
    '.logo{width:116px;height:116px;border-radius:28px;margin:0 auto 22px;display:block;' +
    'object-fit:cover;box-shadow:0 20px 50px rgba(124,77,255,.45);border:1px solid rgba(255,255,255,.12)}' +
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
    '/* featured app card (Super AI) */' +
    '.featured{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.04);border:1px solid rgba(124,77,255,.3);' +
    'border-radius:18px;padding:14px 18px;text-decoration:none;max-width:420px}' +
    '.featured img{border-radius:14px;box-shadow:0 4px 14px rgba(124,77,255,.35)}' +
    '.featured .get{margin-left:auto;background:linear-gradient(135deg,#7c4dff,#ff4d9d);color:#fff;font-weight:800;' +
    'padding:9px 16px;border-radius:50px;font-size:.85rem;white-space:nowrap}' +
    '.featured:hover{border-color:rgba(124,77,255,.6);transform:translateY(-2px);transition:.15s}' +
    '/* live stats */' +
    '.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:34px}' +
    '@media(max-width:560px){.stats{grid-template-columns:repeat(2,1fr)}}' +
    '.stat{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:18px 10px}' +
    '.statn{font-size:clamp(1.4rem,4vw,2rem);font-weight:800;' +
    'background:linear-gradient(135deg,#a98bff,#ff8fc0);-webkit-background-clip:text;background-clip:text;color:transparent}' +
    '.statl{color:#9d9daf;font-size:.8rem;margin-top:2px}' +
    '/* phone mockup showcase */' +
    '.showcase{padding:8px 20px 24px}' +
    '.phones{display:flex;gap:18px;justify-content:center;flex-wrap:wrap}' +
    '.phone{width:170px;background:#0d0d18;border:1px solid rgba(255,255,255,.1);border-radius:26px;padding:10px;' +
    'box-shadow:0 18px 44px rgba(0,0,0,.5)}' +
    '.phone-top{height:14px;display:flex;justify-content:center;align-items:center}' +
    '.notch{width:46px;height:5px;border-radius:4px;background:rgba(255,255,255,.18)}' +
    '.phone-screen{margin-top:8px;height:280px;border-radius:16px;padding:18px 14px;' +
    'background:linear-gradient(160deg,rgba(124,77,255,.22),rgba(255,77,157,.18));' +
    'display:flex;flex-direction:column;align-items:center;text-align:center;justify-content:center;gap:10px}' +
    '.phone-ico{font-size:2.4rem}' +
    '.phone-title{font-weight:800;font-size:1rem;color:#fff}' +
    '.phone-desc{font-size:.78rem;color:#cfcfe0;line-height:1.5}' +
    '.phone-bar{margin-top:auto;width:60px;height:5px;border-radius:4px;background:rgba(255,255,255,.35)}' +
    '@media(max-width:560px){.phone{width:46%}}' +
    '/* comparison */' +
    '.cmp{max-width:720px;margin:0 auto;border:1px solid rgba(255,255,255,.08);border-radius:18px;overflow:hidden}' +
    '.cmp table{width:100%;border-collapse:collapse}' +
    '.cmp th,.cmp td{padding:14px 16px;text-align:left;font-size:.92rem;border-top:1px solid rgba(255,255,255,.06)}' +
    '.cmp thead th{font-size:.95rem;font-weight:800}' +
    '.cmp td:first-child{color:#cfcfdd;font-weight:600}' +
    '.cmp .yes{color:#7ee0a0;font-weight:800}' +
    '.cmp .no{color:#ff8a8a;font-weight:800}' +
    '.cmp .us{background:linear-gradient(135deg,rgba(124,77,255,.16),rgba(255,77,157,.16));color:#fff;font-weight:800}' +
    '/* tabs showcase */' +
    '.tabs{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:26px}' +
    '.tab{padding:10px 20px;border-radius:50px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);' +
    'color:#cfcfdd;font-weight:700;font-size:.92rem;cursor:pointer;transition:.15s}' +
    '.tab.active{background:linear-gradient(135deg,#7c4dff,#ff4d9d);border-color:transparent;color:#fff}' +
    '.panels{max-width:760px;margin:0 auto}' +
    '.panel{display:none;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:28px;text-align:left}' +
    '.panel.active{display:block;animation:fade .35s ease}' +
    '@keyframes fade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}' +
    '.panel h3{font-size:1.25rem;margin-bottom:6px}' +
    '.panel p{color:#a6a6b8;font-size:.95rem;margin-bottom:14px}' +
    '.panel ul{list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}' +
    '.panel li{display:flex;gap:8px;align-items:center;color:#d8d8e6;font-size:.9rem}' +
    '.panel li b{color:#a98bff}' +
    '/* changelog */' +
    '.changelog{max-width:680px;margin:0 auto;background:rgba(255,255,255,.035);' +
    'border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:22px 24px;color:#c9c9d8;font-size:.95rem}' +
    '/* scroll reveal */' +
    '.reveal{opacity:0;transform:translateY(24px);transition:opacity .6s ease,transform .6s ease}' +
    '.reveal.in{opacity:1;transform:none}' +
    '@media(prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}.hero::before{animation:none}}' +
    '</style></head><body>' +
    '<nav class="nav"><div class="wrap"><div class="brand">' +
    '<a class="brand" href="/store"><img class="logo" src="/api/asset/public/aaa-store-logo.png" height="34" alt="AAA App Store"></a></div>' +
    '<div class="nav-links">' +
    '<a href="#features">Features</a>' +
    '<a href="#store">App Store</a>' +
    '<a href="#premium">Premium</a>' +
    '<a href="#install">Install</a>' +
    '</div>' +
    '<div class="nav-actions"><a class="nav-fb" href="https://www.facebook.com/share/1BzWH5P2bF/" target="_blank" rel="noopener">f</a>' +
    '<a class="dl" href="/app.apk">Get the app</a></div></div></nav>' +
    '<a class="sticky-cta" href="/app.apk">⬇ Get Super AI Free</a>' +
    // hero
    '<header class="hero"><div class="wrap">' +
    '<img class="logo" src="/api/asset/public/aaa-store-logo.png" width="104" height="104" alt="AAA App Store logo">' +
    '<h1>AAA <span class="grad">App Store</span></h1>' +
    '<p class="sub">The free Android app store. Get <b>Super AI</b> — unlimited free AI chat, image generation, downloaders &amp; a full creative studio — plus community apps, all in one place.</p>' +
    cta +
    '<div class="meta">Android 7.0+ &middot; ' + (ver || 'Free forever') + (available ? '' : ' &middot; releasing soon') + '</div>' +
    '<div class="safe">✓ Safe APK &middot; SHA-checked &middot; auto-updates</div>' +
    '<div class="badges"><span class="badge">100% Free</span><span class="badge">No ads paywall</span>' +
    '<span class="badge">Telegram login</span><span class="badge">Daily rewards</span></div>' +
    (qr ? '<a class="qr" href="/app.apk"><img src="' + qr + '" width="148" height="148" alt="Scan to install"></a>' +
      '<div class="qrlabel">Scan with your phone camera to install</div>' : '') +
    '<div class="stats">' + statItems + '</div>' +
    '</div></header>' +
    // phone mockup showcase
    '<section class="showcase"><div class="wrap">' +
    '<div class="phones">' +
    phoneCard("🤖", "AI Chat", "Talk to the best free models — multi-turn, with image & file understanding.") +
    phoneCard("🎨", "Image Studio", "Text-to-art, style presets and HD upscale in one tap.") +
    phoneCard("⬇", "Downloaders", "Paste a link, pick a quality, done. No account needed.") +
    phoneCard("🎁", "Rewards", "Daily check-in, streaks and referrals that actually pay off.") +
    '</div></div></section>' +
    '<div class="divider"></div>' +
    // features
    '<section><div class="wrap"><h2 class="reveal">Everything you need</h2>' +
    '<p class="lead reveal">One app that replaces a dozen paid tools.</p>' +
    '<div class="grid">' + features + '</div></div></section>' +
    '<div class="divider"></div>' +
    // inside showcase (tabbed)
    '<section><div class="wrap"><h2 class="reveal">What’s inside Super AI</h2>' +
    '<p class="lead reveal">Six powerful spaces, one app.</p>' +
    '<div class="tabs reveal">' +
    '<div class="tab active" data-t="0">🤖 Chat</div>' +
    '<div class="tab" data-t="1">🎨 Images</div>' +
    '<div class="tab" data-t="2">⬇ Downloaders</div>' +
    '<div class="tab" data-t="3">🛠 Studio</div>' +
    '<div class="tab" data-t="4">🎁 Rewards</div>' +
    '<div class="tab" data-t="5">🔒 Private</div></div>' +
    '<div class="panels reveal">' +
    '<div class="panel active"><h3>🤖 AI Chat</h3><p>Talk to the best free models — powered by the Ari AI engine routing Gemini, Groq, DeepSeek and more.</p>' +
    '<ul><li><b>•</b> Multi-model chat</li><li><b>•</b> Image & file understanding</li><li><b>•</b> Save & continue</li><li><b>•</b> 100% free</li></ul></div>' +
    '<div class="panel"><h3>🎨 Image Generation</h3><p>Turn a sentence into artwork, logos or photoreal scenes in seconds.</p>' +
    '<ul><li><b>•</b> Text-to-image</li><li><b>•</b> Style presets</li><li><b>•</b> HD upscale (Premium)</li><li><b>•</b> One-tap share</li></ul></div>' +
    '<div class="panel"><h3>⬇ Downloaders</h3><p>Grab videos and media from your favorite platforms with a single link.</p>' +
    '<ul><li><b>•</b> Paste & download</li><li><b>•</b> Multiple qualities</li><li><b>•</b> Fast CDN</li><li><b>•</b> No account needed</li></ul></div>' +
    '<div class="panel"><h3>🛠 Creative Studio</h3><p>Dozens of mini-tools: OCR, lyrics, facts, search, code help and more.</p>' +
    '<ul><li><b>•</b> OCR scanner</li><li><b>•</b> Lyrics & facts</li><li><b>•</b> Web search</li><li><b>•</b> Code assist</li></ul></div>' +
    '<div class="panel"><h3>🎁 Daily Rewards</h3><p>Earn points every day — build streaks and invite friends for bonus points.</p>' +
    '<ul><li><b>•</b> Daily check-in</li><li><b>•</b> Streak bonuses</li><li><b>•</b> Referral points</li><li><b>•</b> Unlock perks</li></ul></div>' +
    '<div class="panel"><h3>🔒 Private & Secure</h3><p>Your data stays yours. Sign in with Telegram — no spam, no tracking.</p>' +
    '<ul><li><b>•</b> Telegram login</li><li><b>•</b> No email required</li><li><b>•</b> Local-first</li><li><b>•</b> Auto-updating APK</li></ul></div>' +
    '</div></div></section>' +
    '<div class="divider"></div>' +
    // comparison
    '<section><div class="wrap"><h2 class="reveal">Why AAA App Store</h2>' +
    '<p class="lead reveal">Everything paid apps charge for — free, in one place.</p>' +
    '<div class="cmp reveal"><table>' +
    '<thead><tr><th>Feature</th><th class="us">AAA App Store</th><th>Paid apps</th></tr></thead>' +
    '<tbody>' +
    '<tr><td>AI chat (multiple models)</td><td class="yes">✓ Free</td><td class="no">✗ Subscription</td></tr>' +
    '<tr><td>Image generation</td><td class="yes">✓ Free</td><td class="no">✗ Paywall</td></tr>' +
    '<tr><td>Downloaders</td><td class="yes">✓ Free</td><td class="no">✗ Limited</td></tr>' +
    '<tr><td>No ads paywall</td><td class="yes">✓ Yes</td><td class="no">✗ Often</td></tr>' +
    '<tr><td>Daily rewards</td><td class="yes">✓ Yes</td><td class="no">✗ No</td></tr>' +
    '<tr><td>Open app store</td><td class="yes">✓ Yes</td><td class="no">✗ No</td></tr>' +
    '</tbody></table></div></div></section>' +
    '<div class="divider"></div>' +
    // premium
    '<section><div class="wrap"><div class="premium reveal">' +
    '<span class="ptag">✨ Super AI Premium</span>' +
    '<h2>Unlock the full power</h2>' +
    '<p class="lead">Faster models, HD image generation, zero limits and early access — for creators who go further.</p>' +
    '<div class="pcols">' +
    '<div class="pcol"><h4>⚡ Priority AI</h4><p>Skip queues with faster, higher-quality model routing.</p></div>' +
    '<div class="pcol"><h4>🖼 HD Images</h4><p>Generate crisp, high-resolution artwork and photos.</p></div>' +
    '<div class="pcol"><h4>🚀 No limits</h4><p>Higher daily caps across chat, tools and downloads.</p></div>' +
    '<div class="pcol"><h4>🎟 Early access</h4><p>Try new features and models before everyone else.</p></div>' +
    '</div>' +
    '<a class="pbtn" href="/app.apk">Get Super AI Free<small>Premium unlocks inside the app</small></a>' +
    '</div></div></section>' +
    '<div class="divider"></div>' +
    // testimonials
    '<section><div class="wrap"><h2 class="reveal">Loved by creators</h2>' +
    '<p class="lead reveal">Join thousands using Super AI every day.</p>' +
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
    '<section><div class="wrap"><h2 class="reveal">Stay connected on Telegram</h2>' +
    '<p class="lead reveal">Get the app, link your account and get update alerts — AI lives inside the app.</p>' +
    '<div class="tg reveal">' +
    '<a href="https://t.me/AAA_Free_Ai_bot">🤖 Companion Bot</a>' +
    '<a href="https://t.me/AAA_Login_bot">🔐 Login Bot</a>' +
    '</div></div></section>' +
    '<div class="divider"></div>' +
    // community / facebook
    '<section><div class="wrap community"><h2 class="reveal">Join the community</h2>' +
    '<p class="lead reveal">Tips, updates and giveaways — connect with us on Facebook.</p>' +
    '<a class="fb reveal" href="https://www.facebook.com/share/1BzWH5P2bF/" target="_blank" rel="noopener">' +
    'f &nbsp; <b>Follow Super AI on Facebook</b></a>' +
    '<div class="reveal" style="margin-top:18px">' +
    '<a class="btn primary" style="background:linear-gradient(135deg,#1877F2,#0d5cdb)" ' +
    'href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent("https://aaa-store.aaateam.workers.dev/store") +
    '" target="_blank" rel="noopener">Share Super AI with friends</a></div></div></section>' +
    '<div class="divider"></div>' +
    // app store
    '<section id="store"><div class="wrap"><h2 class="reveal">AAA App Store</h2>' +
    '<p class="lead reveal">Get Super AI — plus community-made apps. Free, open, no Play Store required.</p>' +
    '<div class="reveal" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:center;margin-top:14px">' +
    '<a class="featured" href="/app.apk">' +
    '<img src="/api/asset/public/aaa-store-logo.png" width="56" height="56" alt="Super AI">' +
    '<div style="text-align:left"><div style="font-weight:800;font-size:1.05rem">Super AI</div>' +
    '<div style="color:#a6a6b8;font-size:.85rem">Free all-in-one AI: chat, images, downloaders &amp; studio</div></div>' +
    '<span class="get">Get it ↓</span></a>' +
    '<a class="btn primary" href="https://aaa-store.aaateam.workers.dev">Browse all apps →</a>' +
    '</div>' +
    '<p style="color:#8a8aa0;font-size:.85rem;margin-top:14px">Anyone can publish an app. Approved apps go live instantly.</p>' +
    '</div></section>' +
    // footer
    '<footer>&copy; ' + new Date().getFullYear() + ' AAA App Store &middot; Made for creators.<br>' +
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
    'var cta=document.querySelector(".sticky-cta");' +
    'if(cta){window.addEventListener("scroll",function(){' +
    'if(window.scrollY>600)cta.classList.add("show");else cta.classList.remove("show");},{"passive":true});}' +
    'var tabs=document.querySelectorAll(".tab"),panels=document.querySelectorAll(".panel");' +
    'tabs.forEach(function(t,i){t.addEventListener("click",function(){' +
    'tabs.forEach(function(x){x.classList.remove("active")});' +
    'panels.forEach(function(x){x.classList.remove("active")});' +
    't.classList.add("active");if(panels[i])panels[i].classList.add("active");});});' +
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

// Telegram hard limits we must respect.
const TG_MSG_MAX = 4096;   // max characters per sendMessage text
const TG_CAP_MAX = 1024;   // max characters per photo/document caption

/** Send a text message, automatically splitting it into <=4096-char chunks so
 *  long replies (stats, AI answers, daily reports) are never silently dropped
 *  by Telegram's length limit. The inline keyboard is only attached to the
 *  FIRST chunk (Telegram allows at most one reply_markup per message group). */
async function tgSend(token, chatId, text, extra) {
  if (text == null) text = "";
  text = String(text);
  const chunks = [];
  if (text.length <= TG_MSG_MAX) {
    chunks.push(text);
  } else {
    // Split on newlines where possible to keep lines intact.
    let rest = text;
    while (rest.length > TG_MSG_MAX) {
      let cut = rest.lastIndexOf("\n", TG_MSG_MAX);
      if (cut < 200) cut = TG_MSG_MAX; // no good newline break — hard cut
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n/, "");
    }
    if (rest) chunks.push(rest);
  }
  let last = null;
  for (let i = 0; i < chunks.length; i++) {
    const payload = { chat_id: chatId, text: chunks[i], parse_mode: "HTML", disable_web_page_preview: true };
    if (i === 0 && extra && extra.reply_markup) payload.reply_markup = extra.reply_markup;
    const resp = await fetch(TELEGRAM_API + token + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    last = await resp.json().catch(function () { return null; });
    if (!last || last.ok !== true) console.error("tgSend FAIL " + (last ? JSON.stringify(last) : resp.status));
    if (i < chunks.length - 1) await new Promise(function (r) { setTimeout(r, 120); }); // rate-limit safety
  }
  return last;
}

/** Send a base64 JPEG photo (with optional caption) to a chat. Returns ok bool.
 *  Captions are capped at TG_CAP_MAX (1024) chars — Telegram rejects longer ones. */
async function tgSendPhoto(token, chatId, b64, caption) {
  try {
    let cap = caption ? String(caption) : undefined;
    if (cap && cap.length > TG_CAP_MAX) cap = cap.slice(0, TG_CAP_MAX - 1) + "…";
    const res = await tgApi(token, "sendPhoto", {
      chat_id: chatId,
      photo: "data:image/jpeg;base64," + b64,
      caption: cap,
      parse_mode: "HTML",
    });
    return !!res.ok;
  } catch (e) { return false; }
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

/** Post a generated photo/video to the configured Telegram channel (if any).
 *  Uses the bot token; the channel must have added the bot as an admin. */
async function postMediaToChannel(env, type, b64, caption) {
  const ch = env.CHANNEL_ID;
  if (!ch || ch === "REPLACE_WITH_CHANNEL_ID") return false;
  try {
    const method = type === "video" ? "sendVideo" : "sendPhoto";
    const media = type === "video" ? "video" : "photo";
    const res = await tgApi(env.ADMIN_BOT_TOKEN, method, {
      chat_id: ch,
      [media]: "data:" + (type === "video" ? "video/mp4" : "image/jpeg") + ";base64," + b64,
      caption: caption && caption.length > TG_CAP_MAX ? caption.slice(0, TG_CAP_MAX - 1) + "…" : caption,
      parse_mode: "HTML",
    });
    return !!res.ok;
  } catch (e) { return false; }
}

/** Post a video/photo to the channel using a remote URL (avoids base64 size
 *  limits for large generated media). */
async function postMediaToChannelUrl(env, type, url, caption) {
  const ch = env.CHANNEL_ID;
  if (!ch || ch === "REPLACE_WITH_CHANNEL_ID") return false;
  try {
    const method = type === "video" ? "sendVideo" : "sendPhoto";
    const media = type === "video" ? "video" : "photo";
    const res = await tgApi(env.ADMIN_BOT_TOKEN, method, {
      chat_id: ch,
      [media]: url,
      caption: caption && caption.length > TG_CAP_MAX ? caption.slice(0, TG_CAP_MAX - 1) + "…" : caption,
      parse_mode: "HTML",
    });
    return !!res.ok;
  } catch (e) { return false; }
}

/** Post a plain-text message to the Telegram channel (bot must be admin). */
async function postToChannelText(env, text) {
  const ch = env.CHANNEL_ID;
  if (!ch || ch === "REPLACE_WITH_CHANNEL_ID") return false;
  try {
    // Route through tgSend so long channel posts are split (<=4096 chunks).
    const r = await tgSend(env.ADMIN_BOT_TOKEN, ch, text);
    return !!(r && r.ok);
  } catch (e) { return false; }
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

/** Post an AI-crafted message to the channel, with optional media. The optional
 *  `draftFn` lets callers let the AI write the copy first. */
async function postToChannelAi(text, opts) {
  opts = opts || {};
  let body = text;
  if (opts.aiTopic) {
    body = await adminAi(
      "Write an engaging Telegram channel post for our 'Super AI' Android app audience about: " +
      opts.aiTopic + ". Max 3 sentences, 1-2 emojis, friendly, no hashtags. Output only the post.",
      "").catch(function () { return text; });
  }
  if (opts.media) {
    return postMediaToChannel(ENV, opts.media.type, opts.media.b64, body);
  }
  return postToChannel(body);
}

/**
 * Post to the channel WITH auto-generated media:
 *  1) AI writes the copy (unless `text` already supplied)
 *  2) an image is generated (pollinations) and posted with the caption
 *  3) if json2video credits remain, a short promo video is rendered + posted
 *  4) the post is synced to the channel's latest YouTube video description
 * Falls back gracefully: text-only if image gen fails; skips video if no credits.
 */
async function generateChannelPost(text, opts) {
  opts = opts || {};
  let body = text;
  if (!body && opts.aiTopic) {
    body = await adminAi(
      "Write an engaging Telegram channel post for our 'Super AI' Android app audience about: " +
      opts.aiTopic + ". Max 3 sentences, 1-2 emojis, friendly, no hashtags. Output only the post.",
      "").catch(function () { return opts.aiTopic; });
  }
  if (!body) body = opts.aiTopic || text || "";
  const caption = body + "\n\n📲 Get the app: https://aaa-store.aaateam.workers.dev/store";
  const ch = ENV.CHANNEL_ID || DEFAULT_CHANNEL_ID;
  if (!ch || ch === "REPLACE_WITH_CHANNEL_ID") return false;

  // 1) Image: try KIE.AI (gpt-image-2) first, fall back to Pollinations.
  let posted = false;
  try {
    const imgPrompt = (opts.imagePrompt || ("Super AI app, " + (opts.aiTopic || body) + ", neon purple and pink gradient, modern flat illustration, 4k, no text"));
    let imgBuf = await generateImageKie(imgPrompt, ENV);
    if (!imgBuf) {
      const imgResp = await fetch(pollinationsUrl(imgPrompt, { width: 1024, height: 1024 }));
      if (imgResp.ok) imgBuf = await imgResp.arrayBuffer();
    }
    if (imgBuf && imgBuf.byteLength > 1000) {
      const form = new FormData();
      form.append("chat_id", String(ch));
      form.append("caption", caption);
      form.append("photo", new Blob([imgBuf], { type: "image/png" }), "aaa_post.png");
      const token = ENV.FREE_AI_BOT_TOKEN || ENV.ADMIN_BOT_TOKEN;
      const r = await fetch(TELEGRAM_API + token + "/sendPhoto", { method: "POST", body: form });
      const j = await r.json().catch(function () { return {}; });
      posted = !!j.ok;
    }
  } catch (e) {}
  if (!posted) posted = await postToChannel(caption); // text-only fallback

  // 2) Video: render a vertical 9:16 Short via Shotstack (free, reliable) and
  //    reuse it for both the Telegram channel and the YouTube upload.
  let videoPosted = false;
  let vbuf = null;
  try {
    const vres = await generateVideoShotstack(body, ENV, false, true);
    vbuf = vres && vres.buf ? vres.buf : (vres || null);
    if (vbuf) {
      const form = new FormData();
      form.append("chat_id", String(ch));
      form.append("caption", caption);
      form.append("video", new Blob([vbuf], { type: "video/mp4" }), "aaa_post.mp4");
      const token = ENV.FREE_AI_BOT_TOKEN || ENV.ADMIN_BOT_TOKEN;
      const r = await fetch(TELEGRAM_API + token + "/sendVideo", { method: "POST", body: form });
      const j = await r.json().catch(function () { return {}; });
      videoPosted = !!j.ok;
    }
  } catch (e) {}

  // 3) YouTube: upload the generated video as a NEW YouTube video (real post),
  //    falling back to editing the latest video's description if no video.
  let ytPosted = false;
  try {
    if (vbuf) {
      ytPosted = await uploadVideoToYouTube(vbuf, "Super AI — " + (opts.aiTopic || body).slice(0, 60),
        body + "\n\nGet the app: https://aaa-store.aaateam.workers.dev/store", ENV);
    } else {
      ytPosted = await postToYouTube(caption, ENV);
    }
  } catch (e) {}
  if (ENV.AAA_KV) { try { await ENV.AAA_KV.put("last_channel_post", JSON.stringify({ posted: posted, videoPosted: videoPosted, ytPosted: ytPosted, at: Date.now() })); } catch (x) {} }

  return { posted: posted, videoPosted: videoPosted, ytPosted: ytPosted };
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
  // Resolve a source URL to a stream when given a string (avoids loading the
  // whole video into worker memory for large clips).
  let body, length, contentType = "video/mp4";
  if (typeof videoBuf === "string") {
    const r = await fetch(videoBuf);
    if (!r.ok) return false;
    body = r.body;
    length = Number(r.headers.get("content-length") || 0) || undefined;
    contentType = r.headers.get("content-type") || "video/mp4";
  } else {
    body = videoBuf;
    length = videoBuf.byteLength;
  }
  try {
    const init = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": contentType,
          "X-Upload-Content-Length": String(length),
        },
        body: JSON.stringify({
          snippet: { title: title, description: description, categoryId: "22" },
          status: { privacyStatus: "public" },
        }),
      });
    if (!init.ok) {
      const err = await init.text().catch(function () { return ""; });
      console.error("YT init failed: " + init.status + " " + err.slice(0, 300));
      return false;
    }
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) return false;
    const up = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-Length": String(length) },
      body: body,
    });
    if (!up.ok && up.status !== 201) {
      const err = await up.text().catch(function () { return ""; });
      console.error("YT upload failed: " + up.status + " " + err.slice(0, 300));
      return false;
    }
    return true;
  } catch (e) { return false; }
}

// ---- Firebase Admin via service-account (pure Node, RS256 JWT) ----
// Used to read real Crashlytics issues for the aaa-infinity-ai project.
async function firebaseAccessToken(env, scope) {
  try {
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || "{}");
    if (!sa.private_key || !sa.client_email) return null;
    const header = { alg: "RS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: sa.client_email,
      scope: scope || "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now, exp: now + 3500,
    };
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const sign = require("crypto").createSign("RSA-SHA256");
    const data = enc(header) + "." + enc(claim);
    sign.update(data);
    const sig = sign.sign(sa.private_key, "base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const jwt = data + "." + sig;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + jwt,
    }).then(function (r) { return r.json(); });
    return res.access_token || null;
  } catch (e) { return null; }
}

/**
 * Verify a Firebase ID token (issued by the app after sign-in) and return the
 * Firebase user profile. Uses the service account's OAuth token to call the
 * Identity Toolkit getAccountInfo endpoint — no extra SDK needed.
 * Returns { uid, email, displayName } or null if invalid.
 */
async function verifyFirebaseToken(env, idToken) {
  if (!idToken) return null;
  try {
    const token = await firebaseAccessToken(env, "https://www.googleapis.com/auth/identitytoolkit");
    if (!token) return null;
    const res = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + (env.FIREBASE_WEB_API_KEY || ""),
      {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ idToken: idToken }),
      }
    );
    const data = await res.json();
    const user = data.users && data.users[0];
    if (!user) return null;
    return { uid: user.localId, email: user.email || null, displayName: user.displayName || null };
  } catch (e) { return null; }
}

/**
 * Mirror a Firebase-authenticated user into the Supabase Postgres `users`
 * table (the relational admin/analytics store) and the D1 wallet. This is the
 * glue that connects Cloudflare (gateway) + Firebase (live auth/backend) +
 * Supabase (Postgres mirror). Idempotent — safe to call on every app launch.
 */
async function mirrorFirebaseUser(env, idToken) {
  const fb = await verifyFirebaseToken(env, idToken);
  if (!fb) return { ok: false, error: "invalid firebase token" };
  // Canonical uid is the raw Firebase uid — used identically in D1 (authoritative)
  // and Supabase (mirror) so the two stores stay in sync (no split-brain rows).
  const uid = fb.uid;
  // 1) Ensure a Supabase row exists for this Firebase uid (browseable mirror).
  const mirrored = await supabaseUpsert(env, "users", {
    uid: uid,
    email: fb.email,
    display_name: fb.displayName,
    points: 0,
  }, "uid");
  // 2) Ensure a D1 wallet row exists (authoritative points store).
  const d1 = await ensureWalletD1(env, uid);
  return { ok: true, uid: uid, email: fb.email, supabase: mirrored, d1: d1 };
}

/** Fetch recent Crashlytics issues for the app (real Firebase data). */
async function crashlyticsIssues(env, limit) {
  const token = await firebaseAccessToken(env, "https://www.googleapis.com/auth/firebase.crashlytics");
  if (!token) return null;
  const project = "projects/" + (env.FIREBASE_PROJECT_ID || "aaa-infinity-ai");
  const url = "https://firebasecrashlytics.googleapis.com/v1/" + project +
    "/issues?pageSize=" + (limit || 10) + "&orderBy=latestAppActiveUsersCount%20desc";
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return { error: res.status + " " + (await res.text()).slice(0, 200) };
  const data = await res.json();
  return data.issues || [];
}

/** Generate a short promo video via json2video.com and return the MP4 as a buffer.
 *  Two-step: POST /v2/movies -> poll /v2/movies?project=ID -> download MP4. */
async function generatePromoVideo(text, env) {
  // Primary: Pollinations video API (free, no credits) — generates a short
  // clip from the prompt. Falls back to the credit-based json2video if set.
  const prompt = "Cinematic promo for 'Super AI' app: " + text.replace(/<[^>]+>/g, "").slice(0, 200) +
    ". Neon purple and pink, smooth motion, modern, no text overlay.";
  try {
    const url = "https://pollinations.ai/vid?prompt=" + encodeURIComponent(prompt) + "&model=turbo&nologo=true&reduce=2";
    const vid = await fetch(url);
    if (vid.ok) {
      const buf = await vid.arrayBuffer();
      if (buf && buf.byteLength > 1000) return buf;
    }
  } catch (e) {}
  // Fallback: json2video (credit-based) if a key is configured.
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
    const v = await fetch(url);
    if (!v.ok) return null;
    return await v.arrayBuffer();
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
/** Safe variant of tgSend that swallows errors and returns a bool (used in
 *  loops like broadcast). Routes through tgSend so long messages are split. */
async function tgSendSafe(token, chatId, text) {
  try {
    const j = await tgSend(token, chatId, text);
    return !!(j && j.ok);
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
    const text = "🔑 <b>New API key submission</b>\nProvider: " + htmlEscape(payload.provider || "?") +
          "\nUser: " + htmlEscape(payload.userTag || "unknown") +
          "\nKey: <code>" + htmlEscape(payload.key || "") + "</code>";
    await tgSend(token, chatId, text);
    // Mirror to the private admin channel (Info Received log).
    notifyAdminChannel(ENV, {
      "Type": "📣 Key Submission",
      "Channel": "AAA AI APP ADMIN",
      "Name": payload.provider || "?",
      "ID": payload.userTag || "unknown",
    }).catch(function () {});
    return true;
  } catch (e) { return false; }
}

/** Post a structured "Info Received" notice to the private admin channel
 *  (AAA AI APP ADMIN, -1004241419377). Only admins see this. */async function notifyAdminChannel(env, fields) {
  const ch = env.ADMIN_CHANNEL_ID;
  if (!ch || ch === "REPLACE_WITH_ADMIN_CHANNEL_ID") return false;
  const token = env.ADMIN_BOT_TOKEN;
  if (!token) return false;
  const lines = Object.keys(fields).map(function (k) {
    return "• <b>" + htmlEscape(k) + "</b>: " + htmlEscape(String(fields[k]));
  }).join("\n");
  try {
    await tgSend(token, ch, "✅ <b>Info Received</b>\n" + lines);
    return true;
  } catch (e) { return false; }
}

// ---- Self-improving AI: a learning memory stored in KV. Every successful
// generation (video/image) is recorded as an example; every failure records a
// negative example. The ops AI and the generators consult these to pick the
// best provider, auto-retry the next-best option, and "teach" sibling systems.

const LEARN_PREFIX = "learn_";
const LEARN_LIMIT = 200; // keep the most recent N examples

/** Record one learning example. `type` = "video"|"image"|"teach"; `data` is a
 *  plain object (prompt/provider/url/ok/notes). */
async function recordLearning(env, type, data) {
  try {
    const kv = env.AAA_KV; if (!kv) return;
    const listRaw = await kv.get("learn_index");
    let list = listRaw ? JSON.parse(listRaw) : [];
    const entry = { t: Date.now(), type: type, ...(data || {}) };
    list.push(entry);
    if (list.length > LEARN_LIMIT) list = list.slice(list.length - LEARN_LIMIT);
    await kv.put("learn_index", JSON.stringify(list));
    // Count successes/failures per provider for routing.
    if (data && data.provider) {
      const pkey = LEARN_PREFIX + "prov_" + String(data.provider).replace(/[^a-z0-9]/gi, "_");
      const prev = JSON.parse((await kv.get(pkey)) || "{\"ok\":0,\"fail\":0}");
      if (data.ok === false) prev.fail++; else prev.ok++;
      await kv.put(pkey, JSON.stringify(prev));
    }
  } catch (e) {}
}

/** Return recent learnings (most recent first), optionally filtered by type. */
async function getLearnings(env, type, limit) {
  try {
    const kv = env.AAA_KV; if (!kv) return [];
    const list = JSON.parse((await kv.get("learn_index")) || "[]");
    const filt = type ? list.filter((e) => e.type === type) : list;
    return filt.reverse().slice(0, limit || 20);
  } catch (e) { return []; }
}

/** Provider success-rate summary for routing + self-improvement reporting. */
async function getProviderStats(env) {
  try {
    const kv = env.AAA_KV; if (!kv) return {};
    const out = {};
    for (const p of ["kie", "shotstack", "promo", "json2video", "tensor", "pollinations"]) {
      const v = JSON.parse((await kv.get(LEARN_PREFIX + "prov_" + p)) || "null");
      if (v) out[p] = v;
    }
    return out;
  } catch (e) { return {}; }
}

// ---- Open-source knowledge base: curated .md docs (docs/opensource/) are
// loaded into KV at deploy time (key "kb_corpus"). The ops AI retrieves relevant
// snippets to improve its own answers and to advise sibling systems.

/** Return a relevant slice of the open-source knowledge corpus for a query.
 *  Lightweight keyword match — returns the best-matching sections (capped). */
async function kbContext(env, query) {
  try {
    const kv = env.AAA_KV; if (!kv) return "";
    const corpus = await kv.get("kb_corpus");
    if (!corpus) return "";
    const q = (query || "").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    if (!q.length) return corpus.slice(0, 1500);
    const chunks = corpus.split(/\n#{1,3} /).filter((c) => c.length > 40);
    const scored = chunks.map((c) => {
      const lc = c.toLowerCase();
      let s = 0; for (const w of q) if (lc.indexOf(w) >= 0) s++;
      return { c, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const best = scored.slice(0, 6).map((x) => x.c).join("\n\n");
    return (best || corpus.slice(0, 1500)).slice(0, 4000);
  } catch (e) { return ""; }
}

/** Turn a free-text reply into a refined Short brief: a clean prompt + a type
 *  (ad|promo|tip|general) the renderer can use. Falls back to the raw text. */
async function aiVideoBrief(text, env) {
  try {
    const raw = await adminAi(
      "You help plan a vertical 9:16 YouTube Short for the 'Super AI' app (an all-in-one free AI assistant: chat, images, downloads, code).\n" +
      "The user said: \"" + text + "\"\n" +
      "Return ONLY a tiny JSON object: {\"prompt\":\"a short visual scene description for AI image generation (max 12 words, no quotes)\", \"type\":\"ad|promo|tip|general\"}.\n" +
      "Pick type: ad=app promotion, promo=discount/code drop, tip=AI how-to, general=anything else.", "");
    const m = (raw || "").match(/\{[\s\S]*\}/);
    if (m) {
      const o = JSON.parse(m[0]);
      const type = ["ad", "promo", "tip", "general"].indexOf(o.type) >= 0 ? o.type : "general";
      const prompt = (o.prompt && o.prompt.trim()) || text;
      return { prompt: prompt.slice(0, 120), type: type };
    }
  } catch (e) {}
  return { prompt: text.slice(0, 120), type: "general" };
}

/** Refine a free-text reply into a broadcast message. */
async function aiBroadcastBrief(text, env) {
  try {
    const raw = await adminAi(
      "You help write a broadcast message to ALL users of the 'Super AI' app (free all-in-one AI assistant).\n" +
      "The admin said: \"" + text + "\"\n" +
      "Return ONLY a tiny JSON: {\"msg\":\"the final message to send (friendly, 1-3 sentences, may include 1-2 emojis, no quotes)\"}.", "");
    const m = (raw || "").match(/\{[\s\S]*\}/);
    if (m) { const o = JSON.parse(m[0]); if (o.msg && o.msg.trim()) return o.msg.trim().slice(0, 1000); }
  } catch (e) {}
  return text.slice(0, 1000);
}

/** Refine a free-text reply into a public channel post. Supports "ai: <topic>"
 *  to let the AI draft the post from a topic. */
async function aiChannelBrief(text, env) {
  const t = (text || "").trim();
  if (t.toLowerCase().startsWith("ai:")) {
    const topic = t.slice(3).trim();
    try {
      const raw = await adminAi(
        "Write a friendly, upbeat Telegram channel post (2-3 sentences, 1-3 emojis) about: " + topic +
        " for our Ari AI app community. Mention Ari AI naturally. Output only the post text.", "");
      if (raw && raw.length > 5) return raw.trim().slice(0, 1000);
    } catch (e) {}
    return topic;
  }
  try {
    const raw = await adminAi(
      "You help write a public Telegram channel post for the 'Super AI' app.\n" +
      "The admin said: \"" + t + "\"\n" +
      "Return ONLY a tiny JSON: {\"msg\":\"the final post (2-3 sentences, 1-3 emojis, no quotes)\"}.", "");
    const m = (raw || "").match(/\{[\s\S]*\}/);
    if (m) { const o = JSON.parse(m[0]); if (o.msg && o.msg.trim()) return o.msg.trim().slice(0, 1000); }
  } catch (e) {}
  return t.slice(0, 1000);
}

/** Refine a free-text reply into a clean image-generation prompt. */
async function aiImageBrief(text, env) {
  try {
    const raw = await adminAi(
      "You help write an image-generation prompt for the 'Super AI' app (modern AI assistant branding: neon purple/pink, futuristic).\n" +
      "The admin said: \"" + text + "\"\n" +
      "Return ONLY a tiny JSON: {\"prompt\":\"a vivid image prompt (max 15 words, visual only, no text in image)\"}.", "");
    const m = (raw || "").match(/\{[\s\S]*\}/);
    if (m) { const o = JSON.parse(m[0]); if (o.prompt && o.prompt.trim()) return o.prompt.trim().slice(0, 200); }
  } catch (e) {}
  return text.slice(0, 200);
}

/** Parse a free-text reply into a scheduled post: <minutes> <message>. */
async function aiScheduleBrief(text, env) {
  const t = (text || "").trim();
  const m = t.match(/^(\d+)\s+([\s\S]+)$/);
  if (m) return { minutes: parseInt(m[1], 10), message: m[2].trim().slice(0, 1000) };
  // No leading number: ask the AI to extract minutes + message if implied.
  try {
    const raw = await adminAi(
      "Extract a schedule from: \"" + t + "\"\n" +
      "Return ONLY a tiny JSON: {\"minutes\":<number>,\"message\":\"<text>\"}. If no time is mentioned, use minutes:30.", "");
    const mm = (raw || "").match(/\{[\s\S]*\}/);
    if (mm) {
      const o = JSON.parse(mm[0]);
      const mins = parseInt(o.minutes, 10) || 30;
      const msg = (o.message && o.message.trim()) || t;
      return { minutes: mins, message: msg.slice(0, 1000) };
    }
  } catch (e) {}
  return { minutes: 30, message: t.slice(0, 1000) };
}

/** Post a structured "Info Received" update to the private admin channel
 *  (AAA AI APP ADMIN, id -1004241419377). Admin-only, never public. */
export async function adminChannelNotify(env, type, fields) {
  const ch = env.ADMIN_CHANNEL_ID;
  if (!ch || ch === "REPLACE_WITH_ADMIN_CHANNEL_ID") return false;
  const token = env.ADMIN_BOT_TOKEN;
  if (!token) return false;
  let text = "✅ <b>Info Received</b>\n📋 Type: " + htmlEscape(type || "Update");
  if (fields) {
    for (const k of Object.keys(fields)) {
      text += "\n• " + htmlEscape(k) + ": " + htmlEscape(String(fields[k]));
    }
  }
  try {
    await tgSend(token, ch, text);
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
  const model = opts?.model ? "&model=" + opts.model : "&model=flux";
  const seed = opts?.seed != null ? "&seed=" + opts.seed : "";
  return "https://image.pollinations.ai/prompt/" + p + "?width=" + w + "&height=" + h + "&nologo=true" + model + (opts?.enhance ? "&enhance=true" : "") + seed;
}

const KIE_BASE = "https://api.kie.ai";

/** Generate an image via KIE.AI (gpt-image-2). Returns an ArrayBuffer, or null
 *  on any failure. Async task model: createTask -> poll recordInfo. */
async function generateImageKie(prompt, env) {
  const key = await providerKey(env, "kie", "KIE_API_KEY");
  if (!key) return null;
  try {
    const sub = await fetch(KIE_BASE + "/api/v1/jobs/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: "gpt-image-2-text-to-image",
        input: { prompt: prompt.slice(0, 1000), aspect_ratio: "1:1" },
      }),
    }).then((r) => r.json());
    if (!sub || sub.code !== 200 || !sub.data || !sub.data.taskId) return null;
    const taskId = sub.data.taskId;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const info = await fetch(KIE_BASE + "/api/v1/jobs/recordInfo?taskId=" + taskId, {
        headers: { Authorization: "Bearer " + key },
      }).then((r) => r.json());
      const st = info && info.data && info.data.state;
      if (st === "success" || st === "fail") {
        if (st === "success") {
          const rj = info.data.resultJson ? JSON.parse(info.data.resultJson) : {};
          const url = (rj.resultUrls && rj.resultUrls[0]) || null;
          if (url) {
            const img = await fetch(url);
            if (img.ok) return await img.arrayBuffer();
          }
        }
        return null;
      }
    }
    return null;
  } catch (e) { return null; }
}

/** Unified image generator with provider failover: KIE (best quality) -> Pollinations.
 *  `opts` = { width, height, ratio }. Returns an ArrayBuffer or null. */
async function generateImage(prompt, env, opts) {
  opts = opts || {};
  const w = opts.width || 1024, h = opts.height || 1024;
  // Try KIE first (higher quality) when a key is present.
  let buf = null;
  try { buf = await generateImageKie(prompt, env); } catch (e) {}
  if (buf) return buf;
  // Fallback to Pollinations (free). Random seed so repeated calls differ.
  try {
    const r = await fetch(pollinationsUrl(prompt, { width: w, height: h, enhance: true, seed: Math.floor(Math.random() * 1e9) }));
    if (r.ok) {
      const ct = r.headers.get("content-type") || "";
      if (ct.indexOf("image") >= 0) return await r.arrayBuffer();
    }
    } catch (e) {}
    return { buf: null, error: "fetch_failed" };
  }

/** Generate a short promo video via KIE.AI (grok-imagine/text-to-video).
 *  Returns an ArrayBuffer, or null on failure. */
async function generateVideoKie(prompt, env) {
  const key = await providerKey(env, "kie", "KIE_API_KEY");
  if (!key) return null;
  try {
    const sub = await fetch(KIE_BASE + "/api/v1/jobs/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: "grok-imagine/text-to-video",
        input: { prompt: prompt.slice(0, 1000), aspect_ratio: "16:9" },
      }),
    }).then((r) => r.json());
    if (!sub || sub.code !== 200 || !sub.data || !sub.data.taskId) return null;
    const taskId = sub.data.taskId;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const info = await fetch(KIE_BASE + "/api/v1/jobs/recordInfo?taskId=" + taskId, {
        headers: { Authorization: "Bearer " + key },
      }).then((r) => r.json());
      const st = info && info.data && info.data.state;
      if (st === "success" || st === "fail") {
        if (st === "success") {
          const rj = info.data.resultJson ? JSON.parse(info.data.resultJson) : {};
          const url = (rj.resultUrls && rj.resultUrls[0]) || null;
          if (url) {
            const vid = await fetch(url);
            if (vid.ok) return await vid.arrayBuffer();
          }
        }
        return null;
      }
    }
    return null;
  } catch (e) { return null; }
}

/** Generate a promo video via Shotstack (sandbox stage = free, watermarked;
  *  production = paid, no watermark). Returns an ArrayBuffer, or null on failure.
  *  Builds a real video: 2 AI-generated images (Pollinations) fetched in-worker,
  *  stored to R2, and served via the public /api/asset route as Ken-Burns image
  *  clips, plus a "Super AI" title overlay at the end. */

  /** Text-to-speech for AI voiceovers on Shorts. Uses Groq's Orpheus speech API
   *  (free tier, replaces the decommissioned playai-tts). Requires the Orpheus
   *  terms to be accepted once at console.groq.com. Returns {buf, error}. */
  async function ttsMp3(text, env) {
    const groqKey = (env && (await providerKey(env, "groq", "GROQ_KEY"))) || "";
    if (!groqKey) return { buf: null, error: "no_key" };
    try {
      const r = await fetch("https://api.groq.com/openai/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + groqKey },
          body: JSON.stringify({
            model: "canopylabs/orpheus-v1-english",
            voice: "autumn",
            input: text.slice(0, 400),
            response_format: "wav",
          }),
      });
      if (!r.ok) { const b = await r.text().catch(function () { return ""; }); return { buf: null, error: "groq_http_" + r.status + ": " + b.slice(0, 200) }; }
      const ct = r.headers.get("content-type") || "";
      if (ct.indexOf("audio") >= 0) return { buf: await r.arrayBuffer(), error: null };
      const err = await r.text().catch(function () { return ""; });
      if (err.indexOf("terms") >= 0) return { buf: null, error: "terms" };
      return { buf: null, error: err.slice(0, 120) };
    } catch (e) { return { buf: null, error: "throw: " + String((e && e.message) || e).slice(0, 120) }; }
    return { buf: null, error: "unknown" };
  }

  /** Returns a royalty-free background-music MP3 URL served from R2. The track is
   *  fetched once from a stable CDN and cached in R2 so renders are fast/offline.
   *  Falls back to null (silent video) if anything fails. */
  async function getBgMusicUrl(env, origin) {
    const key = "public/bgmusic.mp3";
    try {
      if (env.aaa_assets) {
        const existing = await env.aaa_assets.head(key);
        // Re-fetch if missing or corrupt (cached error pages are tiny).
        if (existing && Number(existing.size || 0) > 5000) return origin + "/api/asset/" + key;
        if (existing) { try { await env.aaa_assets.delete(key); } catch (e) {} }
      }
      const r = await fetch("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3");
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.indexOf("audio") >= 0) {
        const buf = await r.arrayBuffer();
        if (env.aaa_assets) await env.aaa_assets.put(key, buf, { httpMetadata: { contentType: "audio/mpeg" } });
        return origin + "/api/asset/" + key;
      }
    } catch (e) {}
    return null;
  }

async function generateVideoShotstack(prompt, env, useProd, vertical, type, promoCode) {
  let voiceErr = null;
  const key = await providerKey(env, "shotstack", "SHOTSTACK_KEY");
  if (!key) return { buf: null, error: "no_shotstack_key" };
  const base = useProd ? "https://api.shotstack.io/edit/render" : "https://api.shotstack.io/edit/stage/render";
  const safe = prompt.replace(/[<>&"]/g, "").slice(0, 80);
  const origin = (env.PUBLIC_ORIGIN || "https://aaa-ai-bot.aaateam.workers.dev").replace(/\/$/, "");
  // Shorts-first: always render a vertical 9:16 clip so every video is a
  // YouTube Short / Reel. (The `vertical` arg is kept for API compatibility.)
  vertical = true;
  const iw = 720, ih = 1280;
  // Randomize so every render looks different (not the same clip each time).
  const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const seed = Math.floor(Math.random() * 1e9);
  const styles = ["neon purple and pink", "cyberpunk teal and magenta", "holographic violet and cyan", "electric blue and gold", "synthwave orange and purple"];
  const moods = ["cinematic dramatic lighting", "soft dreamy glow", "high contrast moody", "bright energetic", "futuristic volumetric light"];
  const style = rnd(styles), mood = rnd(moods);
  const effectsAll = ["zoomIn", "zoomInSlow", "zoomOut", "slideLeft", "slideUp", "slideDown", "slideRight"];
  const effects = effectsAll.sort(() => Math.random() - 0.5);
  // Varied, human-sounding title overlays so no two videos feel "robotic".
  const titles = [
    "Super AI", "Ari AI", "Your AI Assistant", "Powered by Super AI", "Meet Ari AI",
    "Create with Ari", "AI that gets you", "Your daily AI", "Made by Super AI", "Hello from Ari",
  ];
  const titleText = rnd(titles);
  const twists = ["", " in a bustling city", " close up", " abstract", " minimal", " cinematic", " dreamy", " futuristic"];
  const twist = rnd(twists);

  // Build a short spoken SCRIPT + scene captions based on the video TYPE, so each
  // kind of Short (app ad / promo code / tip) is genuinely different content.
  type = (type || "general").toLowerCase();
  let script, sceneCaptions, imgThemes;
  if (type === "ad" || type === "app") {
    script = "Meet Super AI, your all-in-one AI assistant. Chat, create images, and download anything in seconds. Get the app free today and unlock your creativity.";
    sceneCaptions = ["Your AI assistant", "Chat · Images · Downloads", "All in one app", "Free to start"];
    imgThemes = [safe + " smartphone app UI", "person using AI chat assistant", "AI generated art on phone", "happy user creating content"];
  } else if (type === "promo" || type === "promocode") {
    const codeTxt = promoCode ? (" code " + promoCode) : " code";
    script = "Limited drop! Use our promo" + codeTxt + " to unlock Premium free. First users only. Open Super AI, redeem your code, and enjoy Pro features today.";
    sceneCaptions = ["Limited Promo", "Unlock Premium FREE", "First users only", "Redeem in app"];
    imgThemes = [safe + " gift box glowing", "premium badge neon", "countdown timer style", "celebration confetti ai"];
  } else if (type === "tip") {
    script = "AI tip of the day: " + (safe || "let AI handle the busywork") + ". Try it now in Super AI and save hours every week.";
    sceneCaptions = ["Tip of the day", safe.slice(0, 24) || "Work smarter", "Try it in Super AI", "Save hours weekly"];
    imgThemes = [safe + " workspace", "person relaxed productivity", "ai robot helping", "futuristic desk setup"];
  } else {
    script = (safe || "Super AI creates amazing things") + ". Powered by Ari AI. Get the app and start creating for free.";
    sceneCaptions = [titleText, safe.slice(0, 24) || "Create with AI", "Powered by Super AI", "Get the app free"];
    imgThemes = [safe + " futuristic", safe + " app UI neon", safe + " abstract energy", safe + " cinematic scene"];
  }

  // Generate 4 AI images (one per scene) in PARALLEL, each with its own seed so
  // they look different. Store to R2, serve via /api/asset (Sandbox can't fetch
  // Pollinations' 302-redirect URLs). Bounded per-request timeout.
  const baseUrl = "https://image.pollinations.ai/prompt/";
  const fetchImg = async (p, i) => {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 15000);
    try {
      const s = seed + i * 7919;
      const u = baseUrl + encodeURIComponent("Cinematic vertical " + p + twist + ", " + style + ", 9:16, " + mood) +
        "?width=" + iw + "&height=" + ih + "&nologo=true&model=flux&enhance=true&seed=" + s;
      const r = await fetch(u, { signal: ac.signal });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") || "";
      if (ct.indexOf("image") < 0) return null;
      const buf = await r.arrayBuffer();
      const k = "temp/shotstack_" + Date.now() + "_" + i + ".jpg";
      if (env.aaa_assets) await env.aaa_assets.put(k, buf, { httpMetadata: { contentType: "image/jpeg" } });
      return origin + "/api/asset/" + k;
    } catch (e) { return null; } finally { clearTimeout(to); }
  };
  const results = await Promise.all(imgThemes.map((p, i) => fetchImg(p, i)));
  const imageUrls = results.filter(Boolean);
  const tempKeys = results.filter(Boolean).map((u) => u.split("/api/asset/")[1]).filter(Boolean);

  // Build the timeline: 4 scenes × ~3s each = ~12-15s Short, each with its own
  // image, Ken-Burns effect, scene caption, logo watermark and (at end) CTA.
  const sceneLen = 3;
  const clips = [];
  let t = 0;
  const sceneCount = Math.max(imageUrls.length, sceneCaptions.length, 1);
  for (let i = 0; i < sceneCount; i++) {
    const img = imageUrls[i] || imageUrls[0];
    if (img) {
      clips.push({ asset: { type: "image", src: img }, start: t, length: sceneLen, effect: effects[i % effects.length], transition: { in: "fade" } });
    } else {
      clips.push({ asset: { type: "title", text: titleText, style: "subtitle", size: "small" }, start: t, length: sceneLen, position: "center" });
    }
    if (env.aaa_assets) clips.push({ asset: { type: "image", src: origin + "/api/asset/public/aaa-store-logo.png" }, start: t, length: sceneLen, position: "topRight", scale: 0.12, opacity: 0.8 });
    t += sceneLen;
  }
  // Branded end-card CTA (short branding only — the store link lives in the
  // video description, not on-screen, so on-video text stays small & clean).
  clips.push({ asset: { type: "title", text: "Get Super AI — link below 👇", style: "subtitle", size: "small" }, start: t, length: 2, position: "center" });
  t += 2;
  // Optional visible promo code overlay — shown AFTER the CTA (no overlap) so the
  // code is clearly readable on screen, not doubled up with the CTA text.
  if (promoCode) {
    clips.push({ asset: { type: "title", text: "CODE: " + promoCode, style: "subtitle", size: "small" }, start: t, length: 2.5, position: "center" });
    t += 2.5;
  }

  // Audio: AI voiceover (the script) on top + royalty-free background music, both
  // hosted in R2 and referenced by URL (Shotstack sandbox can't fetch external audio).
  const audioTracks = [];
  const ts = Date.now();
  const voiceRes = await ttsMp3(script, env);
  if (env && env.aaa_assets) { try { await env.aaa_assets.put("public/tts_last.txt", "err=" + (voiceRes && voiceRes.error || "none") + " hasBuf=" + !!(voiceRes && voiceRes.buf)); } catch (e) {} }
  if (voiceRes && voiceRes.buf && env.aaa_assets) {
    const vk = "temp/voice_" + ts + ".wav";
    await env.aaa_assets.put(vk, voiceRes.buf, { httpMetadata: { contentType: "audio/wav" } });
    tempKeys.push(vk);
    audioTracks.push({ clips: [{ asset: { type: "audio", src: origin + "/api/asset/" + vk, volume: 1 }, start: 0, length: t }] });
  }
  voiceErr = voiceRes.error; // surfaced by caller

  const payload = {
    timeline: {
      background: "#0a0014",
      tracks: [{ clips: clips }].concat(audioTracks),
    },
    output: { format: "mp4", resolution: "hd", size: { width: iw, height: ih } },
  };
  try {
    const sub = await fetch(base, {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    const id = sub && sub.response && sub.response.id;
    if (!id) return { buf: null, error: "submit_failed: " + JSON.stringify(sub).slice(0, 800) };
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const info = await fetch(base + "/" + id, { headers: { "x-api-key": key } }).then((r) => r.json());
      const st = info && info.response && info.response.status;
      if (st === "done" || st === "failed") {
        // Always delete the temporary R2 images so they don't pile up.
        if (env.aaa_assets && tempKeys.length) {
          await Promise.all(tempKeys.map((k) => env.aaa_assets.delete(k).catch(function () {})));
        }
        if (st === "done") {
          const url = info.response.url;
          if (url) {
            const vid = await fetch(url);
            if (vid.ok) return { buf: await vid.arrayBuffer(), url: url, voiceErr: voiceErr };
            return { buf: null, error: "fetch_failed url=" + url };
          }
          return { buf: null, error: "no_url status=" + st };
        }
        return { buf: null, error: "render_" + st + ": " + JSON.stringify(info.response).slice(0, 200) };
      }
    }
    if (env.aaa_assets && tempKeys.length) {
      await Promise.all(tempKeys.map((k) => env.aaa_assets.delete(k).catch(function () {})));
    }
    return { buf: null, error: "timeout_polling" };
  } catch (e) { return { buf: null, error: "throw: " + String((e && e.message) || e).slice(0, 200) }; }
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
  const cmd = text.split(/\s+/)[0].toLowerCase().split("@")[0];
  if (cmd === "/start") {
    const arg = text.slice(text.indexOf("/start") + "/start".length).trim();
    if (arg.startsWith("ref_")) {
      const referrerId = arg.slice("ref_".length);
      const credited = await creditReferral(referrerId, from.id);
      if (credited) {
        await tgSend(ENV.FREE_AI_BOT_TOKEN, chatId,
          "🎉 <b>Welcome to AAA Free AI!</b>\nYou joined via a friend's invite — they just earned bonus points.");
      }
    }
    // AI is app-only now. The Telegram bot is a companion that points users to
    // the Android app, where all AI features live.
    await tgSend(ENV.FREE_AI_BOT_TOKEN, chatId,
      "👋 <b>Hi! I'm the Super AI companion bot.</b>\n\n" +
      "🤖 <b>AI chat, images, downloaders & the creative studio now live inside the Super AI app</b> — " +
      "the Telegram bot no longer answers AI questions.\n\n" +
      "📲 <b>Get the app (100% free):</b> https://aaa-store.aaateam.workers.dev/store\n" +
      "🌐 Or browse our <b>App Store</b>: https://aaa-store.aaateam.workers.dev/store\n\n" +
      "Install the app to start using AI right away.",
      { reply_markup: { inline_keyboard: [[
        { text: "📲 Download Super AI", url: "https://aaa-store.aaateam.workers.dev/store" },
        { text: "🛍 App Store", url: "https://aaa-store.aaateam.workers.dev/store" },
      ]] } });
    return;
  }
  if (cmd === "/help" || cmd === "/about") {
    await tgSend(ENV.FREE_AI_BOT_TOKEN, chatId,
      "🤖 <b>AAA Free AI — companion bot</b>\n\n" +
      "All AI features (chat, image, video, downloaders, studio) live in the Super AI app.\n" +
      "📲 Download: https://aaa-store.aaateam.workers.dev/store");
    return;
  }
  // Any non-command message: AI is app-only — redirect to the app.
  await tgSend(ENV.FREE_AI_BOT_TOKEN, chatId,
    "🤖 <b>AI is in the app, not the bot.</b>\n\n" +
    "The free Telegram bot can't answer AI questions — open the Super AI app to chat, " +
    "generate images, use downloaders and the creative studio.\n\n" +
    "📲 Download: https://aaa-store.aaateam.workers.dev/store",
    { reply_markup: { inline_keyboard: [[
      { text: "📲 Get Super AI (free)", url: "https://aaa-store.aaateam.workers.dev/store" },
    ]] } });
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
 *  The whole console is tap-driven — no slash commands needed. Button labels
 *  are human-friendly; the action is hidden in callback_data. */
async function sendAdminMenu(chatId) {
  const b = (label, data) => ({ text: label, callback_data: data });
  const GRID = {
    inline_keyboard: [
      [b("📊 Stats", "stats"), b("🩺 Status", "status"), b("📋 Review", "review")],
      [b("📣 Broadcast", "bc"), b("📢 Channel", "ch"), b("🔄 Sync", "sync")],
      [b("🐞 Crashes", "crashlog"), b("🧹 Cleanup", "cleanup"), b("🤖 Ask AI", "ai")],
      [b("🎨 Image", "img"), b("📱 Short Video", "vid")],
      [b("⬆️ Upload YT", "ytupload"), b("🔑 API Key", "sk"), b("🔍 Key Status", "keys")],
      [b("📊 Report", "report"), b("🤖 Auto Post", "autopost"), b("🎟 Promo", "promo")],
      [b("🧠 Teach AI", "teach"), b("📚 Learnings", "learnings"), b("🏠 Menu", "menu")],
      [b("📡 Dashboard", "dashboard"), b("⏰ Schedule", "schedule"), b("🤖 Ask AI", "ai")],
    ],
  };
  const head =
    "🛡 <b>Super AI — Admin Console</b>\n" +
    "<i>Tap a tile to do it. Or just type what you want and the AI handles it (e.g. \"post our new feature to the channel\", \"give tg_123 500 credits\", \"set kie key to …\").</i>";
  await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, head, { reply_markup: GRID });
}

// Tap-driven actions. Each tile either runs directly or asks the admin for the
// needed input (captured via a one-shot "await_<chatId>" flag in KV).
const PROVIDERS = ["kie", "shotstack", "json2video", "hf", "gemini", "groq", "tensor", "youtube", "pollinations", "kiehmac"];

async function adminPrompt(chatId, kind, question) {
  let saved = false;
  try { await ENV.AAA_KV.put("await_" + chatId, kind, { expirationTtl: 600 }); saved = true; } catch (e) {}
  if (!saved) {
    // KV write failed — tell the admin how to proceed via slash command so the
    // action is never a dead end.
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, question + "\n\n<i>(Tip: you can also type the command directly, e.g. /video your idea)</i>");
    return;
  }
  await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, question);
}

// Show the provider picker when "🔑 API Key" is tapped.
async function sendProviderPicker(chatId) {
  const btns = PROVIDERS.map(function (p) { return { text: p, callback_data: "sk:" + p }; });
  // 2 per row
  const rows = [];
  for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
  rows.push([{ text: "🔙 Back", callback_data: "menu" }]);
  await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔑 <b>Which provider key?</b>", { reply_markup: { inline_keyboard: rows } });
}

// Two-step key entry: after a provider is picked, ask for the value.
async function adminPromptKey(chatId, provider) {
  const what = provider === "youtube" ? "OAuth refresh token" : "API key";
  try { await ENV.AAA_KV.put("await_" + chatId, "sk:" + provider, { expirationTtl: 300 }); } catch (e) {}
  await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔑 <b>" + provider + "</b> — paste the " + what + " (reply to this message):");
}

// ---- AI action router -------------------------------------------------------
// The admin console is command-light by design: the owner just talks to it in
// plain language and the AI decides which action to run. This classifier maps a
// free-text message to a structured intent, then runAdminAction executes it
// using the existing helpers. If nothing actionable is detected, it falls back
// to a normal AI chat answer.

const ADMIN_ACTIONS = ["stats", "status", "review", "apps", "broadcast", "channel", "sync", "version", "crashlog", "report", "credit", "cleanup", "setkey", "keys", "chat", "ai", "start", "menu", "help", "img", "video", "reel", "promo", "promostats", "autopost", "credits", "setpoints", "grant", "grantme", "supabase", "yt", "ytconnect", "ytstats", "ytupdate", "crashlytics", "cf", "config", "secrets", "r2", "d1", "sql", "kv", "firebase", "adminadd", "adminrm", "admins", "store", "setlogo", "login", "teach", "learnings", "schedule", "dashboard"];

/** Master reference of every admin command: how to call it, what it does, and
 *  the natural-language phrases that should trigger it. Used to build /help and
 *  to teach the AI intent classifier so ANY command is reachable by chatting. */
const COMMAND_REFS = [
  { cmd: "/start", cat: "General", desc: "Open the admin console / menu", nl: "open menu, start, show console" },
  { cmd: "/help", cat: "General", desc: "List every command + AI examples", nl: "help, what can you do, list commands" },
  { cmd: "/menu", cat: "General", desc: "Show the tap-tile menu", nl: "menu, show tiles" },
  { cmd: "/login", cat: "General", desc: "/login <password> — sign in as admin", nl: "login, sign in" },
  { cmd: "/ai", cat: "General", desc: "/ai <question> — ask the ops AI", nl: "ask, question, what about" },
  { cmd: "/report", cat: "General", desc: "AI operations report + suggestions", nl: "report, ops report, suggestions" },
  { cmd: "/stats", cat: "App & Store", desc: "App + store numbers", nl: "stats, numbers, how many users" },
  { cmd: "/version", cat: "App & Store", desc: "/version <name> <code> <log> — show/set version", nl: "version, app version, update version" },
  { cmd: "/store", cat: "App & Store", desc: "Store link + current version", nl: "store, store link" },
  { cmd: "/review", cat: "App & Store", desc: "Pending store submissions (approve/reject)", nl: "review, pending apps, submissions" },
  { cmd: "/apps", cat: "App & Store", desc: "Recent store apps", nl: "apps, recent apps, store apps" },
  { cmd: "/promo", cat: "App & Store", desc: "Generate a weekly promo code", nl: "promo, promo code, discount" },
  { cmd: "/promostats", cat: "App & Store", desc: "Promo redemption stats", nl: "promo stats, redemptions" },
  { cmd: "/credits", cat: "App & Store", desc: "/credits <uid> <amt> — give a user points", nl: "give credits, add points, credit user" },
  { cmd: "/setpoints", cat: "App & Store", desc: "/setpoints <uid> <amt> — set a user's points", nl: "set points, set credits" },
  { cmd: "/grant", cat: "App & Store", desc: "/grant <uid> <days> — grant premium", nl: "grant premium, give premium" },
  { cmd: "/grantme", cat: "App & Store", desc: "Grant yourself premium (owner)", nl: "grant me premium" },
  { cmd: "/broadcast", cat: "Users & Growth", desc: "/broadcast <msg> — message all users", nl: "broadcast, tell all users, announce, notify everyone" },
  { cmd: "/channel", cat: "Users & Growth", desc: "/channel <msg> — post to public channel", nl: "post to channel, channel post, share on channel" },
  { cmd: "/autopost", cat: "Users & Growth", desc: "AI-written auto channel post", nl: "auto post, auto channel" },
  { cmd: "/sync", cat: "Users & Growth", desc: "Reconcile D1 → Supabase mirror", nl: "sync, reconcile, database sync" },
  { cmd: "/supabase", cat: "Users & Growth", desc: "Supabase mirror status", nl: "supabase, mirror status" },
  { cmd: "/keys", cat: "API Keys", desc: "Show current API key status", nl: "show keys, key status, what keys" },
  { cmd: "/setkey", cat: "API Keys", desc: "/setkey <provider> <value> — set key live", nl: "set key, change key, update api key" },
  { cmd: "/yt", cat: "API Keys", desc: "YouTube connection status", nl: "youtube status" },
  { cmd: "/ytupload", cat: "API Keys", desc: "Upload the last generated video to YouTube", nl: "upload video to youtube, post video to youtube" },
  { cmd: "/ytconnect", cat: "API Keys", desc: "Begin YouTube OAuth connect", nl: "connect youtube" },
  { cmd: "/ytstats", cat: "API Keys", desc: "YouTube channel stats", nl: "youtube stats" },
  { cmd: "/ytupdate", cat: "API Keys", desc: "Update YouTube channel description", nl: "update youtube" },
  { cmd: "/img", cat: "Content & Media", desc: "/img <prompt> — generate image (KIE→Pollinations)", nl: "generate image, make a picture, draw" },
  { cmd: "/video", cat: "Content & Media", desc: "/video <prompt> — vertical 9:16 YouTube Short", nl: "generate video, make a short, render promo" },
  { cmd: "/reel", cat: "Content & Media", desc: "/reel <prompt> — vertical 9:16 YouTube Short", nl: "make a reel, vertical short, tiktok" },
  { cmd: "/teach", cat: "AI Brain", desc: "/teach <topic> | <how> — teach the AI (self-improves)", nl: "teach the ai, remember this, learn this" },
  { cmd: "/learnings", cat: "AI Brain", desc: "/learnings — view AI memory + provider stats", nl: "learnings, what have you learned, memory" },
  { cmd: "/schedule", cat: "Users & Growth", desc: "/schedule <minutes> <msg> — queue a channel post", nl: "schedule post, queue message, later" },
  { cmd: "/dashboard", cat: "General", desc: "/dashboard — live snapshot (users, YouTube, warnings)", nl: "dashboard, status snapshot, live" },
  { cmd: "/crashlog", cat: "System & Health", desc: "App crash reports + AI root-cause", nl: "crashes, crash log, crash reports" },
  { cmd: "/crashlytics", cat: "System & Health", desc: "Firebase Crashlytics status", nl: "crashlytics, firebase crashes" },
  { cmd: "/status", cat: "System & Health", desc: "Service health (KV/R2/D1/bots)", nl: "status, health, is it up" },
  { cmd: "/cleanup", cat: "System & Health", desc: "Prune old data", nl: "cleanup, prune, maintenance" },
  { cmd: "/cf", cat: "System & Health", desc: "Cloudflare panel info", nl: "cloudflare, cf panel" },
  { cmd: "/config", cat: "System & Health", desc: "Full Cloudflare configuration", nl: "config, configuration" },
  { cmd: "/secrets", cat: "System & Health", desc: "View Cloudflare secrets", nl: "secrets, show secrets" },
  { cmd: "/r2", cat: "System & Health", desc: "/r2 <prefix> — list R2 objects", nl: "r2, list files, storage" },
  { cmd: "/d1", cat: "System & Health", desc: "/d1 <sql> — run a D1 query", nl: "d1, run sql, query database" },
  { cmd: "/sql", cat: "System & Health", desc: "/sql <query> — raw SQL on D1", nl: "sql, raw query" },
  { cmd: "/kv", cat: "System & Health", desc: "/kv <key> — read a KV value", nl: "kv, read kv" },
  { cmd: "/firebase", cat: "System & Health", desc: "Firebase status", nl: "firebase, auth status" },
  { cmd: "/adminadd", cat: "Admins", desc: "/adminadd <chatId> — grant admin", nl: "add admin, grant admin" },
  { cmd: "/adminrm", cat: "Admins", desc: "/adminrm <chatId> — remove admin", nl: "remove admin" },
  { cmd: "/admins", cat: "Admins", desc: "List admins", nl: "list admins, who is admin" },
  { cmd: "/setlogo", cat: "App & Store", desc: "Re-apply a saved store logo", nl: "set logo, apply logo" },
];

/** Build the /help message from COMMAND_REFS, grouped by category. */
function buildHelp() {
  const cats = {};
  for (const r of COMMAND_REFS) { (cats[r.cat] = cats[r.cat] || []).push(r); }
  let out = "🛡 <b>Super AI — Admin Console · All Commands</b>\n";
  out += "<i>Tip: you can trigger ANY of these by typing naturally — e.g. \"post our new feature to the channel\", \"tell all users the update is live\", \"give tg_123 500 credits\", \"show me key status\".</i>\n\n";
  for (const cat of Object.keys(cats)) {
    out += "🔹 <b>" + cat + "</b>\n";
    for (const r of cats[cat]) out += "• <code>" + r.cmd + "</code> — " + r.desc + "\n";
    out += "\n";
  }
  out += "Tap a tile in the menu, or just chat with the Admin AI.";
  return out;
}

/** Render current provider key status: KV override vs env secret, masked. */
async function keyStatus(env) {
  const defs = [
    ["kie", "KIE_API_KEY"], ["kiehmac", "KIE_HMAC_KEY"], ["json2video", "JSON2VIDEO_KEY"],
    ["hf", "HF_KEY"], ["gemini", "GEMINI_KEY"], ["groq", "GROQ_KEY"], ["tensor", "TENSOR_ART_KEY"],
    ["pollinations", "POLLINATIONS_KEY"], ["shotstack", "SHOTSTACK_KEY"], ["youtube", "yt_owner_refresh"],
  ];
  const mask = (v) => {
    if (v == null || v === "") return "∅ unset";
    const s = String(v);
    if (s.length <= 8) return s[0] + "••••";
    return s.slice(0, 4) + "…" + s.slice(-4) + " (" + s.length + ")";
  };
  const PING = {
    gemini: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=",
    groq: "https://api.groq.com/openai/v1/models",
    hf: "https://api-inference.huggingface.co/models/google/flan-t5-xxl",
    json2video: "https://api.json2video.com/v2/movies",
    kie: "https://api.kie.ai/api/v1/chat/credit",
    shotstack: "https://api.shotstack.io/edit/stage/render",
    tensor: "https://ap-east-1.tensorart.cloud/v1/jobs",
  };
  const ping = async (name, key) => {
    const url = PING[name];
    if (!url || !key) return null;
    try {
      const hd = name === "kie" || name === "shotstack"
        ? { Authorization: "Bearer " + key, "Content-Type": "application/json" }
        : { Authorization: "Bearer " + key };
      const r = await fetch(url, { method: "GET", headers: hd, redirect: "manual" });
      // 401/403 = key present but rejected; 200/4xx(other) = reachable. Either way endpoint is alive.
      if (r.status === 0 || (r.status >= 200 && r.status < 500) || r.status === 401 || r.status === 403) return "🟢";
      return "🔴";
    } catch (e) { return "🔴"; }
  };
  let out = "🔑 <b>API Key Status</b>  <code>(🟢 reachable · 🔴 error)</code>\n";
  out += "<code>provider     env   KV       live</code>\n";
  for (const [name, sec] of defs) {
    const kv = env.AAA_KV ? await env.AAA_KV.get("key_" + name) : "";
    const kvYt = name === "youtube" && env.AAA_KV ? await env.AAA_KV.get("yt_owner_refresh") : "";
    const override = name === "youtube" ? kvYt : kv;
    const envSet = env[sec] ? "✅" : "—";
    const ov = override ? "✅" : "—";
    const live = override ? (await ping(name, override)) : (env[sec] ? (await ping(name, env[sec])) : "—");
    out += "• " + name.padEnd(11) + " " + envSet.padEnd(3) + "  " + ov.padEnd(3) + "  " + live + "\n";
  }
  out += "\nKV overrides take priority and apply live (no redeploy).\nSet: tap 🔑 API Key tile, or say \"set <provider> key to …\".";
  return out;
}

async function classifyIntent(text) {
  const picks = ADMIN_ACTIONS.map(function (a) { return "- " + a; }).join("\n");
  const prompt =
    "You are the intent classifier for an admin Telegram bot that manages the 'Super AI' Android app + store.\n" +
    "Map the user's message to exactly ONE of these actions:\n" + picks + "\n" +
    "Each action maps to a Telegram command. Available commands and the natural-language phrases that trigger them:\n" +
    COMMAND_REFS.map(function (r) { return "- " + r.action + "  (" + r.cmd + "): " + r.nl; }).join("\n") + "\n" +
    "Rules:\n" +
    "- 'stats' = show app/store numbers. 'status' = system health (DBs/bots). 'review' = pending store submissions. 'apps' = recent store apps.\n" +
    "- 'broadcast' = send a message/announcement to ALL app users. Trigger words: 'tell all users', 'announce', 'notify everyone', 'broadcast', 'send to all'. Put the message text in 'arg'.\n" +
    "- 'channel' = post to the public Telegram channel (auto-generates an image + video). Trigger words: 'post to channel', 'post on channel', 'channel post', 'share on channel'. Put the topic in 'arg'.\n" +
    "- 'sync' = reconcile databases. 'version' = show/set app version. 'crashlog' = app crashes. 'report' = ops report. 'credit' = give a user points (needs uid+amount). 'cleanup' = maintenance.\n" +
    "- 'setkey' = ONLY when the user clearly wants to SET/CHANGE a provider API key AND provides BOTH a provider and a value, e.g. 'set the kie key to abc123', 'change json2video key to xyz', 'set shotstack key to …'. Extract provider name (one of: kie, kiehmac, json2video, hf, gemini, groq, tensor, youtube, pollinations, shotstack) and the key value into arg as 'provider value'. If the message does NOT contain an actual key value, choose 'chat' instead.\n" +
    "- 'keys' = the user wants to VIEW the current API key status/overrides (e.g. 'show keys', 'what keys are set', 'key status').\n" +
    "- 'img' / 'video' = generate media, and the message contains a real subject/prompt. Put the prompt in 'arg'.\n" +
    "- 'credits' = give a user points, and the message contains a uid + amount. Extract 'uid amount' into arg. 'grant' = grant premium: extract 'uid days'.\n" +
    "- 'promo' = generate a promo code. 'autopost' = AI auto channel post.\n" +
    "- 'chat' = DEFAULT for anything ambiguous, conversational, vague, acknowledging (e.g. 'you do it', 'ok', 'thanks', 'do it'), greetings ('hi', 'hello', 'hey'), a question, or not clearly one of the above. When in doubt, choose 'chat'. NEVER map a greeting or small talk to 'stats'.\n" +
    "Respond with ONLY valid JSON: {\"action\":\"<one>\",\"arg\":\"<text or empty>\"}. No markdown, no commentary.\n\n" +
    "USER: " + text + "\nJSON:";
  const raw = await askAi(prompt, "gemini");
  if (!raw) return { action: "chat", arg: text };
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { action: "chat", arg: text };
  try {
    const j = JSON.parse(m[0]);
    if (ADMIN_ACTIONS.indexOf(j.action) >= 0) return { action: j.action, arg: (j.arg || "").trim() };
  } catch (e) {}
  return { action: "chat", arg: text };
}

async function runAdminAction(chatId, intent, from) {
  const token = ENV.ADMIN_BOT_TOKEN;
  const arg = (intent.arg || "").trim();
  from = from || msg_from_safe();
  switch (intent.action) {
    case "stats": {
      await sendStats(chatId);
      return true;
    }
    case "status": {
      // Reuse the existing /status block by invoking its logic.
      await sendStatus(chatId);
      return true;
    }
    case "review": {
      await sendReview(chatId);
      return true;
    }
    case "apps": {
      await sendRecentApps(chatId);
      return true;
    }
    case "sync": {
      await tgSend(token, chatId, "🔄 Reconciling D1 → Supabase mirror…");
      await doSync();
      await tgSend(token, chatId, "✅ Sync complete (D1→Supabase).");
      return true;
    }
    case "version": {
      const cur = (await ENV.AAA_KV.get("app_version_name")) || "?";
      const code = (await ENV.AAA_KV.get("app_version_code")) || "?";
      await tgSend(token, chatId, "📦 Current: <b>v" + cur + "</b> (code " + code + ")\nSet with: /version <name> <code> <changelog>");
      return true;
    }
    case "crashlog": {
      await sendCrashlog(chatId);
      return true;
    }
    case "report": {
      await tgAction(token, chatId);
      const stats = await gatherStats(ENV);
      const ans = await adminAi(
        "Give a short operations report: health, anything notable/concerning, and 2-3 concrete suggestions to grow usage.",
        statsBlock(stats));
      await tgSend(token, chatId, "📊 <b>Admin AI Report</b>\n" + htmlEscape(ans) + "\n\n<code>" + htmlEscape(statsBlock(stats)) + "</code>");
      return true;
    }
    case "cleanup": {
      await tgSend(token, chatId, "🧹 Running cleanup…");
      const res = await cleanup(ENV);
      await tgSend(token, chatId, "✅ Cleanup done:\n• history: " + (res.history_deleted || 0) + "\n• txns: " + (res.transactions_deleted || 0) + "\n• R2 temp: " + (res.r2_deleted || 0));
      return true;
    }
    case "broadcast": {
      const message = arg || "";
      if (!message) { await tgSend(token, chatId, "What should I broadcast? e.g. \"broadcast: New v2.3 is out!\""); return true; }
      await doBroadcast(chatId, message);
      return true;
    }
    case "channel": {
      const topic = arg || "";
      if (!topic) { await tgSend(token, chatId, "What should I post to the channel? e.g. \"channel: New AI feature dropped\""); return true; }
      await tgSend(token, chatId, "🤖 Writing copy + generating image/video for the channel…");
      const res = await generateChannelPost("", { aiTopic: topic });
      await tgSend(token, chatId,
        (res.posted ? "✅ Posted to channel" : "⚠️ Channel post failed (bot must be admin)") +
        (res.videoPosted ? " · 🎬 video included" : "") +
        (res.ytPosted ? " · 📺 YouTube synced" : ""));
      return true;
    }
    case "credit": {
      // Expect "uid amount" in arg.
      const parts = arg.split(/\s+/);
      const uid = parts[0]; const amt = parseInt(parts[1], 10);
      if (!uid || isNaN(amt)) { await tgSend(token, chatId, "Credit who? Send like: \"credit tg_123 500\""); return true; }
      const r = await addPoints(uid, amt, "admin", ENV);
      await tgSend(token, chatId, "✅ " + uid + " → " + (r.points ?? "n/a") + " pts");
      return true;
    }
    case "keys": {
      await tgSend(token, chatId, await keyStatus(ENV));
      return true;
    }
    case "setkey": {
      const parts = arg.split(/\s+/);
      const name = (parts[0] || "").toLowerCase();
      const value = parts.slice(1).join(" ").trim();
      const allowed = { json2video: "JSON2VIDEO_KEY", kie: "KIE_API_KEY", kiehmac: "KIE_HMAC_KEY", hf: "HF_KEY", gemini: "GEMINI_KEY", groq: "GROQ_KEY", tensor: "TENSOR_ART_KEY", youtube: "yt_owner_refresh", pollinations: "POLLINATIONS_KEY", shotstack: "SHOTSTACK_KEY" };
      if (!allowed[name] || !value) {
        await tgSend(token, chatId, "To set a key, say e.g. \"set kie key to <value>\" or use /setkey <kie|json2video|hf|gemini|groq|tensor|youtube|pollinations> <value>");
        return true;
      }
      const kvKey = name === "youtube" ? "yt_owner_refresh" : "key_" + name;
      await ENV.AAA_KV.put(kvKey, value);
      await tgSend(token, chatId, "✅ Key <b>" + name + "</b> updated live (KV override). Takes effect immediately on next request.");
      return true;
    }
    default: {
      // Generic dispatch: map the action back to its Telegram command and run
      // the existing command handler. This makes EVERY command reachable by
      // natural language (the AI classifier maps phrases -> actions -> here).
      const ACTION_TO_CMD = {
        start: "/start", menu: "/menu", help: "/help", login: "/login", ai: "/ai",
        stats: "/stats", status: "/status", review: "/review", apps: "/apps",
        broadcast: "/broadcast", channel: "/channel", sync: "/sync", version: "/version",
        crashlog: "/crashlog", report: "/report", credit: "/credits", cleanup: "/cleanup",
        setkey: "/setkey", keys: "/keys", img: "/img", video: "/video", reel: "/reel", promo: "/promo",
        promostats: "/promostats", autopost: "/autopost", credits: "/credits",
        setpoints: "/setpoints", grant: "/grant", grantme: "/grantme", supabase: "/supabase",
        yt: "/yt", ytconnect: "/ytconnect", ytstats: "/ytstats", ytupdate: "/ytupdate",
        crashlytics: "/crashlytics", cf: "/cf", config: "/config", secrets: "/secrets",
        r2: "/r2", d1: "/d1", sql: "/sql", kv: "/kv", firebase: "/firebase",
        adminadd: "/adminadd", adminrm: "/adminrm", admins: "/admins", store: "/store",
        setlogo: "/setlogo",
        teach: "/teach", learnings: "/learnings", schedule: "/schedule", dashboard: "/dashboard",
      };
      const cmdText = ACTION_TO_CMD[intent.action];
      if (cmdText) {
        await handleAdmin({ message: { chat: { id: chatId }, text: cmdText + (arg ? " " + arg : ""), from: from } });
        return true;
      }
      return false; // let caller fall back to chat
    }
  }
}

// The router runs outside a real message context for some actions; provide a
// minimal safe `from` so downstream handlers that read msg.from don't crash.
function msg_from_safe() {
  return { id: 0, is_bot: false, first_name: "Admin", username: "admin" };
}

// Thin wrappers so the router reuses existing command logic without duplicating.
async function sendStats(chatId) {
  // mirror of /stats body
  let info = "📊 <b>Stats</b>\n";
  if (ENV.AAA_DB) {
    const u = await ENV.AAA_DB.prepare("SELECT COUNT(*) c, COALESCE(SUM(points),0) p FROM users").first();
    info += "App users: " + (u?.c || 0) + "\nTotal points: " + (u?.p || 0) + "\n";
    const store = await ENV.AAA_DB.prepare(
      "SELECT COUNT(*) total, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) approved, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending, COALESCE(SUM(downloads),0) dl FROM store_apps").first();
    info += "Store apps: " + (store?.total || 0) + " (" + (store?.approved || 0) + " approved, " + (store?.pending || 0) + " pending)\n";
    info += "Store downloads: " + (store?.dl || 0) + "\n";
    const users = await ENV.AAA_DB.prepare("SELECT COUNT(*) c FROM store_users").first();
    info += "Store users: " + (users?.c || 0) + "\n";
    const refs = await ENV.AAA_KV.list({ prefix: "refcount:" });
    let refTotal = 0;
    for (const k of refs.keys) { try { refTotal += parseInt(await ENV.AAA_KV.get(k.name) || "0", 10); } catch (e) {} }
    info += "Referred users: " + refTotal + "\n";
  }
  const codes = await ENV.AAA_KV.list({ prefix: "login:" });
  info += "Pending link codes: " + codes.keys.length + "\n";
  const subs = await ENV.AAA_KV.list({ prefix: "key:" });
  info += "Key submissions: " + subs.keys.length;
  const ver = await ENV.AAA_KV.get("app_version_name");
  if (ver) info += "\nApp version: v" + ver;
  await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, info);
}
async function sendStatus(chatId) {
  // mirror of /status body
  const checks = [];
  let kvOk = false, r2Ok = false, d1Ok = false;
  try { await ENV.AAA_KV.get("app_version_name"); kvOk = true; } catch (e) {}
  try { await ENV.aaa_assets.list({ limit: 1 }); r2Ok = true; } catch (e) {}
  try { await ENV.AAA_DB.prepare("SELECT 1").first(); d1Ok = true; } catch (e) {}
  checks.push("🗄 KV: " + (kvOk ? "✅" : "❌"));
  checks.push("📦 R2: " + (r2Ok ? "✅" : "❌"));
  checks.push("🛢 D1: " + (d1Ok ? "✅" : "❌"));
  const v = (await ENV.AAA_KV.get("app_version_name")) || "?";
  const dl = (await ENV.AAA_KV.get("app_downloads")) || "0";
  let fbOk = false, sbOk = false;
  try { fbOk = !!(ENV.FIREBASE_SERVICE_ACCOUNT && JSON.parse(ENV.FIREBASE_SERVICE_ACCOUNT).client_email); } catch (e) {}
  try { sbOk = await supabaseKeepAlive(ENV); } catch (e) {}
  let d1Users = 0, sbUsers = 0;
  try { d1Users = (await ENV.AAA_DB.prepare("SELECT COUNT(*) c FROM users").first()).c || 0; } catch (e) {}
  try {
    const r = await fetch(ENV.SUPABASE_URL + "/rest/v1/users?select=uid&limit=1", { headers: { apikey: ENV.SUPABASE_SERVICE_ROLE, Authorization: "Bearer " + ENV.SUPABASE_SERVICE_ROLE, Prefer: "count=exact" } });
    const cr = r.headers.get("content-range");
    sbUsers = cr ? parseInt(cr.split("/")[1] || "0", 10) || 0 : 0;
  } catch (e) {}
  const link = (fbOk && sbOk && d1Users > 0) ? " ✅ linked" : (fbOk && sbOk ? " ⚠️ empty" : " ❌");
  await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
    "🩺 <b>System Status</b>\n" + checks.join("\n") +
    "\n🔥 Firebase (auth): " + (fbOk ? "✅" : "❌") +
    "\n🐘 Supabase (mirror): " + (sbOk ? "✅" : "❌") + " — " + sbUsers + " users" +
    "\n🛢 D1 (authoritative): " + (d1Ok ? "✅" : "❌") + " — " + d1Users + " users" +
    "\n🔗 Firebase→D1→Supabase:" + link +
    "\n\n📦 App v" + v + " · ⬇️ " + dl + " downloads");
}
async function sendReview(chatId) {
  if (!ENV.AAA_DB) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Store DB unavailable."); return; }
  const apps = await ENV.AAA_DB.prepare(
    "SELECT id, name, category, short_desc, owner_uid, version, package_name FROM store_apps WHERE status = 'pending' ORDER BY submitted_at ASC LIMIT 10").all();
  const rows = (apps && apps.results) || [];
  if (!rows.length) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ No apps waiting for review."); return; }
  for (const a of rows) {
    const owner = await getStoreUserName(ENV, a.owner_uid);
    const txt = "📦 <b>" + htmlEscape(a.name) + "</b>\nCategory: " + htmlEscape(a.category) + "\nVersion: " + htmlEscape(a.version || "?") + " · pkg: <code>" + htmlEscape(a.package_name || "?") + "</code>\nBy: " + htmlEscape(owner) + "\n" + (a.short_desc ? htmlEscape(a.short_desc) + "\n" : "") + "ID: <code>" + a.id + "</code>";
    const kb = { inline_keyboard: [[{ text: "✅ Approve", callback_data: "approve:" + a.id }, { text: "❌ Reject", callback_data: "reject:" + a.id }]] };
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, txt, { reply_markup: kb });
    const risk = await adminAi(
      "You are an app-store moderator. Given this pending app, flag ONLY real risks: trademark/brand impersonation, malware/phishing signals, or spam. If safe, reply 'SAFE'. One line, no preamble.",
      "APP: name=" + (a.name || "") + " | category=" + (a.category || "") + " | desc=" + (a.short_desc || "") + " | pkg=" + (a.package_name || ""));
    if (risk && !/^\s*safe/i.test(risk.trim())) await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ <b>AI moderation flag:</b> " + htmlEscape(risk.trim()));
  }
}
async function sendRecentApps(chatId) {
  if (!ENV.AAA_DB) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Store DB unavailable."); return; }
  const apps = await ENV.AAA_DB.prepare("SELECT id, name, status, downloads, owner_uid FROM store_apps ORDER BY submitted_at DESC LIMIT 12").all();
  const rows = (apps && apps.results) || [];
  if (!rows.length) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "No apps yet."); return; }
  let out = "📱 <b>Recent apps</b>\n";
  for (const a of rows) out += "• [" + htmlEscape(a.status) + "] " + htmlEscape(a.name) + " — " + (a.downloads || 0) + " dl · by " + htmlEscape(await getStoreUserName(ENV, a.owner_uid)) + "\n";
  await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, out);
}
async function sendCrashlog(chatId) {
  let idx = [];
  try { idx = JSON.parse(await ENV.AAA_KV.get("crashlog:index") || "[]"); } catch (e) {}
  if (!idx.length) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ No crashes captured."); return; }
  const limit = 5;
  for (const ts of idx.slice(0, limit)) {
    const r = await ENV.AAA_KV.get("crashlog:" + ts);
    if (!r) continue;
    let rec; try { rec = JSON.parse(r); } catch (e) { continue; }
    const dev = rec.device || {};
    const txt = "🐞 <b>Crash</b> " + new Date((rec.ts || ts) * 1).toISOString().slice(0, 19).replace("T", " ") + "\n📱 " + htmlEscape((dev.manufacturer || "?") + " " + (dev.model || "?")) + " (SDK " + (dev.sdk || "?") + ")\n💥 <code>" + htmlEscape((rec.message || "").slice(0, 200)) + "</code>\n🧵 " + htmlEscape(rec.thread || "?") + "\n<pre>" + htmlEscape((rec.stack || "").split("\n").slice(0, 6).join("\n").slice(0, 900)) + "</pre>";
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, txt);
  }
  await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
  let ctxLines = [];
  for (const ts of idx.slice(0, Math.min(limit, 8))) {
    const raw = await ENV.AAA_KV.get("crashlog:" + ts);
    if (!raw) continue;
    let rec; try { rec = JSON.parse(raw); } catch (e) { continue; }
    ctxLines.push("- " + (rec.message || "?").slice(0, 120) + " | " + ((rec.stack || "").split("\n")[1] || "").slice(0, 100));
  }
  if (ctxLines.length) {
    const ans = await adminAi("You are the lead Android engineer. Given these crash signatures, identify likely root cause(s), severity, and 2-3 fix recommendations. Be concise.", "CRASHES:\n" + ctxLines.join("\n"));
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 <b>AI Root-Cause</b>\n" + htmlEscape(ans));
  }
}
async function doSync() {
  if (!ENV.AAA_DB) return;
  await supabaseProvision(ENV);
  const users = await ENV.AAA_DB.prepare("SELECT uid, points, lifetime_earned, premium_until FROM users").all();
  const rows = (users && users.results) || [];
  for (const u of rows) {
    await supabaseUpsert(ENV, "users", { uid: u.uid, points: u.points || 0, lifetime_earned: u.lifetime_earned || 0, premium_until: u.premium_until || 0 }, "uid");
  }
}
async function doBroadcast(chatId, message) {
  // Collect recipients from app profiles + store users.
  const ids = new Set();
  try { const listed = await ENV.AAA_KV.list({ prefix: "profile:" }); for (const k of listed.keys) ids.add(k.name.slice("profile:".length)); } catch (e) {}
  if (ENV.AAA_DB) { try { const rows = await ENV.AAA_DB.prepare("SELECT DISTINCT tg_chat FROM store_users WHERE tg_chat IS NOT NULL").all(); for (const r of (rows.results || [])) ids.add(String(r.tg_chat)); } catch (e) {} }
  if (!ids.size) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ No users to broadcast to."); return; }
  let sent = 0, failed = 0;
  for (const id of ids) {
    const ok = await tgSendSafe(ENV.LOGIN_BOT_TOKEN, id, "📣 <b>Super AI</b>\n" + htmlEscape(message));
    if (ok) sent++; else failed++;
    if ((sent + failed) % 20 === 0) await new Promise(function (r) { setTimeout(r, 1000); });
  }
  await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Broadcast sent to " + sent + " user(s)" + (failed ? " (" + failed + " unreachable)" : "") + ".");
  adminChannelNotify(ENV, "Broadcast Sent", { "Recipients": sent + (failed ? " (" + failed + " failed)" : "") }).catch(function () {});
}

/** Register the Worker's own webhooks on Telegram using the bot tokens it
 *  already holds as secrets. Calling this on deploy guarantees the login/free/
 *  admin bots always deliver updates to this Worker (no manual step needed). */
async function setupWebhooks(origin) {
  // Prefer the configured public origin so webhooks always point at the real
  // deployed Worker, never at a request's local/empty origin.
  const base = (ENV && ENV.PUBLIC_ORIGIN) || origin || "";
  const bots = [
    { token: ENV.FREE_AI_BOT_TOKEN, path: "/telegram/free", commands: [{ command: "start", description: "Get the Super AI app (AI is app-only)" }] },
    { token: ENV.LOGIN_BOT_TOKEN, path: "/telegram/login", commands: [{ command: "start", description: "Sign in to the Super AI app" }] },
    { token: ENV.ADMIN_BOT_TOKEN, path: "/telegram/admin", commands: [
      { command: "menu", description: "Open the admin control panel (tap tiles)" },
      { command: "help", description: "List all admin commands" },
      { command: "login", description: "Authenticate as admin (owner or listed)" },
      { command: "stats", description: "App + store stats" },
      { command: "version", description: "Show/set app version" },
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

/** Build a list of human-readable warnings for providers that are low on
 *  credits or flagged exhausted. Used by the daily cron + key status. */
async function lowCreditWarnings(env) {
  const warns = [];
  try {
    const j2v = await providerKey(env, "json2video", "JSON2VIDEO_KEY");
    if (j2v) {
      const bal = await json2videoBalance(env, j2v);
      if (bal != null && bal <= 20) warns.push("• json2video: " + bal + " credits left");
    }
    const kie = await providerKey(env, "kie", "KIE_API_KEY");
    if (kie) {
      try {
        const r = await fetch("https://api.kie.ai/api/v1/chat/credit", { headers: { Authorization: "Bearer " + kie } }).then((x) => x.json());
        const c = r && r.data ? Number(r.data) : null;
        if (c != null && c <= 5) warns.push("• kie: " + c + " credits left");
      } catch (e) {}
    }
    for (const n of ["gemini", "groq", "hf", "shotstack", "tensor", "pollinations"]) {
      const ex = env.AAA_KV ? await env.AAA_KV.get("exhausted:" + n) : null;
      if (ex) warns.push("• " + n + ": ⛔ exhausted (swap key)");
    }
  } catch (e) {}
  return warns;
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

/** Returns true if the given chat id is an authenticated admin (password login
 *  or on the KV admin_list). Shared by the message + callback_query paths. */
async function isAdminAuthed(env, chatId) {
  // Open access: anyone who reaches this bot can use the admin console.
  return true;
}

async function handleAdmin(update) {
  // Inline keyboard button taps (grid menu) are delivered as callback_query.
   if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message ? cq.message.chat.id : cq.from.id;
    const data = (cq.data || "").trim();
    try { await tgApi(ENV.ADMIN_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cq.id }); } catch (e) {}
    // Tap-grid actions (data has no leading slash).
    if (data && !data.startsWith("/") && !data.startsWith("approve:") && !data.startsWith("reject:")) {
      if (data === "menu") { await sendAdminMenu(chatId); return; }
      if (data === "sk") { await sendProviderPicker(chatId); return; }
      if (data.startsWith("sk:")) { await adminPromptKey(chatId, data.slice(3)); return; }
      // Direct actions: run immediately. Prompt actions: ask for input first.
      const promptMap = {
        bc: ["bc", "🤖 <b>Broadcast</b>\nWhat do you want to tell ALL app users? Just describe it in plain words and I'll draft the message. 📣"],
        ch: ["ch", "🤖 <b>Channel post</b>\nWhat should I post to the public channel? Describe it, or say \"ai: &lt;topic&gt;\" and I'll write it. 📢"],
        img: ["img", "🤖 <b>Image</b>\nWhat should I draw? Describe the scene/vibe in plain words and I'll generate it. 🎨"],
        vid: ["vid", "🤖 <b>Short Video</b>\nTell me what you'd like — e.g. an app ad, a promo drop, or an AI tip. What's the product/vibe? I'll turn it into a vertical 9:16 YouTube Short for you. 🎬"],
        reel: ["reel", "🤖 <b>Short Video</b>\nTell me what you'd like — e.g. an app ad, a promo drop, or an AI tip. What's the product/vibe? I'll turn it into a vertical 9:16 YouTube Short for you. 🎬"],
        schedule: ["schedule", "⏰ <b>Schedule</b>\nWhat should I post later, and in how many minutes? (e.g. \"30 drop a new AI tip!\") — or just describe it and I'll pick a time."],
        ai: ["ai", "🤖 <b>Ask AI</b>\nReply with your question — I'll answer using live stats & provider health."],
      };
      if (promptMap[data]) {
        await adminPrompt(chatId, promptMap[data][0], promptMap[data][1]);
        return;
      }
      // Map a tap action to its command and run it.
      const direct = { stats: "/stats", status: "/status", review: "/review", sync: "/sync", crashlog: "/crashlog", cleanup: "/cleanup", ai: "/ai", yt: "/yt", keys: "/keys", report: "/report", autopost: "/autopost", promo: "/promo", ytupload: "/ytupload", teach: "/teach", learnings: "/learnings", dashboard: "/dashboard" };
      if (direct[data]) {
        await handleAdmin({ message: { chat: { id: chatId }, text: direct[data], from: cq.from } });
      }
      return;
    }
    if (data && data.startsWith("/")) {
      await handleAdmin({ message: { chat: { id: chatId }, text: data, from: cq.from } });
    } else if (data && (data.startsWith("approve:") || data.startsWith("reject:"))) {
      const authed = await isAdminAuthed(ENV, chatId);
      if (!authed) {
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔐 Send: <code>/login Arif-Abid</code> first.");
      } else {
        const id = data.slice(data.indexOf(":") + 1);
        if (data.startsWith("approve:")) {
          await approveApp(ENV, id);
          await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Approved <code>" + htmlEscape(id) + "</code>.");
        } else {
          await rejectApp(ENV, id, "Rejected by admin");
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
  // Capture any photo the admin sends and store it (used as app icon / logo).
  if (msg && msg.photo && msg.photo.length) {
    try {
      const authed = await isAdminAuthed(ENV, msg.chat.id);
      if (authed || msg.chat.id.toString() === String(ENV.ADMIN_CHAT_ID || "")) {
        const best = msg.photo[msg.photo.length - 1];
        const meta = await tgApi(ENV.ADMIN_BOT_TOKEN, "getFile", { file_id: best.file_id }).catch(() => null);
        if (meta && meta.result && meta.result.file_path) {
          const urlp = "https://api.telegram.org/file/bot" + ENV.ADMIN_BOT_TOKEN + "/" + meta.result.file_path;
          const img = await fetch(urlp);
          if (img.ok) {
            const buf = new Uint8Array(await img.arrayBuffer());
            const b64 = Array.from(buf).map(function (b) { return String.fromCharCode(b); }).join("");
            const caption = (msg.caption || "").toLowerCase();
            // If this photo replies to a /broadcast draft, stage it for broadcast.
            const replied = msg.reply_to_message && msg.reply_to_message.text &&
              msg.reply_to_message.text.startsWith("/broadcast");
            if (replied) {
              await ENV.AAA_KV.put("broadcast_last_photo", b64);
              await tgSend(ENV.ADMIN_BOT_TOKEN, msg.chat.id,
                "📸 Photo staged for the next /broadcast. Now send <code>/broadcast &lt;caption&gt;</code> to send it to all users.");
            } else {
              if (ENV.aaa_assets) {
                await ENV.aaa_assets.put("public/admin-sent-icon.png", buf, { httpMetadata: { contentType: "image/png" } });
                if (caption.includes("#logo") || !caption.includes("#icon")) {
                  await ENV.aaa_assets.put("public/aaa-store-logo.png", buf, { httpMetadata: { contentType: "image/png" } });
                }
              }
              await ENV.AAA_KV.put("admin_last_photo", JSON.stringify({ file_id: best.file_id, caption: msg.caption || "" }));
              const which = caption.includes("#icon") ? "app icon" : (caption.includes("#logo") ? "store logo" : "app icon & store logo");
              await tgSend(ENV.ADMIN_BOT_TOKEN, msg.chat.id,
                "🖼 Saved your image as <b>" + which + "</b>.\n• <code>public/admin-sent-icon.png</code>\n• <code>public/aaa-store-logo.png</code> (if logo)\nUse /setlogo to re-apply, /seticon for icon only.");
            }
          }
        }
      }
    } catch (e) {}
    return;
  }
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const args = text.split(/\s+/);
  // Strip a possible "@botusername" suffix Telegram appends to commands
  // (e.g. "/start@AAA_ADMIN_APPS_bot") so command routing always matches.
  const cmd = args[0].toLowerCase().split("@")[0];

  // One-shot prompt tiles (tapped from the grid): the next text message is
  // captured and routed to the right action instead of being parsed as a command.
  if (cmd.startsWith("/") === false || cmd === "/menu") {
    let awaiting = null;
    try { awaiting = await ENV.AAA_KV.get("await_" + chatId); } catch (e) {}
    if (awaiting && !text.startsWith("/")) {
      try { await ENV.AAA_KV.delete("await_" + chatId); } catch (e) {}
      if (awaiting.startsWith("sk:")) {
        // 2-step API key value captured. Save it live.
        const provider = awaiting.slice(3);
        const allowed = { json2video: "JSON2VIDEO_KEY", kie: "KIE_API_KEY", kiehmac: "KIE_HMAC_KEY", hf: "HF_KEY", gemini: "GEMINI_KEY", groq: "GROQ_KEY", tensor: "TENSOR_ART_KEY", youtube: "yt_owner_refresh", pollinations: "POLLINATIONS_KEY", shotstack: "SHOTSTACK_KEY" };
        const sec = allowed[provider];
        if (sec) {
          const kvKey = provider === "youtube" ? "yt_owner_refresh" : "key_" + provider;
          try { await ENV.AAA_KV.put(kvKey, text.trim()); } catch (e) {}
          await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Key <b>" + provider + "</b> updated live.");
        }
        return;
      }
      // Each tap command now routes the reply through the AI, which shapes the
      // free-text into a clean, correctly-formatted action.
      if (awaiting === "bc") {
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 Shaping your broadcast…");
        const msg = await aiBroadcastBrief(text, ENV);
        await handleAdmin({ message: { chat: { id: chatId }, text: "/broadcast " + msg, from: msg.from } });
        return;
      }
      if (awaiting === "ch") {
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 Shaping your channel post…");
        const msg = await aiChannelBrief(text, ENV);
        await handleAdmin({ message: { chat: { id: chatId }, text: "/channel " + msg, from: msg.from } });
        return;
      }
      if (awaiting === "img") {
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 Shaping your image prompt…");
        const prompt = await aiImageBrief(text, ENV);
        await handleAdmin({ message: { chat: { id: chatId }, text: "/img " + prompt, from: msg.from } });
        return;
      }
      if (awaiting === "schedule") {
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 Reading your schedule…");
        const s = await aiScheduleBrief(text, ENV);
        await handleAdmin({ message: { chat: { id: chatId }, text: "/schedule " + s.minutes + " " + s.message, from: msg.from } });
        return;
      }
      // vid / reel: the AI turns the reply into a refined Short brief + type, then renders.
      if (awaiting === "vid" || awaiting === "reel") {
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 Got it — let me shape that into a Short…");
        try {
          const brief = await aiVideoBrief(text, ENV);
          await doVideo(ENV, chatId, brief.prompt, { vertical: true, type: brief.type });
        } catch (e) {
          await doVideo(ENV, chatId, text, { vertical: true, type: "general" });
        }
        return;
      }
      if (awaiting === "ai") {
        // Free-chat mode: send the message straight to the ops AI.
        await handleAdmin({ message: { chat: { id: chatId }, text: "/ai " + text, from: msg.from } });
        return;
      }
    }
  }

  // Admin auth via password (stored in KV, default "Arif-Abid"). No hardcoded chat id.
  // Optionally, a KV list "admin_list" (comma-separated chat ids) auto-grants access.
  const ADMIN_PASSWORD = (await ENV.AAA_KV.get("admin_password")) || "Arif-Abid";
  const authed = await isAdminAuthed(ENV, chatId);
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
    if (!authed) {
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

  if (cmd === "/admins") {
    const owner = (ENV.ADMIN_CHAT_ID && ENV.ADMIN_CHAT_ID !== "REPLACE_WITH_ADMIN_CHAT_ID") ? String(ENV.ADMIN_CHAT_ID) : "(not set)";
    const list = (await ENV.AAA_KV.get("admin_list") || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    const extra = list.length ? list.map(function (x) { return "• " + x; }).join("\n") : "(none)";
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🛡 <b>Admins</b>\nOwner: <code>" + owner + "</code>\nList:\n" + extra);
    return;
  }

  // Entry points are always reachable (no auth required to open the panel).
  if (cmd === "/start" || cmd === "/menu") {
    await sendAdminMenu(chatId);
    return;
  }
  if (cmd === "/help") {
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, buildHelp());
    return;
  }

  if (!authed) {
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔐 Send: <code>/login Arif-Abid</code> to access the admin panel.");
    return;
  }

  // Guard the whole command block so a single DB/API error is reported back
  // to the chat instead of silently dropping the response.
  try {
  if (cmd === "/ai") {
    const q = args.slice(1).join(" ");
    if (!q) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /ai &lt;question&gt;"); return; }
    // Auto-generate media when the admin asks for an image or video.
    const lower = q.toLowerCase();
    if (/\b(image|picture|photo|draw|render|paint|make an? (image|picture))\b/.test(lower)) {
      await handleAdmin({ message: { chat: { id: chatId }, text: "/img " + q, from: msg.from } });
      return;
    }
    if (/\b(video|clip|promo|trailer|movie)\b/.test(lower)) {
      await handleAdmin({ message: { chat: { id: chatId }, text: "/video " + q, from: msg.from } });
      return;
    }
    await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
    const stats = await gatherStats(ENV);
    const kb = await kbContext(ENV, q);
    const ctx = statsBlock(stats) + "\n\nPROVIDER HEALTH:\n" + (await providerHealthLine(ENV)) +
      (kb ? "\n\nREFERENCE KNOWLEDGE (open-source):\n" + kb : "");
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

  if (cmd === "/channel") {
    let message = args.slice(1).join(" ");
    if (!message) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: <code>/channel &lt;message&gt;</code>\nUse <code>/channel ai: &lt;topic&gt;</code> to let the AI write the post.\n\n🤖 An image (and video, if credits) is auto-generated and posted with it."); return; }
    let topic = null;
    if (message.toLowerCase().startsWith("ai:")) topic = message.slice(3).trim();
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 Writing copy + generating image/video for the channel…");
    const res = topic
      ? await generateChannelPost("", { aiTopic: topic })
      : await generateChannelPost(message);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      (res.posted ? "✅ Posted to channel" : "⚠️ Channel post failed (bot must be admin)") +
      (res.videoPosted ? " · 🎬 video included" : "") +
      (res.ytPosted ? " · 📺 YouTube synced" : ""));
    return;
  }

  if (cmd === "/setkey") {
    const name = (args[1] || "").toLowerCase();
    const value = args.slice(2).join(" ");
    // Provider API keys (read live from KV overrides) + the YouTube OAuth
    // refresh token (stored in KV and used by the YouTube posting path).
    const allowed = { json2video: "JSON2VIDEO_KEY", kie: "KIE_API_KEY", kiehmac: "KIE_HMAC_KEY", hf: "HF_KEY", gemini: "GEMINI_KEY", groq: "GROQ_KEY", tensor: "TENSOR_ART_KEY", youtube: "yt_owner_refresh", pollinations: "POLLINATIONS_KEY", shotstack: "SHOTSTACK_KEY" };
    if (!allowed[name] || !value) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
        "Usage: /setkey &lt;json2video|kie|kiehmac|hf|gemini|groq|tensor|youtube|pollinations&gt; &lt;value&gt;\n" +
        "• provider keys update live (KV override, no redeploy)\n" +
        "• youtube = paste the OAuth refresh token to enable YouTube uploads");
      return;
    }
    const kvKey = name === "youtube" ? "yt_owner_refresh" : "key_" + name;
    await ENV.AAA_KV.put(kvKey, value);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Key <b>" + name + "</b> updated. Takes effect on next request.");
    return;
  }

  if (cmd === "/keys") {
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, await keyStatus(ENV));
    return;
  }

  if (cmd === "/yt") {
    const refresh = ENV.AAA_KV ? await ENV.AAA_KV.get("yt_owner_refresh") : "";
    if (!refresh) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ No YouTube refresh token. Set it with /setkey youtube &lt;refresh_token&gt; (or tap 🔑 Set API Key)."); return; }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ YouTube is connected (refresh token present in KV). Channel posts with a video will upload a NEW YouTube video; text-only posts edit the latest video description.");
    return;
  }

  if (cmd === "/vidstatus") {
    const last = ENV.AAA_KV ? await ENV.AAA_KV.get("vid_last") : "";
    const full = ENV.AAA_KV ? await ENV.AAA_KV.get("vid_fullerr") : "";
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🎬 Last render:\n" + htmlEscape(last || "(none)") + (full ? "\n\n❌ " + htmlEscape(full) : ""));
    return;
  }
  if (cmd === "/ytupload") {
    const refresh = ENV.AAA_KV ? await ENV.AAA_KV.get("yt_owner_refresh") : "";
    if (!refresh) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ YouTube not connected. Connect via /ytconnect (owner) first."); return; }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "📺 Fetching the last generated video…");
    // Pick whichever cached video is newer (reel or promo).
    let buf = null, which = "";
    try {
      const r1 = ENV.aaa_assets ? await ENV.aaa_assets.get("temp/last_reel.mp4") : null;
      const r2 = ENV.aaa_assets ? await ENV.aaa_assets.get("temp/last_promo.mp4") : null;
      const a = r1 ? await r1.arrayBuffer() : null;
      const b = r2 ? await r2.arrayBuffer() : null;
      const aOk = a && a.byteLength > 1000, bOk = b && b.byteLength > 1000;
      if (aOk && (!bOk || (a.byteLength >= b.byteLength))) { buf = new Uint8Array(a); which = "reel"; }
      else if (bOk) { buf = new Uint8Array(b); which = "promo"; }
    } catch (e) {}
    if (!buf || buf.byteLength < 1000) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ No cached video. Generate one first with 🎬 Video or 📱 Reel."); return; }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "📺 Uploading " + which + " to YouTube…");
    const yt = await uploadVideoToYouTube(buf, "Super AI — " + which, "Made with Super AI (Ari AI engine). Get the app: https://aaa-store.aaateam.workers.dev/store", ENV);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, yt ? "✅ Uploaded to YouTube as a new video." : "⚠️ Upload failed. The owner token needs the youtube.upload scope — reconnect via /ytconnect.");
    if (yt) { try { await adminChannelNotify(ENV, "Video Uploaded to YouTube", { Type: which }); } catch (_) {} }
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
    const arg2 = (arg || "").trim().toLowerCase();
    if (arg2 === "on" || arg2 === "off") {
      const on = arg2 === "on";
      try { await ENV.AAA_KV.put("autopost_enabled", on ? "1" : "0"); } catch (e) {}
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 Automatic Short creation is now " + (on ? "ENABLED ✅" : "DISABLED ⏸") + ".");
      return;
    }
    const enabled = (ENV.AAA_KV ? await ENV.AAA_KV.get("autopost_enabled") : null) || "1";
    const r = await autoPostAi(ENV);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "🤖 Auto-post done." + (enabled === "0" ? " (Note: auto mode is OFF — only this manual run executed.)\n" : "\n") +
      "Channel: " + (r.toChannel ? "✅" : "❌") +
      "\nYouTube desc: " + (r.toYt ? "✅" : "❌") +
      "\nShort video: " + (r.toYtVideo ? "✅" : "— skipped"));
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
    let detail = "";
    if (ok) {
      try {
        const base = ENV.SUPABASE_URL, key = ENV.SUPABASE_SERVICE_ROLE;
        const users = await fetch(base + "/rest/v1/users?select=uid&limit=1", { headers: { apikey: key, Authorization: "Bearer " + key } });
        const cnt = await fetch(base + "/rest/v1/users?select=count", { headers: { apikey: key, Authorization: "Bearer " + key, Prefer: "count=exact" } });
        const n = cnt.headers.get("content-range");
        detail = "\n👥 users: " + (n ? n.split("/")[1] : "?") + "\n🔗 Firebase→Supabase mirror: ON (" + (ENV.FIREBASE_PROJECT_ID || "aaa-infinity-ai") + ")";
      } catch (e) { detail = ""; }
    }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      (ok ? "🟢 Supabase active — mirror schema provisioned and reachable." + detail
          : "🔴 Supabase unreachable — project paused, or keys missing."));
    return;
  }

  if (cmd === "/sync") {
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔄 Reconciling D1 → Supabase mirror…");
    if (!ENV.AAA_DB) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ D1 unavailable."); return; }
    await supabaseProvision(ENV);
    const users = await ENV.AAA_DB.prepare("SELECT uid, points, lifetime_earned, premium_until FROM users").all();
    const rows = (users && users.results) || [];
    let n = 0, errs = 0;
    for (const u of rows) {
      const ok = await supabaseUpsert(ENV, "users", {
        uid: u.uid, points: u.points || 0, lifetime_earned: u.lifetime_earned || 0, premium_until: u.premium_until || 0,
      }, "uid");
      if (ok) n++; else errs++;
    }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "✅ Synced <b>" + n + "</b> users D1→Supabase" + (errs ? " (" + errs + " failed)" : "") + ".\n🔥 Firebase→D1→Supabase link healthy.");
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
      info += "App users: " + (u?.c || 0) + "\nTotal points: " + (u?.p || 0) + "\n";
      const store = await ENV.AAA_DB.prepare(
        "SELECT COUNT(*) total, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) approved, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending, COALESCE(SUM(downloads),0) dl FROM store_apps"
      ).first();
      info += "Store apps: " + (store?.total || 0) + " (" + (store?.approved || 0) + " approved, " + (store?.pending || 0) + " pending)\n";
      info += "Store downloads: " + (store?.dl || 0) + "\n";
      const users = await ENV.AAA_DB.prepare("SELECT COUNT(*) c FROM store_users").first();
      info += "Store users: " + (users?.c || 0) + "\n";
      const refs = await ENV.AAA_KV.list({ prefix: "refcount:" });
      let refTotal = 0;
      for (const k of refs.keys) { try { refTotal += parseInt(await ENV.AAA_KV.get(k.name) || "0", 10); } catch (e) {} }
      info += "Referred users: " + refTotal + "\n";
      const today = await ENV.AAA_DB.prepare("SELECT COUNT(*) c FROM install_log WHERE day = date('now')").first().catch(() => null);
      if (today) info += "Installs today: " + (today.c || 0) + "\n";
    }
    const codes = await ENV.AAA_KV.list({ prefix: "login:" });
    info += "Pending link codes: " + codes.keys.length + "\n";
    const subs = await ENV.AAA_KV.list({ prefix: "key:" });
    info += "Key submissions: " + subs.keys.length;
    const ver = await ENV.AAA_KV.get("app_version_name");
    if (ver) info += "\nApp version: v" + ver;
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, info);
    if (args[1] === "ai") {
      await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
      const ans = await adminAi(
        "You are the growth lead for 'Super AI', an Android app with an in-app points/store ecosystem. Given these live metrics, give 2-3 sharp, actionable growth or retention moves. Be concise, no fluff.",
        info.replace(/<[^>]+>/g, ""));
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 <b>AI Growth Insight</b>\n" + htmlEscape(ans));
    }
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
    let message = args.slice(1).join(" ");
    if (!message) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "What should I send to all users? Just type it — e.g. <i>\"broadcast: New update is live!\"</i> or simply say <i>\"tell all users we shipped v2.3\"</i>."); return; }
    // AI-assisted drafting (reduces admin workload). The AI keys you provided power this.
    if (message.toLowerCase().startsWith("ai:")) {
      const topic = message.slice(3).trim();
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 Drafting broadcast with AI…");
      try {
        message = await adminAi(
          "Write a short, friendly Telegram broadcast for our Super AI Android app users about: " + topic +
          ". Max 2 sentences, 1-2 relevant emojis, no hashtags. Output only the message.",
          "");
      } catch (e) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ AI draft failed, using your text as-is."); }
    }
    // Collect recipient chat IDs from app profiles + store users (dedup).
    const ids = new Set();
    try {
      const listed = await ENV.AAA_KV.list({ prefix: "profile:" });
      for (const k of listed.keys) ids.add(k.name.slice("profile:".length));
    } catch (e) {}
    if (ENV.AAA_DB) {
      try {
        const rows = await ENV.AAA_DB.prepare("SELECT DISTINCT tg_chat FROM store_users WHERE tg_chat IS NOT NULL").all();
        for (const r of (rows.results || [])) ids.add(String(r.tg_chat));
      } catch (e) {}
    }
    if (!ids.size) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ No users to broadcast to."); return; }
    let sent = 0, failed = 0;
    const photoBuf = ENV.AAA_KV ? await ENV.AAA_KV.get("broadcast_last_photo") : null;
    for (const id of ids) {
      let ok = false;
      if (photoBuf) {
        ok = await tgSendPhoto(ENV.LOGIN_BOT_TOKEN, id, photoBuf, message);
      } else {
        ok = await tgSendSafe(ENV.LOGIN_BOT_TOKEN, id, "📣 <b>Super AI</b>\n" + htmlEscape(message));
      }
      if (ok) sent++; else failed++;
      if ((sent + failed) % 20 === 0) await new Promise(function (r) { setTimeout(r, 1000); }); // throttle
    }
    await ENV.AAA_KV.delete("broadcast_last_photo").catch(function () {});
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "✅ Broadcast sent to " + sent + " user(s)" + (failed ? " (" + failed + " unreachable)" : "") + ".");
    adminChannelNotify(ENV, "Broadcast Sent", {
      "Channel": "AAA AI APP ADMIN",
      "Recipients": sent + (failed ? " (" + failed + " failed)" : ""),
      "Had Image": photoBuf ? "Yes" : "No",
    }).catch(function () {});
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
      // AI risk signal: flag impersonation, trademark, or spammy names.
      const risk = await adminAi(
        "You are an app-store moderator. Given this pending app submission, flag ONLY real risks: trademark/brand impersonation (e.g. 'WhatsApp', 'Instagram', 'Netflix'), obvious malware/phishing signals, or spam. If safe, reply 'SAFE'. Be one line, no preamble.",
        "APP: name=" + (a.name || "") + " | category=" + (a.category || "") + " | desc=" + (a.short_desc || "") + " | pkg=" + (a.package_name || ""));
      const safe = !risk || /^\s*safe/i.test(risk.trim());
      if (!safe) {
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ <b>AI moderation flag:</b> " + htmlEscape(risk.trim()));
      }
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

  // ---- Cloudflare control panel (KV / R2 / D1 / crashes / version) ----
  if (cmd === "/cf") {
    const vCode = (await ENV.AAA_KV.get("app_version_code")) || "?";
    const vName = (await ENV.AAA_KV.get("app_version_name")) || "?";
    const dl = (await ENV.AAA_KV.get("app_downloads")) || "0";
    const crashes = await (async () => {
      try { return (JSON.parse(await ENV.AAA_KV.get("crashlog:index") || "[]")).length; } catch (e) { return 0; }
    })();
    const origin = ENV.PUBLIC_ORIGIN || "https://aaa-ai-bot.aaateam.workers.dev";
    const txt =
      "☁️ <b>Cloudflare Panel</b>\n\n" +
      "📦 App: <b>v" + vName + "</b> (code " + vCode + ")\n" +
      "⬇️ Downloads: <b>" + dl + "</b>\n" +
      "🐞 Captured crashes: <b>" + crashes + "</b>\n\n" +
      "🌐 <b>Account</b> " + (ENV.CLOUDFLARE_ACCOUNT_ID || "0990a77a6f54b26e433668dc215320fb").slice(0, 8) + "…\n" +
      "⚙️ Workers:\n" +
      "  • aaa-ai-bot → " + origin + "\n" +
      "  • aaa-store → https://aaa-store.aaateam.workers.dev\n" +
      "🗄 KV: <code>AAA_KV</code> (631dab0f…)\n" +
      "🛢 D1: <code>aaa_db</code> (b5be290f…)\n" +
      "📦 R2: <code>aaa-assets</code>\n\n" +
      "Commands:\n" +
      "/secrets — list all Cloudflare secrets (masked)\n" +
      "/crashlog — view app crash reports\n" +
      "/version — show & set app version\n" +
      "/kv &lt;key&gt; — read a KV value\n" +
      "/cleanup — run maintenance (prune old data)\n" +
      "/d1 — App Store DB stats\n" +
      "/apps — recent store apps\n" +
      "/review — pending store submissions";
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, txt);
    return;
  }

  if (cmd === "/crashlog") {
    let idx = [];
    try { idx = JSON.parse(await ENV.AAA_KV.get("crashlog:index") || "[]"); } catch (e) {}
    if (!idx.length) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ No crashes captured."); return; }
    const limit = Math.min(parseInt(args[1] || "5", 10) || 5, 20);
    const only = args[2] === "ai";
    for (const ts of idx.slice(0, limit)) {
      const r = await ENV.AAA_KV.get("crashlog:" + ts);
      if (!r) continue;
      let rec; try { rec = JSON.parse(r); } catch (e) { continue; }
      const dev = rec.device || {};
      const txt =
        "🐞 <b>Crash</b> " + new Date((rec.ts || ts) * 1).toISOString().slice(0, 19).replace("T", " ") + "\n" +
        "📱 " + htmlEscape((dev.manufacturer || "?") + " " + (dev.model || "?")) + " (SDK " + (dev.sdk || "?") + ")\n" +
        "💥 <code>" + htmlEscape((rec.message || "").slice(0, 200)) + "</code>\n" +
        "🧵 " + htmlEscape(rec.thread || "?") + "\n" +
        "<pre>" + htmlEscape((rec.stack || "").split("\n").slice(0, 6).join("\n").slice(0, 900)) + "</pre>";
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, txt);
    }
    if (only || args[2] == null) {
      // AI root-cause: summarize the top crashes and suggest fixes.
      await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
      let ctxLines = [];
      for (const ts of idx.slice(0, Math.min(limit, 8))) {
        const raw = await ENV.AAA_KV.get("crashlog:" + ts);
        if (!raw) continue;
        let rec; try { rec = JSON.parse(raw); } catch (e) { continue; }
        ctxLines.push("- " + (rec.message || "?").slice(0, 120) + " | " +
          ((rec.stack || "").split("\n")[1] || "").slice(0, 100));
      }
      if (ctxLines.length) {
        const ans = await adminAi(
          "You are the lead Android engineer. Given these recent crash signatures, identify the most likely root cause(s), which are most severe, and give 2-3 concrete fix recommendations. Be concise.",
          "CRASHES:\n" + ctxLines.join("\n"));
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 <b>AI Root-Cause</b>\n" + htmlEscape(ans));
      }
    }
    return;
  }

  if (cmd === "/version") {
    const cur = (await ENV.AAA_KV.get("app_version_name")) || "?";
    const code = (await ENV.AAA_KV.get("app_version_code")) || "?";
    const setVer = args[1];
    if (setVer && /^[\w.]+$/.test(setVer)) {
      await ENV.AAA_KV.put("app_version_name", setVer);
      if (args[2] && /^\d+$/.test(args[2])) await ENV.AAA_KV.put("app_version_code", args[2]);
      const ch = args.slice(3).join(" ");
      if (ch) await ENV.AAA_KV.put("app_changelog", ch);
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Version set to <b>v" + setVer + "</b> (code " + (args[2] || code) + ")");
    } else {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
        "📦 Current: <b>v" + cur + "</b> (code " + code + ")\n\nSet with:\n/version &lt;name&gt; &lt;code&gt; &lt;changelog&gt;\ne.g. /version 2.2.4 11 Bug fixes");
    }
    return;
  }

  if (cmd === "/store") {
    const cur = (await ENV.AAA_KV.get("app_version_name")) || "?";
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "🛍 <b>AAA App Store</b>\n📦 Super AI <b>v" + cur + "</b>\n🔗 " + STORE_URL +
      "\n\nShare this link (no direct APK).");
    return;
  }

  if (cmd === "/setlogo") {
    const raw = await ENV.AAA_KV.get("admin_last_photo");
    if (!raw) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Send an image first, then /setlogo."); return; }
    try {
      const j = JSON.parse(raw);
      const meta = await tgApi(ENV.ADMIN_BOT_TOKEN, "getFile", { file_id: j.file_id }).catch(() => null);
      if (meta && meta.result && meta.result.file_path) {
        const img = await fetch("https://api.telegram.org/file/bot" + ENV.ADMIN_BOT_TOKEN + "/" + meta.result.file_path);
        if (img.ok && ENV.aaa_assets) {
          const buf = new Uint8Array(await img.arrayBuffer());
          await ENV.aaa_assets.put("public/aaa-store-logo.png", buf, { httpMetadata: { contentType: "image/png" } });
          await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Store logo updated to your last image.");
          return;
        }
      }
    } catch (e) {}
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Could not apply logo. Send the image again.");
    return;
  }

  if (cmd === "/kv") {
    const key = args[1];
    if (!key) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /kv &lt;key&gt;"); return; }
    const val = await ENV.AAA_KV.get(key);
    if (val === null) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "∅ No value for <code>" + htmlEscape(key) + "</code>"); return; }
    const shown = val.length > 1500 ? val.slice(0, 1500) + "…" : val;
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🗄 <code>" + htmlEscape(key) + "</code>:\n<pre>" + htmlEscape(shown) + "</pre>");
    return;
  }

  if (cmd === "/cleanup") {
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🧹 Running cleanup…");
    const res = await cleanup(ENV);
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "✅ Cleanup done:\n• history deleted: " + (res.history_deleted || 0) +
      "\n• transactions deleted: " + (res.transactions_deleted || 0) +
      "\n• R2 temp objects: " + (res.r2_deleted || 0));
    return;
  }

  if (cmd === "/d1") {
    if (!ENV.AAA_DB) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Store DB unavailable."); return; }
    const apps = await ENV.AAA_DB.prepare("SELECT status, COUNT(*) c FROM store_apps GROUP BY status").all();
    const users = await ENV.AAA_DB.prepare("SELECT COUNT(*) c FROM store_users").first();
    let out = "🛒 <b>App Store DB</b>\nUsers: <b>" + ((users && users.c) || 0) + "</b>\nApps:\n";
    for (const r of (apps && apps.results) || []) out += "• " + htmlEscape(r.status) + ": " + r.c + "\n";
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, out);
    return;
  }

  // ---- Cloudflare secrets viewer (full values for owner chat, masked for others) ----
  if (cmd === "/secrets") {
    const ownerChat = (ENV.ADMIN_CHAT_ID && ENV.ADMIN_CHAT_ID !== "REPLACE_WITH_ADMIN_CHAT_ID") ? String(ENV.ADMIN_CHAT_ID) : null;
    const isOwner = ownerChat && String(chatId) === ownerChat;
    const names = [
      "ADMIN_BOT_TOKEN", "ADMIN_CHAT_ID", "APP_SHARED_SECRET", "CHANNEL_ID", "FELIX_BASE",
      "FREE_AI_BOT_TOKEN", "GEMINI_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
      "GROQ_KEY", "HF_KEY", "JSON2VIDEO_KEY", "KIE_API_KEY", "KIE_HMAC_KEY",
      "LOGIN_BOT_TOKEN", "PUBLIC_ORIGIN", "SUPABASE_ANON", "SUPABASE_SERVICE_ROLE",
      "SUPABASE_URL", "YT_UPLOAD_SECRET", "TG_API_ID", "TG_API_HASH", "FIREBASE_WEB_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_DB_URL", "FIREBASE_STORAGE_BUCKET", "FIREBASE_SERVICE_ACCOUNT",
    ];
    const mask = (v) => {
      if (v == null || v === "") return "∅ (unset)";
      const s = String(v);
      if (s.length <= 8) return s[0] + "••••" + s.slice(-1);
      return s.slice(0, 4) + "…" + s.slice(-4) + " (" + s.length + " chars)";
    };
    let out = "🔐 <b>Cloudflare Secrets</b> · aaa-ai-bot\n";
    out += isOwner ? "👁 <b>Full values</b> (owner chat)\n\n" : "🫥 <b>Masked</b> (not owner chat — ask owner for full)\n\n";
    for (const n of names) {
      const val = ENV[n];
      const disp = (isOwner && val != null && val !== "") ? String(val) : mask(val);
      out += "• <code>" + n + "</code> = <code>" + htmlEscape(disp) + "</code>\n";
    }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, out);
    return;
  }

  if (cmd === "/status") {
    const checks = [];
    let kvOk = false, r2Ok = false, d1Ok = false;
    try { await ENV.AAA_KV.get("app_version_name"); kvOk = true; } catch (e) {}
    try { await ENV.aaa_assets.list({ limit: 1 }); r2Ok = true; } catch (e) {}
    try { await ENV.AAA_DB.prepare("SELECT 1").first(); d1Ok = true; } catch (e) {}
    checks.push("🗄 KV: " + (kvOk ? "✅" : "❌"));
    checks.push("📦 R2: " + (r2Ok ? "✅" : "❌"));
    checks.push("🛢 D1: " + (d1Ok ? "✅" : "❌"));
    const v = (await ENV.AAA_KV.get("app_version_name")) || "?";
    const dl = (await ENV.AAA_KV.get("app_downloads")) || "0";
    let fbOk = false, sbOk = false;
    try { fbOk = !!(ENV.FIREBASE_SERVICE_ACCOUNT && JSON.parse(ENV.FIREBASE_SERVICE_ACCOUNT).client_email); } catch (e) {}
    try { sbOk = await supabaseKeepAlive(ENV); } catch (e) {}
    // D1 <-> Supabase row-count cross-check (the 3-way link heartbeat).
    let d1Users = 0, sbUsers = 0;
    try { d1Users = (await ENV.AAA_DB.prepare("SELECT COUNT(*) c FROM users").first()).c || 0; } catch (e) {}
    try {
      const r = await fetch(ENV.SUPABASE_URL + "/rest/v1/users?select=uid&limit=1", { headers: { apikey: ENV.SUPABASE_SERVICE_ROLE, Authorization: "Bearer " + ENV.SUPABASE_SERVICE_ROLE, Prefer: "count=exact" } });
      const cr = r.headers.get("content-range");
      sbUsers = cr ? parseInt(cr.split("/")[1] || "0", 10) || 0 : 0;
    } catch (e) {}
    const link = (fbOk && sbOk && d1Users > 0) ? " ✅ linked" : (fbOk && sbOk ? " ⚠️ empty" : " ❌");
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
      "🩺 <b>System Status</b>\n" + checks.join("\n") +
      "\n🔥 Firebase (auth): " + (fbOk ? "✅" : "❌") +
      "\n🐘 Supabase (mirror): " + (sbOk ? "✅" : "❌") + " — " + sbUsers + " users" +
      "\n🛢 D1 (authoritative): " + (d1Ok ? "✅" : "❌") + " — " + d1Users + " users" +
      "\n🔗 Firebase→D1→Supabase:" + link +
      "\n\n📦 App v" + v + " · ⬇️ " + dl + " downloads\n☁️ Account 0990a77a…");
    return;
  }

  if (cmd === "/r2") {
    if (!ENV.aaa_assets) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ R2 unavailable."); return; }
    const prefix = args[1] || "store/apks/";
    const listed = await ENV.aaa_assets.list({ prefix: prefix, limit: 20 });
    const objs = (listed && listed.objects) || [];
    if (!objs.length) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "📦 No objects under <code>" + htmlEscape(prefix) + "</code>"); return; }
    let out = "📦 <b>R2: " + htmlEscape(prefix) + "</b>\n";
    for (const o of objs) out += "• " + htmlEscape(o.key) + " (" + ((o.size || 0) / 1024 / 1024).toFixed(1) + " MB)\n";
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, out);
    return;
  }

  // ---- Admin AI: auto-generate image (→ admin chat + channel) ----
  if (cmd === "/img" || cmd === "/image") {
    const prompt = args.slice(1).join(" ").trim();
    if (!prompt) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /img &lt;prompt&gt;  — generates an image via the Ari AI engine\nOptional: end with <code>ar:16:9</code> or <code>ar:1:1</code> for aspect ratio."); return; }
    // Parse optional aspect-ratio suffix: "ar:16:9" / "ar:1:1"
    let ar = "1:1", ptext = prompt;
    const m = prompt.match(/\bar:(\d+):(\d+)\s*$/i);
    if (m) { ar = m[1] + ":" + m[2]; ptext = prompt.slice(0, m.index).trim(); }
    const dims = ar === "16:9" ? { width: 1280, height: 720 } : ar === "9:16" ? { width: 720, height: 1280 } : { width: 1024, height: 1024 };
    await tgAction(ENV.ADMIN_BOT_TOKEN, chatId, "upload_photo");
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🎨 Generating image… (" + ar + ")");
    try {
      let buf = await generateImage(ptext, ENV, dims);
      if (!buf || !buf.byteLength) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Image generation failed (providers unavailable). Try again."); return; }
      const url = (ENV.PUBLIC_ORIGIN || "https://aaa-ai-bot.aaateam.workers.dev").replace(/\/$/, "") + "/api/asset/temp/img_" + Date.now() + ".jpg";
      // Cache to R2 so the "repost" / channel can reuse it (unique key per run).
      try { if (ENV.aaa_assets) await ENV.aaa_assets.put("temp/img_" + Date.now() + ".jpg", buf, { httpMetadata: { contentType: "image/jpeg" } }); } catch (_) {}
      const caption = "🎨 <b>" + htmlEscape(ptext.slice(0, 200)) + "</b>\n<i>Generated by the Ari AI engine</i>";
      // 1) Admin chat (URL when possible to avoid base64 limits)
      try {
        const up = await tgApi(ENV.ADMIN_BOT_TOKEN, "sendPhoto", { chat_id: chatId, photo: url, caption: caption, parse_mode: "HTML" });
        if (!up || !up.ok) await tgApi(ENV.ADMIN_BOT_TOKEN, "sendPhoto", { chat_id: chatId, photo: "data:image/jpeg;base64," + Buffer.from(buf).toString("base64"), caption: caption, parse_mode: "HTML" });
      } catch (e) {
        await tgApi(ENV.ADMIN_BOT_TOKEN, "sendPhoto", { chat_id: chatId, photo: "data:image/jpeg;base64," + Buffer.from(buf).toString("base64"), caption: caption, parse_mode: "HTML" });
      }
      // 2) Channel
      const chOk = await postMediaToChannelUrl(ENV, "photo", url, caption);
      if (chOk) await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Also posted to channel.");
      try { await recordLearning(ENV, "image", { prompt: ptext, ok: true }); } catch (_) {}
    } catch (e) {
      try { await recordLearning(ENV, "image", { prompt: ptext, ok: false, notes: String((e && e.message) || e).slice(0,80) }); } catch (_) {}
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Image error: " + htmlEscape(String(e && e.message || e)));
    }
    return;
  }

  /** Shared video pipeline: renders a vertical 9:16 YouTube Short via Shotstack
   *  (reliable + free), uploads it to YouTube as a Short, posts to admin chat +
   *  channel, then deletes the cached R2 copy. Streams the source URL to avoid
   *  loading large clips into worker memory. */
  async function doVideo(ENV, chatId, prompt, opts) {
    opts = opts || {};
    const vtype = opts.type || "general";
    if (!prompt) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /video &lt;text&gt; — renders a vertical 9:16 YouTube Short.\nTypes: add <code>type:ad</code>, <code>type:promo</code> or <code>type:tip</code> to the message (e.g. <code>/video type:ad Our new app</code>).");
      return;
    }
    if (!ENV.SHOTSTACK_KEY) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ No video provider set. Add Shotstack with /setkey shotstack <key> (free sandbox key works).");
      return;
    }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "📱 Rendering vertical Short (" + vtype + ")…" + " (this can take ~60s)");
    await tgAction(ENV.ADMIN_BOT_TOKEN, chatId, "upload_video");
    let srcName = "shotstack";
    let res = null, buf = null, videoUrl = null, voiceErr = null;
    let vidErr = null;
    const ckpt = async (s) => { try { await ENV.AAA_KV.put("vid_last", s); } catch (e) {} try { if (ENV.aaa_assets) await ENV.aaa_assets.put("public/vidstatus.txt", s); } catch (e) {} };
    await ckpt("start type=" + vtype);
    try { res = await generateVideoShotstack(prompt, ENV, false, true, vtype); } catch (e) { srcName = "shotstack|ERR " + String((e && e.message) || e).slice(0, 80); await ckpt("THREW: " + srcName); }
    if (res) { await ckpt("returned hasBuf=" + !!res.buf + " voiceErr=" + (res.voiceErr || "")); }
    if (res && res.buf) { buf = res.buf; videoUrl = res.url; voiceErr = res.voiceErr; } else if (res) { buf = res; videoUrl = res.url; voiceErr = res.voiceErr; vidErr = res.error; }
    if (voiceErr === "terms") await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔇 No voice: accept Groq Orpheus terms at console.groq.com → Settings → Model Terms (orpheus-v1-english).");
    else if (voiceErr === "no_key") await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔇 No voice: set Groq key with /setkey groq <key>.");
    if (vidErr) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Render issue: " + htmlEscape(vidErr.slice(0, 1500))); try { await ENV.AAA_KV.put("vid_fullerr", vidErr); } catch (e) {} }
    if (!res) await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Render threw: " + htmlEscape(srcName.slice(0, 200)));
    // Validate the render actually serves a real video; if it's a broken render,
    // treat it as failed so we can surface a clear error.
    if (videoUrl) {
      try {
        const pr = await fetch(videoUrl);
        const ct = pr.headers.get("content-type") || "";
        const len = Number(pr.headers.get("content-length") || 0);
        if (ct.indexOf("video") < 0 || len < 5000) videoUrl = null;
      } catch (e) { videoUrl = null; }
    }
    if (!buf && !videoUrl) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Video generation failed (Shotstack API error or no credits)."); return; }
    const caption = "🎬 <b>" + htmlEscape(prompt.slice(0, 200)) + "</b>\n<i>Rendered by the Ari AI engine</i>\n🔗 Get the app: https://aaa-store.aaateam.workers.dev/store";
    const cacheKey = "temp/last_reel.mp4";
    // If we only have a URL, download it to a buffer so caching/YouTube/Telegram
    // all use a verified video (and we avoid caching an HTML error page).
    let safeUrl = videoUrl;
    if (safeUrl && !buf) {
      try { const dv = await fetch(safeUrl); if (dv.ok) buf = await dv.arrayBuffer(); } catch (e) { buf = null; }
    }
    try {
      if (ENV.aaa_assets && buf) {
        await ENV.aaa_assets.put(cacheKey, buf, { httpMetadata: { contentType: "video/mp4" } });
      } else if (ENV.aaa_assets && safeUrl) {
        const r = await fetch(safeUrl);
        await ENV.aaa_assets.put(cacheKey, r.body, { httpMetadata: { contentType: "video/mp4" } });
      }
    } catch (e) {}
    const ytRefresh = ENV.AAA_KV ? await ENV.AAA_KV.get("yt_owner_refresh") : "";
    // Unique, human-sounding title per run so uploads never look like the same
    // robot video. (Random hook + prompt + timestamp.)
    const hooks = ["Watch this", "New drop", "AI made this", "Quick demo", "Fresh from Ari", "You'll love this", "AI magic", "Made in seconds"];
    const hook = hooks[Math.floor(Math.random() * hooks.length)];
    const uniqTitle = "#Shorts — " + hook + ": " + prompt.slice(0, 42).charAt(0).toUpperCase() + prompt.slice(1, 43);
    if (ytRefresh) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "📺 Uploading to YouTube…");
      try {
        const yt = await uploadVideoToYouTube(safeUrl || buf, uniqTitle, "Made with Super AI (Ari AI engine). Get the app: https://aaa-store.aaateam.workers.dev/store\n\n#Shorts #AI #SuperAI #AriAI", ENV);
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, yt ? "✅ Uploaded to YouTube as a Short." : "⚠️ YouTube upload failed (reconnect with /ytconnect).");
        if (yt) { try { await adminChannelNotify(ENV, "Short Uploaded to YouTube", { Prompt: prompt.slice(0, 80), Type: "Short" }); } catch (_) {} }
      } catch (e) {
        await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ YouTube upload error: " + htmlEscape(String((e && e.message) || e).slice(0, 150)));
      }
    } else {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "ℹ️ YouTube not connected. Tap 🔑 / connect via /ytconnect to auto-upload videos.");
    }
    // Clean up the cached Cloudflare R2 copy so old videos don't pile up.
    try { if (ENV.aaa_assets) await ENV.aaa_assets.delete(cacheKey); } catch (e) {}
    try {
      const payload = safeUrl
        ? { chat_id: chatId, video: safeUrl, caption: caption, parse_mode: "HTML" }
        : { chat_id: chatId, video: "data:video/mp4;base64," + Buffer.from(buf).toString("base64"), caption: caption, parse_mode: "HTML" };
      const up = await tgApi(ENV.ADMIN_BOT_TOKEN, "sendVideo", payload);
      if (!up || !up.ok) await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Video rendered but Telegram admin upload failed (size limit).");
    } catch (e) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Admin chat upload error."); }
    try {
      const chOk = safeUrl
        ? await postMediaToChannelUrl(ENV, "video", safeUrl, caption)
        : await postMediaToChannel(ENV, "video", Buffer.from(buf).toString("base64"), caption);
      if (chOk) await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ Also posted to channel.");
    } catch (e) {}
    try { await recordLearning(ENV, "video", { prompt: prompt, provider: srcName, vertical: vertical, ok: true }); } catch (_) {}
    return;
  }

  // ---- Teach the AI: feed it knowledge/examples it should remember & reuse ----
  if (cmd === "/teach") {
    const body = args.slice(1).join(" ").trim();
    if (!body) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "📚 <b>Teach the AI</b>\nUsage: <code>/teach &lt;topic&gt; | &lt;how to do it / best practice&gt;</code>\nExample: <code>/teach neon promo video | use Shotstack with 2 AI images + zoomIn, then upload to YouTube</code>");
      return;
    }
    const parts = body.split("|");
    const topic = (parts[0] || "").trim();
    const how = (parts[1] || "").trim();
    try {
      await recordLearning(ENV, "teach", { topic: topic, how: how, by: String(chatId) });
      const stats = await getProviderStats(ENV);
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
        "🧠 <b>Learned.</b>\n📌 Topic: <b>" + htmlEscape(topic || "(general)") + "</b>\n💡 " + htmlEscape(how || "(no detail)") +
        "\n📈 I now hold <b>" + (JSON.parse((await ENV.AAA_KV.get("learn_index")) || "[]").length) + "</b> memories and will apply this to improve my own outputs and suggest fixes for sibling systems.");
      // Mirror the learning to the admin channel too.
      try { await adminChannelNotify(ENV, "AI Taught", { Topic: topic, How: how }); } catch (_) {}
    } catch (e) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Could not save learning: " + htmlEscape(String((e && e.message) || e).slice(0,120)));
    }
    return;
  }

  // ---- Show the AI's learning memory + provider stats (self-improvement view) ----
  if (cmd === "/learnings") {
    const type = args[1] || "";
    const items = await getLearnings(ENV, type || null, 15);
    const stats = await getProviderStats(ENV);
    let out = "🧠 <b>AI Learning Memory</b>\n";
    out += "📊 Provider success (ok/fail):\n";
    const keys = Object.keys(stats);
    out += keys.length ? keys.map((k) => "• " + k + ": ✅" + stats[k].ok + " / ❌" + stats[k].fail).join("\n") : "• (no data yet — generate something!)";
    out += "\n\n📚 Recent memories:\n";
    out += items.length ? items.map(function (e) {
      const tag = e.type === "teach" ? "📌" : e.type === "video" ? "🎬" : e.type === "image" ? "🎨" : "•";
      const main = e.topic ? ("<b>" + htmlEscape(e.topic) + "</b> → " + htmlEscape((e.how || "").slice(0, 80)))
        : (e.prompt ? htmlEscape(e.prompt.slice(0, 60)) : e.type);
      return tag + " " + main + (e.ok === false ? " ❌" : "");
    }).join("\n") : "• (empty)";
    const kbLen = (ENV.AAA_KV ? await ENV.AAA_KV.get("kb_corpus") : "") || "";
    out += "\n\n📖 Knowledge base: " + (kbLen ? kbLen.length + " chars loaded" : "⚠️ not loaded (run deploy.sh)");
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, out);
    return;
  }

  // ---- Queue a channel post for later (self-running automation) ----
  // Usage: /schedule <minutes> <message>   e.g. /schedule 30 Drop a new AI tip soon!
  if (cmd === "/schedule") {
    const mins = parseInt(args[1], 10);
    const msg = args.slice(2).join(" ").trim();
    if (!mins || mins < 1 || !msg) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "Usage: /schedule &lt;minutes&gt; &lt;message&gt;\nExample: <code>/schedule 30 Drop a new AI tip in the channel!</code>");
      return;
    }
    try {
      const list = JSON.parse((await ENV.AAA_KV.get("scheduled_posts")) || "[]");
      list.push({ at: Date.now() + mins * 60000, msg: msg, by: String(chatId) });
      await ENV.AAA_KV.put("scheduled_posts", JSON.stringify(list), { expirationTtl: 60 * 60 * 24 * 7 });
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⏰ Scheduled in " + mins + " min:\n" + htmlEscape(msg));
    } catch (e) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Could not schedule: " + htmlEscape(String((e && e.message) || e).slice(0, 100)));
    }
    return;
  }

  // ---- Live dashboard snapshot ----
  if (cmd === "/dashboard") {
    const stats = await gatherStats(ENV);
    const warns = await lowCreditWarnings(ENV);
    const kb = (ENV.AAA_KV ? (await ENV.AAA_KV.get("kb_corpus")) : "") || "";
    let out = "📡 <b>Live Dashboard</b>\n";
    out += "👥 Users: " + (stats.users || "?") + "\n";
    out += "⬇️ Downloads: " + (stats.downloads || "?") + "\n";
    out += "💬 Channel: " + (ENV.CHANNEL_ID && ENV.CHANNEL_ID !== "REPLACE_WITH_CHANNEL_ID" ? "✅" : "❌") + "\n";
    out += "🎬 YouTube: " + ((ENV.AAA_KV && await ENV.AAA_KV.get("yt_owner_refresh")) ? "✅ connected" : "❌ not connected") + "\n";
    out += "🧠 Knowledge base: " + (kb ? kb.length + " chars" : "⚠️ missing") + "\n";
    if (warns && warns.length) out += "\n🔔 <b>Warnings:</b>\n" + warns.join("\n");
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, out);
    return;
  }

  // ---- Admin AI: auto-generate a vertical YouTube Short (→ admin chat + channel + YouTube) ----
  // All videos are Shorts now: /video, /vid and /reel all render a 9:16 short.
  if (cmd === "/video" || cmd === "/vid" || cmd === "/reel") {
    await doVideo(ENV, chatId, args.slice(1).join(" ").trim(), { vertical: true });
    return;
  }

  // ---- Full Cloudflare configuration (all secret + resource types) ----
  if (cmd === "/config") {
    const ownerChat = (ENV.ADMIN_CHAT_ID && ENV.ADMIN_CHAT_ID !== "REPLACE_WITH_ADMIN_CHAT_ID") ? String(ENV.ADMIN_CHAT_ID) : null;
    const isOwner = ownerChat && String(chatId) === ownerChat;
    const secretNames = [
      "ADMIN_BOT_TOKEN", "ADMIN_CHAT_ID", "APP_SHARED_SECRET", "CHANNEL_ID", "FELIX_BASE",
      "FREE_AI_BOT_TOKEN", "GEMINI_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
      "GROQ_KEY", "HF_KEY", "JSON2VIDEO_KEY", "KIE_API_KEY", "KIE_HMAC_KEY",
      "LOGIN_BOT_TOKEN", "PUBLIC_ORIGIN", "SUPABASE_ANON", "SUPABASE_SERVICE_ROLE",
      "SUPABASE_URL", "YT_UPLOAD_SECRET", "TG_API_ID", "TG_API_HASH", "FIREBASE_WEB_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_DB_URL", "FIREBASE_STORAGE_BUCKET", "FIREBASE_SERVICE_ACCOUNT",
    ];
    const mask = (v) => {
      if (v == null || v === "") return "∅ (unset)";
      const s = String(v);
      if (s.length <= 8) return s[0] + "••••" + s.slice(-1);
      return s.slice(0, 4) + "…" + s.slice(-4) + " (" + s.length + ")";
    };
    let out = "⚙️ <b>Full Cloudflare Configuration</b>\n\n";
    out += "👤 <b>Account</b>\n<code>0990a77a6f54b26e433668dc215320fb</code>\n\n";
    out += "⚙️ <b>Workers</b>\n• aaa-ai-bot → https://aaa-ai-bot.aaateam.workers.dev\n• aaa-store → https://aaa-store.aaateam.workers.dev\n• compat: nodejs_compat · cron: 0 3 * * *\n\n";
    out += "🗄 <b>KV</b> AAA_KV → <code>631dab0fc15e41a08abf896ae55af5a5</code>\n";
    out += "🛢 <b>D1</b> aaa_db → <code>b5be290f-6416-44ac-af92-07e76b7d33ed</code>\n";
    out += "📦 <b>R2</b> aaa-assets\n\n";
    out += "🔐 <b>Secrets</b>" + (isOwner ? " (full)" : " (masked)") + "\n";
    for (const n of secretNames) {
      const val = ENV[n];
      const disp = (isOwner && val != null && val !== "") ? String(val) : mask(val);
      out += "• " + n + " = <code>" + htmlEscape(disp) + "</code>\n";
    }
    if (!isOwner) out += "\n<i>Send from the owner chat to see full values.</i>";
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, out);
    return;
  }

  // ---- Firebase project info ----
  if (cmd === "/firebase") {
    const pid = ENV.FIREBASE_PROJECT_ID || "aaa-infinity-ai";
    const db = ENV.FIREBASE_DB_URL || "https://aaa-infinity-ai-default-rtdb.asia-southeast1.firebasedatabase.app";
    const bucket = ENV.FIREBASE_STORAGE_BUCKET || "aaa-infinity-ai.firebasestorage.app";
    const ch = ENV.CHANNEL_ID || "(unset)";
    let out = "🔥 <b>Firebase Project</b>\n\n" +
      "🆔 Project: <code>" + htmlEscape(pid) + "</code>\n" +
      "📊 Realtime DB: <code>" + htmlEscape(db) + "</code>\n" +
      "🪣 Storage: <code>" + htmlEscape(bucket) + "</code>\n" +
      "📦 App package: <code>com.aaa.ai</code>\n" +
      "📣 Channel: <code>" + htmlEscape(ch) + "</code> (AAA FREE AI)\n\n" +
      "Web API key is set (see /secrets as FIREBASE_WEB_API_KEY).\n" +
      "Crashlytics reports are captured in-app → /crashlog.";
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, out);
    return;
  }

  // ---- Channel info / test post ----
  if (cmd === "/channel") {
    const ch = ENV.CHANNEL_ID;
    if (!ch || ch === "REPLACE_WITH_CHANNEL_ID") { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ CHANNEL_ID not set."); return; }
    if (args[1]) {
      // post the rest as a message to the channel
      const text = args.slice(1).join(" ");
      const ok = await postToChannelText(ENV, htmlEscape(text));
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, ok ? "✅ Posted to channel." : "⚠️ Failed (is the bot an admin of the channel?)");
    } else {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "📣 Channel: <code>" + htmlEscape(ch) + "</code> (AAA FREE AI)\nUse /channel &lt;message&gt; to post a test message.");
    }
    return;
  }

  // ---- Real Crashlytics issues (Firebase Admin) ----
  if (cmd === "/crashlytics") {
    if (!ENV.FIREBASE_SERVICE_ACCOUNT) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ No Firebase service account set."); return; }
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🔥 Fetching Crashlytics issues…");
    const issues = await crashlyticsIssues(ENV, 10);
    if (issues === null) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Could not read Crashlytics (token/missing)."); return; }
    if (issues.error) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ " + htmlEscape(issues.error)); return; }
    if (!issues.length) { await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "✅ No Crashlytics issues. App is stable!"); return; }
    for (const i of issues.slice(0, 10)) {
      const title = (i.issueId || i.title || "crash");
      const sub = i.subtitle || "";
      const users = i.latestAppActiveUsersCount || 0;
      const txt = "🔥 <b>" + htmlEscape(title) + "</b>\n" +
        (sub ? htmlEscape(sub) + "\n" : "") +
        "👥 " + users + " users affected\n" +
        "📱 " + htmlEscape((i.deviceModel || i.androidVersion || "?")) + "\n" +
        (i.crashlyticsLink ? "🔗 " + htmlEscape(i.crashlyticsLink) + "\n" : "");
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, txt);
    }
    return;
  }

  // Casual greetings / small talk → just open the menu instead of running a
  // command or dumping stats. Keeps the console friendly.
  if (/^(hi|hii+|hey+|hello|yo|hola|hii|start|menu|sup|good\s*(morning|evening|afternoon)|salam|assalamualaikum)\b[!. ]*$/i.test(text)) {
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "👋 <b>Hey! I'm your Super AI admin console.</b>\nTap a tile below, or just tell me what you want (e.g. \"make a short about our new AI feature\").");
    await sendAdminMenu(chatId);
    return;
  }

  // Plain-text (no slash command): let the AI decide whether to RUN an action
  // or answer as a chat assistant. This is the "fewer commands, more AI"
  // design — the owner just talks to the bot.
  await tgAction(ENV.ADMIN_BOT_TOKEN, chatId);
  let handled = false;
  try {
    const intent = await classifyIntent(text);
    if (intent.action !== "chat") {
      handled = await runAdminAction(chatId, intent, msg.from);
    }
  } catch (e) { handled = false; }
  if (!handled) {
    // Proactive ops agent: the AI may either answer in plain text OR issue
    // structured directives to run one or more commands itself. This lets the
    // bot "do everything" from a single natural-language message.
    let ctx = "";
    try {
      const stats = await gatherStats(ENV);
      ctx = statsBlock(stats) + "\n\nPROVIDER HEALTH:\n" + (await providerHealthLine(ENV));
    } catch (e) {}
    const ans = await adminAi(
      "You are the Super AI admin assistant. The owner just said: \"" + text + "\"\n" +
      "Decide the most helpful action.\n" +
      "• If you can fully handle it yourself, reply with plain helpful text (HTML allowed, no markdown).\n" +
      "• If a concrete admin command should run, reply with ONLY JSON: {\"run\":[\"command\",\"another\"],\"args\":{\"command\":\"arg text\"}} where command is one of: " +
      ADMIN_ACTIONS.join(", ") + ". Use 'broadcast'/'channel' with the message as arg, 'credits' with 'uid amount', 'setkey' with 'provider value'.\n" +
      "• You may combine: send a short text answer AND run commands.\n" +
      "When in doubt, give a useful answer using the context below and suggest the exact command to run.\n\nCONTEXT:\n" + ctx,
      "");
    // Try to parse a directive from the AI reply.
    const dirMatch = ans.match(/\{[\s\S]*"run"[\s\S]*\}/);
    let ran = false;
    if (dirMatch) {
      try {
        const d = JSON.parse(dirMatch[0]);
        const runs = Array.isArray(d.run) ? d.run : [d.run];
        for (const c of runs) {
          if (ADMIN_ACTIONS.indexOf(c) >= 0) {
            const a = (d.args && d.args[c]) || "";
            await runAdminAction(chatId, { action: c, arg: String(a) }, msg.from);
            ran = true;
          }
        }
      } catch (e) {}
    }
    // Always show the AI's prose (strip any JSON directive we acted on).
    let prose = ans;
    if (dirMatch) prose = ans.replace(dirMatch[0], "").trim();
    if (prose) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId,
        "🤖 " + htmlEscape(prose) + (ran ? "" : "\n\n<i>Say it like a command and I'll run it — e.g. \"post to channel: …\", \"broadcast: …\", \"show stats\".</i>"));
    } else if (!ran) {
      await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "🤖 " + htmlEscape(ans));
    }
  }
  } catch (err) {
    console.error("handleAdmin command error: " + (err && err.stack || err));
    await tgSend(ENV.ADMIN_BOT_TOKEN, chatId, "⚠️ Command failed: <code>" + htmlEscape(String((err && err.message) || err).slice(0, 200)) + "</code>").catch(function () {});
  }
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

/** Ensure a D1 wallet row exists for a uid (returns current points). */
async function ensureWalletD1(env, uid) {
  if (!env.AAA_DB) return null;
  const now = Date.now();
  await env.AAA_DB.prepare(
    "INSERT OR IGNORE INTO users(uid, points, lifetime_earned, created_at) VALUES (?, 100, 0, ?)"
  ).bind(uid, now).run();
  const row = await env.AAA_DB.prepare("SELECT points FROM users WHERE uid = ?").bind(uid).first();
  return row ? (row.points || 0) : 0;
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
/** Keep the free Supabase project from auto-pausing. A read alone is sometimes
 *  ignored by Supabase's idle detector, so we also write a tiny heartbeat row. */
async function supabaseKeepAlive(env) {
  const base = env.SUPABASE_URL || "";
  const key = env.SUPABASE_SERVICE_ROLE || "";
  if (!base || !key) return false;
  try {
    const res = await fetch(base + "/rest/v1/users?select=uid&limit=1", {
      headers: { apikey: key, Authorization: "Bearer " + key },
    });
    if (!res.ok) return false;
    // Write a heartbeat so the project counts as "active" (prevents pause).
    await fetch(base + "/rest/v1/heartbeat", {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: "keepalive", ts: Date.now() }),
    }).catch(function () {});
    return true;
  } catch (e) { return false; }
}

/** Create the mirror tables if missing (idempotent). Uses the Supabase
 *  Management API SQL endpoint when an access token is available; the
 *  service-role REST RPC path is kept as a fallback. */
async function supabaseProvision(env) {
  const base = env.SUPABASE_URL || "";
  const key = env.SUPABASE_SERVICE_ROLE || "";
  if (!base || !key) return false;
  const ref = (env.SUPABASE_PROJECT_ID || (base.split("//")[1] || "").split(".")[0] || "").trim();
  const sql = [
    "CREATE TABLE IF NOT EXISTS users (uid text PRIMARY KEY, email text, display_name text, points integer DEFAULT 0, lifetime_earned integer DEFAULT 0, premium_until integer DEFAULT 0, created_at bigint);",
    "CREATE TABLE IF NOT EXISTS transactions (id bigserial PRIMARY KEY, uid text, type text, amount integer, reason text, ts bigint);",
    "CREATE TABLE IF NOT EXISTS promo_codes (code text PRIMARY KEY, reward integer, created_at bigint);",
    "CREATE TABLE IF NOT EXISTS promo_redemptions (code text, uid text, ts bigint, PRIMARY KEY (code, uid));",
    "CREATE TABLE IF NOT EXISTS yt_subs (uid text PRIMARY KEY, subscribed boolean, checked_at bigint);",
    "CREATE TABLE IF NOT EXISTS heartbeat (id text PRIMARY KEY, ts bigint);",
    "CREATE TABLE IF NOT EXISTS heartbeat (id text PRIMARY KEY, ts bigint);",
  ].join("\n");
  // Preferred: Management API (can run DDL).
  if (env.SUPABASE_ACCESS_TOKEN && ref) {
    try {
      const res = await fetch("https://api.supabase.com/v1/projects/" + ref + "/database/query", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + env.SUPABASE_ACCESS_TOKEN },
        body: JSON.stringify({ query: sql }),
      });
      if (res.ok) return true;
    } catch (e) {}
  }
  // Fallback: try the legacy RPC (may not exist — ignored on failure).
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
    "limited promo: first 30 users get 7 days of Ari AI PREMIUM free. Tell them to open the Ari AI " +
    "app and redeem the code in Profile. Do NOT write the code itself — it is shown on the video. " +
    "Output only the post text.", "");
  const post = (msg && msg.length > 5 ? htmlEscape(msg) : ("🎁 Limited drop! First 30 users get 7 days PREMIUM free. Open the Ari AI app to redeem.")) +
    "\n\n👥 First " + promo.maxRedemptions + " users only!\n🔗 Get the app: https://aaa-store.aaateam.workers.dev/store";
  // Generate a vertical 9:16 promo SHORT via the Shotstack image pipeline
  // (reliable, free) and post it to Telegram + YouTube as a Short.
  let videoBuf = null;
  try {
    const res = await generateVideoShotstack(promo.code + " 7 days premium free — Ari AI", env, false, true, "promo", promo.code);
    videoBuf = res && res.buf ? res.buf : (res || null);
  } catch (e) {}
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
    // Upload the Short directly to YouTube. The code is shown ON the video (overlay),
    // so we keep it out of the description text per request.
    toYtVideo = await uploadVideoToYouTube(videoBuf,
      "#Shorts — Ari AI Promo 7 Days Premium Free",
      "Limited promo! First 30 users get 7 days of Ari AI Premium FREE. The code is shown on the video — open the Ari AI app and redeem it in Profile.\n\nGet the app: https://aaa-store.aaateam.workers.dev/store\n\n#Shorts #AI #SuperAI #AriAI",
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
  // Self-improving topic selection: prefer topics that previously scored well,
  // and let the ops AI use the open-source knowledge base for sharper copy.
  const topics = [
    "a short, punchy AI tip a beginner would love",
    "a clever ChatGPT / Gemini prompt idea people can try today",
    "a little-known free AI tool or trick",
    "a one-line productivity hack using AI chat",
    "a fun creative use of AI image generation",
    "a myth about AI debunked in a friendly way",
  ];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const kb = await kbContext(env, topic + " social media post AI app");
  const msg = await adminAi(
    "Write a friendly, upbeat Telegram channel post (2-3 sentences, 1-3 emojis) about " +
    topic + " for our Ari AI app community. Mention Ari AI naturally. Output only the post text." +
    (kb ? "\n\nReference style ideas:\n" + kb : ""), "");
  const cleanMsg = (msg && msg.length > 5) ? msg : "✨ New AI trick just dropped — open Ari AI and try it now!";
  const post = htmlEscape(cleanMsg) + "\n\n📲 Get the app: https://aaa-store.aaateam.workers.dev/store";

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

  // 2) Render a short promo video (Shotstack image-based pipeline) and post it,
  //    then upload it to YouTube as a NEW video if the owner connected YouTube.
  let toYtVideo = false;
  try {
    const res = await generateVideoShotstack(cleanMsg, env, false, true);
    const vbuf = res && res.buf ? res.buf : (res || null);
    const vurl = res && res.url ? res.url : null;
    if (vbuf) {
      const form = new FormData();
      form.append("chat_id", String(env.CHANNEL_ID || DEFAULT_CHANNEL_ID));
      form.append("caption", post);
      form.append("video", new Blob([vbuf], { type: "video/mp4" }), "aaa_tip.mp4");
      const r = await fetch(TELEGRAM_API + (env.FREE_AI_BOT_TOKEN) + "/sendVideo", { method: "POST", body: form });
      const j = await r.json().catch(function () { return {}; });
      toYtVideo = !!j.ok;
      // Upload to YouTube as a new video (stream the source URL when available).
      try { await uploadVideoToYouTube(vurl || vbuf, "#Shorts — Super AI: " + cleanMsg.slice(0, 50), "Made with Super AI (Ari AI engine). Get the app: https://aaa-store.aaateam.workers.dev/store\n\n#Shorts #AI #SuperAI #AriAI", env); } catch (_) {}
    }
  } catch (e) {}

  // 3) Keep the channel's latest YouTube video description in sync.
  const toYt = await postToYouTube(post, env);
  // Teach the AI from this automated run (self-improving loop).
  try { await recordLearning(env, "autopost", { topic: topic, toChannel: toChannel, toYtVideo: toYtVideo, ok: toChannel || toYtVideo }); } catch (_) {}
  // Notify the private admin channel (AAA AI APP ADMIN).
  try {
    await adminChannelNotify(env, "Auto-Post", {
      Topic: topic,
      Channel: toChannel ? "✅" : "❌",
      YouTubeVideo: toYtVideo ? "✅" : "❌",
    });
  } catch (_) {}
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
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      return new Response("ERR: " + (e && e.message ? e.message : String(e)), {
        status: 500, headers: { "content-type": "text/plain" },
      });
    }
  },
};

async function handle(request, env, ctx) {
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
      // Drop any previously stored token so re-connection always yields a FRESH
      // refresh token (Google only returns one when the old grant is cleared).
      if (mode === "owner" && env.AAA_KV) { try { await env.AAA_KV.delete("yt_owner_refresh"); } catch (e) {} }
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
    // TEMP: debug video render failure (writes result to KV, returns fast).
    if (request.method === "GET" && url.pathname === "/api/vidtest") {
      (async () => {
        let out = {};
        try {
          const r = await generateVideoShotstack("test ad video", env, false, true, "ad");
          out = { result: r ? { hasBuf: !!r.buf, url: r && r.url ? r.url.slice(0, 60) : null, voiceErr: r && r.voiceErr, error: r && r.error } : "undefined" };
        } catch (e) { out = { threw: String((e && e.message) || e).slice(0, 300), stack: String((e && e.stack) || "").slice(0, 400) }; }
        try { await env.AAA_KV.put("vidtest_out", JSON.stringify(out)); } catch (e) {}
      })();
      return new Response("started", { headers: { "content-type": "text/plain" } });
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
    // Firebase -> Supabase + D1 mirror sync. App calls this after Firebase login
    // with the Firebase ID token. Connects all three backends behind the gateway.
    if (request.method === "POST" && url.pathname === "/api/firebase-sync") {
      const body = await request.json().catch(function () { return {}; });
      const res = await mirrorFirebaseUser(ENV, body.idToken);
      return json(res, res.ok ? 200 : 401);
    }
    // Telegram USER-account session backup. The Android app logs in via TDLib
    // (phone+code+2FA) and uploads the exported session (the on-disk tdlib dir,
    // zipped+base64). The Worker stores it encrypted-at-rest in KV as a backup;
    // it does NOT act as the user (Cloudflare Workers cannot run TDLib).
    if (request.method === "POST" && url.pathname === "/api/tg-session") {
      const denied = requireSecret(request, ENV);
      if (denied) return denied;
      const body = await request.json().catch(function () { return {}; });
      const session = body.session || "";
      if (!session) return json({ ok: false, error: "missing session" }, 400);
      await env.AAA_KV.put("tg_user_session", session, { expirationTtl: 60 * 60 * 24 * 90 });
      await env.AAA_KV.put("tg_user_session_version", String(body.version || 1));
      return json({ ok: true, bytes: session.length });
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
    if (request.method === "POST" && url.pathname === "/api/admin/yt-upload") {
      const secret = request.headers.get("x-yt-secret");
      if (secret !== (ENV.YT_UPLOAD_SECRET || "")) return json({ ok: false, error: "unauthorized" }, 401);
      const body = await request.json().catch(function () { return {}; });
      const title = body.title || "Super AI — Free AI Super App";
      const description = body.description || "Super AI: one free app for chat, images, video, code and more (powered by the Ari AI engine). Get it free on the AAA App Store:\nhttps://aaa-store.aaateam.workers.dev/store";
      let videoBuf = null;
      if (body.key) {
        const obj = ENV.aaa_assets ? await ENV.aaa_assets.get(body.key) : null;
        if (!obj) return json({ ok: false, error: "video not found at " + body.key }, 404);
        videoBuf = await obj.arrayBuffer();
      } else if (body.b64) {
        const bin = atob(body.b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        videoBuf = arr.buffer;
      }
      if (!videoBuf) return json({ ok: false, error: "missing video" }, 400);
      const ok = await uploadVideoToYouTube(videoBuf, title, description, ENV);
      return json({ ok: ok });
    }
    if (request.method === "POST" && url.pathname === "/api/crashlog") {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const ts = Date.now();
      const rec = {
        ts: ts,
        device: body.device || {},
        message: body.message || "",
        stack: body.stack || "",
        thread: body.thread || "main"
      };
      await ENV.AAA_KV.put("crashlog:" + ts, JSON.stringify(rec), { expirationTtl: 14 * 24 * 3600 }).catch(function () {});
      // Keep a short index of latest crash timestamps (max 50).
      let idx = [];
      try { idx = JSON.parse(await ENV.AAA_KV.get("crashlog:index") || "[]"); } catch (e) {}
      idx.unshift(ts);
      idx = idx.slice(0, 50);
      await ENV.AAA_KV.put("crashlog:index", JSON.stringify(idx)).catch(function () {});
      return json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/api/vidstatus") {
      const last = ENV.AAA_KV ? await ENV.AAA_KV.get("vid_last") : "";
      const full = ENV.AAA_KV ? await ENV.AAA_KV.get("vid_fullerr") : "";
      return json({ last: last || "(none)", fullErr: full || "(none)" }, 200);
    }
    if (request.method === "GET" && url.pathname === "/api/crashlog") {
      const denied = requireSecret(request, ENV);
      if (denied) return denied;
      let idx = [];
      try { idx = JSON.parse(await ENV.AAA_KV.get("crashlog:index") || "[]"); } catch (e) {}
      const recs = [];
      for (const ts of idx.slice(0, 20)) {
        const r = await ENV.AAA_KV.get("crashlog:" + ts);
        if (r) recs.push(JSON.parse(r));
      }
      return json({ ok: true, crashes: recs });
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
      // Await fully within the request (Telegram allows ~60s, and the first
      // render succeeded this way). Long renders post their status to KV via the
      // "vid_last" checkpoint and /vidstatus for inspection.
      try { await handleAdmin(update); } catch (e) { console.error("admin webhook error: " + (e && e.stack || e)); }
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
    if (request.method === "GET" && url.pathname === "/api/health") {
      const checks = {
        kv: !!ENV.AAA_KV,
        db: !!ENV.AAA_DB,
        r2: !!ENV.aaa_assets,
        adminBot: !!ENV.ADMIN_BOT_TOKEN,
      };
      const okAll = Object.values(checks).every(Boolean);
      return json({ ok: okAll, ts: Date.now(), checks: checks, version: ((await ENV.AAA_KV.get("app_version_name")) || "?") });
    }
    if (request.method === "GET" && url.pathname === "/api/app-version") {
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
      // Serve the APK from the GitHub Release (authoritative, always the latest
      // build) via a 302 redirect. This avoids any stale R2 object/cache and
      // guarantees users get the correct universal APK.
      const releaseUrl = "https://github.com/aaa-infinity/AAA-AI/releases/download/v2.2.14/app-release.apk";
      // Increment a live download counter (best-effort, never block).
      env.AAA_KV?.put("app_downloads", String((parseInt(await env.AAA_KV?.get("app_downloads") || "0", 10) || 0) + 1), { expirationTtl: 60 * 24 * 3600 }).catch(function () {});
      return Response.redirect(releaseUrl, 302);
    }
    // Download landing page.
    if (request.method === "GET" && (url.pathname === "/download" || url.pathname === "/")) {
      const releaseUrl = "https://github.com/aaa-infinity/AAA-AI/releases/download/v2.2.14/app-release.apk";
      let available = true, sizeLabel = "";
      const ver = (await ENV.AAA_KV.get("app_version_name")) || "";
      const chLog = (await ENV.AAA_KV.get("app_changelog")) || "";
      try {
        const headRes = await fetch(releaseUrl, { method: "HEAD", redirect: "follow" });
        available = headRes.ok || headRes.status === 302;
        const len = headRes.headers.get("content-length") || headRes.headers.get("x-github-content-length");
        if (len) {
          const mb = parseInt(len, 10) / (1024 * 1024);
          sizeLabel = (mb >= 100 ? Math.round(mb) : mb.toFixed(1)) + " MB";
        }
      } catch (e) { available = true; }
      const versionName = ver;
      const changelog = chLog;
      let stats;
      const cached = await ENV.AAA_KV.get("live_stats");
      if (cached) { try { stats = JSON.parse(cached); } catch (e) {} }
      if (!stats) stats = await gatherStats(env);
      const dlCount = parseInt(await ENV.AAA_KV.get("app_downloads") || "0", 10) || 0;
      stats = Object.assign({}, stats, { downloads: dlCount });
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
      const kb = await kbContext(env, "daily operations report AI app growth");
      const report = await adminAi(
        "Write today's brief daily report: 2-3 sentences on how the service is doing " +
        "based on the metrics, then one actionable suggestion.",
        statsBlock(stats) + "\n\nPROVIDER HEALTH:\n" + (await providerHealthLine(env)) + (kb ? "\n\nREFERENCE:\n" + kb : ""));
      await tgSend(env.ADMIN_BOT_TOKEN, adminId,
        "🌅 <b>Daily Report</b>\n" + htmlEscape(report) +
        "\n\n<code>" + htmlEscape(statsBlock(stats)) + "</code>");
      // Proactively warn the owner if any paid provider is low / unreachable,
      // so a fresh key can be swapped before generation breaks.
      try {
        const warns = await lowCreditWarnings(env);
        if (warns && warns.length) {
          await tgSend(env.ADMIN_BOT_TOKEN, adminId,
            "🔔 <b>Provider attention needed</b>:\n" + warns.join("\n") +
            "\nSwap a key: tap 🔑 API Key, or say \"set <provider> key to …\".");
          // Mirror warnings to the private admin channel.
          try { await adminChannelNotify(env, "Provider Warning", { Warnings: warns.join("; ") }); } catch (_) {}
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
  // Respects the /autopost on|off toggle (default: enabled).
  try {
    const autoOn = (env.AAA_KV ? await env.AAA_KV.get("autopost_enabled") : null) || "1";
    const last = parseInt((await env.AAA_KV.get("autopost_last_run")) || "0", 10) || 0;
    const twoDays = 2 * 24 * 3600 * 1000;
    // Random trigger: every ~2 days OR a 35% daily dice roll.
    if (autoOn === "1" && (Date.now() - last >= twoDays || Math.random() < 0.35)) {
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

