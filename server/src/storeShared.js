// Shared store module for the AAA App Store.
// Imported by BOTH workers (aaa-ai-bot + aaa-store) so they share the same
// D1 (store_users / store_apps) + R2 (apk/icons) + KV (sessions/queue).
//
// The public site UI is implemented in ./store-ui.js (a fresh design system);
// the page builders below delegate to it. This file keeps the D1/KV helpers.

import * as UI from "./store-ui.js";

const STORE_APK_PREFIX = "store/apks/";
const STORE_ICON_PREFIX = "store/icons/";
const STORE_PENDING_KEY = "store_pending"; // KV JSON array of app ids awaiting approval
const SESSION_PREFIX = "sess:";
const UPLOAD_RATE_PREFIX = "store_up:"; // per-user upload rate limit

export const STORE_CATEGORIES = [
  "Game", "Tools", "Social", "Productivity", "Entertainment",
  "Education", "Finance", "Other",
];

// ---------------------------------------------------------------------------
// D1 helpers
// ---------------------------------------------------------------------------
export async function dbGetUser(env, uid) {
  if (!env.AAA_DB) return null;
  return await env.AAA_DB.prepare("SELECT * FROM store_users WHERE uid = ?")
    .bind(uid).first();
}

export async function dbUpsertUser(env, profile) {
  if (!env.AAA_DB) return null;
  const uid = String(profile.uid || profile.id);
  const first = profile.first_name || profile.firstName || "";
  const last = profile.last_name || profile.lastName || "";
  const disp = profile.display_name || [first, last].filter(Boolean).join(" ") || "";
  const phone = profile.phone || "";
  const lang = profile.language_code || profile.languageCode || "";
  const premium = profile.is_premium || profile.isPremium ? 1 : 0;
  // The Telegram id: an explicit telegram_id, or — for Telegram widget logins —
  // the uid itself. App-only users may have no Telegram id until they link one.
  const tgId = profile.telegram_id != null && profile.telegram_id !== ""
    ? String(profile.telegram_id)
    : (profile.fromTg ? uid : "");
  const existing = await dbGetUser(env, uid);
  if (existing) {
    const nextTg = (tgId || existing.telegram_id || null);
    await env.AAA_DB.prepare(
      "UPDATE store_users SET tg_username=?, display_name=?, photo_url=?, first_name=?, last_name=?, " +
      "is_premium=?, language_code=?, phone=?, telegram_id=?, updated_at=? WHERE uid=?"
    ).bind(profile.username || existing.tg_username, disp || existing.display_name,
      profile.photo_url || existing.photo_url, first || existing.first_name, last || existing.last_name,
      premium, lang || existing.language_code, phone || existing.phone, nextTg, Date.now(), uid).run();
    return existing;
  }
  await env.AAA_DB.prepare(
    "INSERT INTO store_users (uid, tg_username, display_name, photo_url, first_name, last_name, " +
    "is_premium, language_code, phone, telegram_id, is_admin, apps_count, created_at, updated_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)"
  ).bind(uid, profile.username || "", disp, profile.photo_url || "", first, last,
    premium, lang, phone, tgId || null, profile.is_admin ? 1 : 0, Date.now(), Date.now()).run();
  return dbGetUser(env, uid);
}

export async function dbInsertApp(env, app) {
  if (!env.AAA_DB) return null;
  const id = app.id || ("app_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));
  await env.AAA_DB.prepare(
    "INSERT INTO store_apps (id, owner_uid, name, package_name, version, category, " +
    "short_desc, long_desc, icon_url, apk_url, apk_r2_key, apk_size, min_android, " +
    "status, downloads, submitted_at, approved_at) VALUES " +
    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,0)"
  ).bind(id, app.owner_uid, app.name, app.package_name || null, app.version || null,
    app.category || "Other", app.short_desc || "", app.long_desc || "", app.icon_url || null,
    app.apk_url || null, app.apk_r2_key || null, app.apk_size || null, app.min_android || null,
    app.status || "pending", Date.now()).run();
  return id;
}

export async function dbGetApp(env, id) {
  if (!env.AAA_DB) return null;
  return await env.AAA_DB.prepare("SELECT * FROM store_apps WHERE id = ?").bind(id).first();
}

export async function dbGetAppByPackage(env, pkg) {
  if (!env.AAA_DB || !pkg) return null;
  return await env.AAA_DB.prepare(
    "SELECT * FROM store_apps WHERE package_name = ? AND status = 'approved' ORDER BY approved_at DESC LIMIT 1"
  ).bind(pkg).first();
}

export async function dbUpdateAppStatus(env, id, status, reason) {
  if (!env.AAA_DB) return;
  const approvedAt = status === "approved" ? Date.now() : 0;
  await env.AAA_DB.prepare(
    "UPDATE store_apps SET status=?, reject_reason=?, approved_at=? WHERE id=?"
  ).bind(status, reason || null, approvedAt, id).run();
}

// When a newer version is approved, the OLD version is fully removed
// (DB row + R2 APK + ratings + version history) so only the latest stays live.
export async function dbSupersede(env, oldId, newId) {
  await dbDeleteApp(env, oldId);
}

// Hard-delete an app: removes its R2 APK blob, ratings, version history and row.
export async function dbDeleteApp(env, id) {
  if (!env.AAA_DB) return;
  const old = await dbGetApp(env, id);
  if (!old) return;
  if (old.apk_r2_key && env.aaa_assets) {
    try { await env.aaa_assets.delete(old.apk_r2_key); } catch (e) {}
  }
  try { await env.AAA_DB.prepare("DELETE FROM store_ratings WHERE app_id = ?").bind(id).run(); } catch (e) {}
  try { await env.AAA_DB.prepare("DELETE FROM store_versions WHERE app_id = ?").bind(id).run(); } catch (e) {}
  try { await env.AAA_DB.prepare("DELETE FROM store_apps WHERE id = ?").bind(id).run(); } catch (e) {}
}

export async function dbIncDownloads(env, id) {
  if (!env.AAA_DB) return;
  await env.AAA_DB.prepare("UPDATE store_apps SET downloads = downloads + 1 WHERE id = ?").bind(id).run();
}

// Ratings + reviews.
export async function dbRatingSummary(env, appId) {
  if (!env.AAA_DB) return { avg: 0, count: 0, reviews: [] };
  const s = await env.AAA_DB.prepare(
    "SELECT COALESCE(AVG(stars),0) avg, COUNT(*) c FROM store_ratings WHERE app_id = ?"
  ).bind(appId).first();
  const revs = await env.AAA_DB.prepare(
    "SELECT uid, stars, review, created_at FROM store_ratings WHERE app_id = ? ORDER BY created_at DESC LIMIT 20"
  ).bind(appId).all();
  return {
    avg: Math.round((s?.avg || 0) * 10) / 10,
    count: s?.c || 0,
    reviews: (revs?.results || []),
  };
}

// Version history.
export async function dbAddVersion(env, appId, version, changelog, apkR2Key, size) {
  if (!env.AAA_DB) return;
  await env.AAA_DB.prepare(
    "INSERT INTO store_versions (app_id, version, changelog, apk_r2_key, size, created_at) VALUES (?,?,?,?,?,?)"
  ).bind(appId, version, changelog || null, apkR2Key || null, size || null, Date.now()).run();
}

export async function dbVersionHistory(env, appId) {
  if (!env.AAA_DB) return [];
  const r = await env.AAA_DB.prepare(
    "SELECT version, changelog, size, created_at FROM store_versions WHERE app_id = ? ORDER BY created_at DESC LIMIT 15"
  ).bind(appId).all();
  return (r?.results || []);
}

export async function dbGetRatings(env, appId) {
  if (!env.AAA_DB) return { avg: 0, count: 0, reviews: [] };
  try {
    const agg = await env.AAA_DB.prepare(
      "SELECT COALESCE(AVG(stars),0) avg, COUNT(*) c FROM store_ratings WHERE app_id = ?"
    ).bind(appId).first();
    const rows = await env.AAA_DB.prepare(
      "SELECT uid, stars, review, created_at FROM store_ratings WHERE app_id = ? ORDER BY created_at DESC LIMIT 20"
    ).bind(appId).all();
    return { avg: agg?.avg || 0, count: agg?.c || 0, reviews: (rows && rows.results) || [] };
  } catch (e) { return { avg: 0, count: 0, reviews: [] }; }
}

export async function dbAddRating(env, appId, uid, stars, review) {
  if (!env.AAA_DB) return false;
  try {
    await dbEnsureStoreSchema(env);
    await env.AAA_DB.prepare(
      "INSERT INTO store_ratings (app_id, uid, stars, review, created_at) VALUES (?,?,?,?,?)"
    ).bind(appId, uid, stars || 5, (review || "").slice(0, 1000), Date.now()).run();
    return true;
  } catch (e) { return false; }
}

// Idempotently create store ratings + version-history tables (safe to call often).
let _storeSchemaReady = false;
export async function dbEnsureStoreSchema(env) {
  if (_storeSchemaReady) return;
  if (!env.AAA_DB) return;
  const stmts = [
    "create table if not exists store_ratings (id integer primary key autoincrement, app_id text not null, uid text not null, stars integer not null default 5, review text, created_at integer not null default (unixepoch()*1000))",
    "create index if not exists idx_ratings_app on store_ratings(app_id)",
    "create table if not exists store_versions (id integer primary key autoincrement, app_id text not null, version text not null, changelog text, apk_r2_key text, size integer, created_at integer not null default (unixepoch()*1000))",
    "create index if not exists idx_versions_app on store_versions(app_id)",
  ];
  for (const s of stmts) { try { await env.AAA_DB.prepare(s).run(); } catch (e) {} }
  _storeSchemaReady = true;
}

export async function dbListApps(env, opts) {
  if (!env.AAA_DB) return { apps: [], total: 0 };
  const status = (opts.status || "approved");
  const params = [];
  let where = "WHERE status = ?";
  params.push(status);
  if (opts.category && opts.category !== "All") {
    where += " AND category = ?";
    params.push(opts.category);
  }
  if (opts.q) {
    where += " AND (name LIKE ? OR short_desc LIKE ?)";
    params.push("%" + opts.q + "%", "%" + opts.q + "%");
  }
  const page = Math.max(0, (opts.page || 0));
  const per = 24;
  const totalRow = await env.AAA_DB.prepare("SELECT COUNT(*) c FROM store_apps " + where)
    .bind(...params).first();
  const rows = await env.AAA_DB.prepare(
    "SELECT * FROM store_apps " + where + " ORDER BY (status='approved') DESC, approved_at DESC, submitted_at DESC LIMIT ? OFFSET ?"
  ).bind(...params, per, page * per).all();
  return { apps: rows.results || [], total: totalRow?.c || 0 };
}

// ---------------------------------------------------------------------------
// KV helpers (pending queue + sessions)
// ---------------------------------------------------------------------------
export async function pushPending(env, id) {
  if (!env.AAA_KV) return;
  const raw = await env.AAA_KV.get(STORE_PENDING_KEY);
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch (e) {}
  if (!list.includes(id)) list.push(id);
  await env.AAA_KV.put(STORE_PENDING_KEY, JSON.stringify(list));
}

export async function removePending(env, id) {
  if (!env.AAA_KV) return;
  const raw = await env.AAA_KV.get(STORE_PENDING_KEY);
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch (e) {}
  list = list.filter((x) => x !== id);
  await env.AAA_KV.put(STORE_PENDING_KEY, JSON.stringify(list));
}

export async function getPendingList(env) {
  if (!env.AAA_KV) return [];
  const raw = await env.AAA_KV.get(STORE_PENDING_KEY);
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}

export async function createSession(env, uid) {
  const token = "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12);
  if (env.AAA_KV) await env.AAA_KV.put(SESSION_PREFIX + token, uid, { expirationTtl: 60 * 60 * 24 * 30 });
  return token;
}

export async function getSessionUid(env, token) {
  if (!env.AAA_KV || !token) return null;
  return await env.AAA_KV.get(SESSION_PREFIX + token);
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
export function bearerToken(request) {
  const h = request.headers.get("authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  return request.headers.get("x-session") || "";
}

export async function requireUser(request, env) {
  const token = bearerToken(request);
  const uid = await getSessionUid(env, token);
  if (!uid) return { error: json({ ok: false, error: "unauthorized" }, 401) };
  return { uid };
}

// ---------------------------------------------------------------------------
// AI: listing generation + moderation (reuses askAi/adminAi from index.js)
// ---------------------------------------------------------------------------
const STORE_AI_PERSONA =
  "You are AAA-Store-AI, the listing & moderation assistant for the AAA App Store, a free " +
  "Android app store where anyone can publish apps. You write clean, friendly, non-spammy store " +
  "listings and you flag abuse. Reply in plain text, no markdown. For listings: produce a 1-sentence " +
  "short description, a 2-3 paragraph long description, a best-fit category from " +
  "[Game,Tools,Social,Productivity,Entertainment,Education,Finance,Other], and 3-5 comma-separated tags. " +
  "For moderation: decide ok / review / spam and give a one-line reason.";

function safeJson(text) {
  if (!text) return null;
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch (err) { return null; }
}

export async function aiGenerateListing(askAi, name, userShort, userLong) {
  const prompt = STORE_AI_PERSONA + "\n\nAPP NAME: " + name +
    "\nUSER SHORT: " + (userShort || "(none)") +
    "\nUSER LONG: " + (userLong || "(none)") +
    "\n\nReturn JSON only: {\"short_desc\":\"...\",\"long_desc\":\"...\",\"category\":\"...\",\"tags\":\"...\",\"seo\":\"one-line search-friendly tagline\"}";
  try {
    const raw = await askAi(prompt, "gemini");
    return safeJson(raw);
  } catch (e) { return null; }
}

// Structured AI moderation. Returns a decision the worker can act on:
//   decision: "approve" | "review" | "reject"
//   reasons:  string[]  (human-readable, shown to admin + developer)
//   risk_score: 0-100 (higher = riskier)
//   auto_approve: boolean (true when safe enough to skip manual review)
export async function aiModerate(adminAi, listing) {
  const prompt = "You are AAA-Store-AI, the senior moderator for the AAA App Store, a free Android " +
    "app store. Review this submission and decide. Check for: trademark/brand impersonation " +
    "(WhatsApp, Instagram, Netflix, TikTok, etc.), malware/phishing signals, spam, adult content, " +
    "PII harvesting, and low-quality/placeholder listings.\n\nLISTING:\n" + JSON.stringify(listing) +
    "\n\nReturn JSON only: {\"decision\":\"approve|review|reject\",\"risk_score\":0-100," +
    "\"reasons\":[\"one line each, max 3\"],\"auto_approve\":true|false}";
  try {
    const raw = await adminAi(prompt);
    const j = safeJson(raw);
    if (!j) return { decision: "review", risk_score: 50, reasons: ["AI response unparseable; manual review."], auto_approve: false };
    const decision = (j.decision === "approve" || j.decision === "reject") ? j.decision : "review";
    return {
      decision,
      risk_score: Math.max(0, Math.min(100, parseInt(j.risk_score, 10) || 50)),
      reasons: Array.isArray(j.reasons) ? j.reasons.slice(0, 3) : [String(j.reasons || j.notes || "Needs review.")],
      auto_approve: decision === "approve" && (parseInt(j.risk_score, 10) || 50) <= 25 && j.auto_approve !== false,
    };
  } catch (e) {
    return { decision: "review", risk_score: 50, reasons: ["AI unavailable; manual review."], auto_approve: false };
  }
}

// ---------------------------------------------------------------------------
// Helpers shared with index.js
// ---------------------------------------------------------------------------
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } }); }

// ---------------------------------------------------------------------------
// Storefront HTML (reuses the Ari AI site design language)
// ---------------------------------------------------------------------------
function storeShell(title, body, user) {
  const nav = '<nav class="nav"><div class="wrap"><div class="brand">' +
    '<a href="/store" style="display:flex;align-items:center">' +
    '<img class="logo" src="/api/asset/public/aaa-store-logo.png" height="34" alt="AAA App Store"></a></div>' +
    '<div class="nav-actions"><button class="theme-btn" onclick="toggleTheme()" title="Toggle theme">🌓</button>' +
    '<a class="nav-fb" href="https://www.facebook.com/share/1BzWH5P2bF/" target="_blank" rel="noopener">f</a>' +
    '<a class="dl ghost" href="/download">Get app</a>' +
    (user ? '<a class="dl" href="/store/upload">Upload app</a>' : '<a class="dl" href="/store/login">Sign in</a>') +
    (user ? '<a class="chip" href="/store/me">' +
      (user.photo_url ? '<img class="chip-av" src="' + escapeHtml(user.photo_url) + '" alt="">' : '<span class="chip-av chip-av--i">' + escapeHtml((user.display_name || user.tg_username || "U").slice(0, 1).toUpperCase()) + '</span>') +
      '<span class="chip-name">' + escapeHtml(user.display_name || user.tg_username || user.uid) + (user.is_premium ? ' ⭐' : '') + '</span></a>' : '') +
    (user ? '<a class="dl ghost" href="#" onclick="logout();return false;">Sign out</a>' : '') +
    '</div></div></nav>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="theme-color" content="#0b0b13">' +
    '<title>' + title + '</title><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    ':root{color-scheme:dark;--bg:#08080f;--fg:#f2f2f7;--muted:#a6a6b8;--card:rgba(255,255,255,.04);--border:rgba(255,255,255,.08);--input:rgba(255,255,255,.06)}' +
    'html[data-theme="light"]{--bg:#f6f7fb;--fg:#15151f;--muted:#5b5b70;--card:rgba(20,20,40,.04);--border:rgba(20,20,40,.1);--input:rgba(20,20,40,.05)}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);line-height:1.55;transition:background .2s,color .2s}' +
    '.wrap{max-width:1100px;margin:0 auto;padding:0 20px}a{color:inherit;text-decoration:none}' +
    '.nav{position:sticky;top:0;z-index:20;backdrop-filter:blur(12px);background:rgba(8,8,15,.7);border-bottom:1px solid var(--border)}' +
    'html[data-theme="light"] .nav{background:rgba(246,247,251,.8)}' +
    '.nav .wrap{display:flex;align-items:center;justify-content:space-between;padding:12px 20px}' +
    '.brand{display:flex;align-items:center;font-weight:800}' +
    '.brand img{height:34px;width:auto;border-radius:9px;filter:drop-shadow(0 2px 10px rgba(124,77,255,.4))}' +
    '.brand .logo{height:34px;width:auto}' +
    '.nav a.dl{background:linear-gradient(135deg,#7c4dff,#ff4d9d);padding:9px 18px;border-radius:50px;font-weight:700;font-size:.9rem;color:#fff}' +
    '.nav a.dl.ghost{background:var(--input);border:1px solid var(--border);color:var(--fg)}' +
    '.nav-actions{display:flex;align-items:center;gap:10px}' +
    '.nav-fb{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:rgba(59,89,152,.18);border:1px solid rgba(59,89,152,.5);color:#9db4ff;font-weight:800}' +
    '.theme-btn{cursor:pointer;background:var(--input);border:1px solid var(--border);color:var(--fg);width:34px;height:34px;border-radius:50%;font-size:1rem}' +
    '.chip{display:inline-flex;align-items:center;gap:8px;padding:5px 12px 5px 5px;border-radius:50px;background:var(--input);border:1px solid var(--border);font-weight:600;font-size:.85rem}' +
    '.chip-av{width:26px;height:26px;border-radius:50%;object-fit:cover;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:.8rem;background:linear-gradient(135deg,#7c4dff,#ff4d9d);color:#fff}' +
    '.chip-av--i{width:26px;height:26px}' +
    '.chip-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.card{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:26px;max-width:620px;margin:30px auto}' +
    '.p-card{text-align:left}' +
    '.p-head{display:flex;align-items:center;gap:16px;margin-bottom:18px}' +
    '.p-av{width:64px;height:64px;border-radius:50%;object-fit:cover}' +
    '.p-av--i{display:inline-flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:800;color:#fff;background:linear-gradient(135deg,#7c4dff,#ff4d9d)}' +
    '.p-name{font-size:1.3rem;font-weight:800}.p-sub{color:var(--muted);font-size:.9rem}' +
    '.p-prem{font-size:.8rem;font-weight:700;color:#ffd54a}' +
    '.kv-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
    '.kv{background:var(--input);border:1px solid var(--border);border-radius:12px;padding:12px 14px}' +
    '.kv .k{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}' +
    '.kv .v{font-size:1rem;font-weight:600;margin-top:3px;word-break:break-word}' +
    '.muted{color:var(--muted)}' +
    '.hero{position:relative;overflow:hidden;text-align:center;padding:72px 20px 48px;background:radial-gradient(circle at 50% 0%,rgba(124,77,255,.4),transparent 60%)}' +
    '.hero::before{content:"";position:absolute;inset:-40% -20% auto -20%;height:420px;z-index:-1;background:radial-gradient(circle at 70% 30%,rgba(255,77,157,.32),transparent 55%);filter:blur(40px)}' +
    '.hero h1{font-size:clamp(2rem,5vw,3rem);font-weight:800}.grad{background:linear-gradient(135deg,#a98bff,#ff8fc0);-webkit-background-clip:text;background-clip:text;color:transparent}' +
    '.sub{color:var(--muted);max-width:560px;margin:12px auto 24px}' +
    '.btn{display:inline-flex;align-items:center;gap:10px;padding:14px 28px;border-radius:50px;font-weight:700;background:linear-gradient(135deg,#7c4dff,#ff4d9d);color:#fff;transition:transform .15s,box-shadow .2s}' +
    '.btn:hover{transform:translateY(-2px);box-shadow:0 14px 34px rgba(255,77,157,.35)}' +
    '.bar{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:18px 0}' +
    '.chip{background:var(--input);border:1px solid var(--border);padding:7px 16px;border-radius:50px;font-size:.85rem;cursor:pointer;transition:.15s;color:var(--fg)}' +
    '.chip:hover{border-color:rgba(124,77,255,.5)}' +
    '.chip.active{background:linear-gradient(135deg,#7c4dff,#ff4d9d);border-color:transparent;color:#fff}' +
    'input.search{background:var(--input);border:1px solid var(--border);color:var(--fg);padding:12px 16px;border-radius:50px;min-width:280px;outline:none}' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:28px}' +
    '.card{display:block;background:var(--card);border:1px solid var(--border);border-radius:18px;padding:18px;transition:transform .15s,border-color .2s}' +
    '.card:hover{transform:translateY(-4px);border-color:rgba(124,77,255,.5)}' +
    '.card img.ic{width:64px;height:64px;border-radius:16px;object-fit:cover;background:#222;box-shadow:0 6px 18px rgba(124,77,255,.25)}' +
    '.card h3{margin:12px 0 4px;font-size:1.05rem}.card p{color:var(--muted);font-size:.88rem;min-height:38px}' +
    '.cat{font-size:.72rem;color:#9db4ff;text-transform:uppercase;letter-spacing:1px;font-weight:700}' +
    '.meta{color:var(--muted);font-size:.78rem;margin-top:8px}' +
    'section{padding:40px 0}footer{text-align:center;padding:40px 20px;color:var(--muted);font-size:.85rem;border-top:1px solid var(--border)}' +
    '.empty{text-align:center;padding:60px 20px;color:var(--muted)}.empty .big{font-size:3rem;margin-bottom:10px}' +
    '.detail{max-width:720px;margin:0 auto}.detail img.ic{width:96px;height:96px;border-radius:22px;object-fit:cover}' +
    '.form{max-width:620px;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:20px;padding:26px}' +
    '.form label{display:block;margin:14px 0 6px;color:var(--muted);font-size:.9rem}' +
    '.form input,.form textarea,.form select{width:100%;background:var(--input);border:1px solid var(--border);color:var(--fg);padding:11px 14px;border-radius:12px;outline:none;font-family:inherit}' +
    '.toggle{display:flex;gap:10px;margin:10px 0}.toggle button{flex:1;padding:10px;border-radius:12px;border:1px solid var(--border);background:var(--input);color:var(--muted)}' +
    '.toggle button.active{background:linear-gradient(135deg,#7c4dff,#ff4d9d);color:#fff;border-color:transparent}' +
    '.featured{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid rgba(124,77,255,.3);' +
    'border-radius:18px;padding:14px 18px;text-decoration:none;max-width:560px;margin:22px auto 0}' +
    '.featured img{border-radius:14px;box-shadow:0 4px 14px rgba(124,77,255,.35)}' +
    '.featured .get{margin-left:auto;background:linear-gradient(135deg,#7c4dff,#ff4d9d);color:#fff;font-weight:800;' +
    'padding:9px 16px;border-radius:50px;font-size:.85rem;white-space:nowrap}' +
    '.featured:hover{border-color:rgba(124,77,255,.6);transform:translateY(-2px);transition:.15s}' +
    '.steps{counter-reset:s;display:grid;gap:12px;max-width:640px;margin:24px auto}' +
    '.step{display:flex;gap:14px;align-items:flex-start;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;text-align:left}' +
    '.step .n{flex:0 0 32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7c4dff,#ff4d9d);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800}' +
    '.step h4{margin-bottom:4px}.step p{color:var(--muted);font-size:.88rem}' +
    '</style></head><body>' +
    '<script>try{var t=localStorage.getItem("theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>' +
    nav + '<div class="wrap">' + body + '</div>' +
    '<footer>&copy; ' + new Date().getFullYear() + ' AAA App Store &middot; A free Android app store.</footer>' +
    '<script>function toggleTheme(){var h=document.documentElement;var c=h.getAttribute("data-theme")==="light"?"dark":"light";h.setAttribute("data-theme",c);try{localStorage.setItem("theme",c);}catch(e){}}' +
    'function logout(){try{var t=localStorage.getItem("sess");if(t){fetch("/api/store/logout",{method:"POST",headers:{"x-session":t}}).catch(function(){});}localStorage.removeItem("sess");localStorage.removeItem("sessUser");}catch(e){}location.href="/store";}</script>' +
    '</body></html>';
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- Fresh UI (delegates to ./store-ui.js) ----
export function appCard(a) { return UI.appCard(a); }
export function storePage(list, categories, user) { return UI.homePage(list, categories, user); }
export function storeDetailPage(a, user, ratings, versions) { return UI.detailPage(a, user, ratings, versions); }
export function uploadPage(user) { return UI.uploadPage(user); }
export function downloadPage(available, versionName, sizeLabel, stats, changelog, qr) {
  return UI.downloadPage(available, versionName, sizeLabel, stats, changelog, qr);
}
export function profilePage(user) { return UI.profilePage(user); }
export function loginPage(user, opts) { return UI.loginPage(opts || {}); }

// Re-export json for workers that need it
export { json, escapeHtml };
