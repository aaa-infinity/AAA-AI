// Shared store module for the Ari AI App Store.
// Imported by BOTH workers (aaa-ai-bot + aaa-store) so they share the same
// D1 (store_users / store_apps) + R2 (apk/icons) + KV (sessions/queue).

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
  const existing = await dbGetUser(env, uid);
  if (existing) {
    await env.AAA_DB.prepare(
      "UPDATE store_users SET tg_username=?, display_name=?, photo_url=? WHERE uid=?"
    ).bind(profile.username || existing.tg_username, profile.display_name || existing.display_name,
      profile.photo_url || existing.photo_url, uid).run();
    return existing;
  }
  await env.AAA_DB.prepare(
    "INSERT INTO store_users (uid, tg_username, display_name, photo_url, is_admin, apps_count, created_at) " +
    "VALUES (?,?,?,?,?,0,?)"
  ).bind(uid, profile.username || "", profile.display_name || "", profile.photo_url || "",
    profile.is_admin ? 1 : 0, Date.now()).run();
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

// Mark an old approved app for the same package as superseded and delete its R2 blob.
export async function dbSupersede(env, oldId, newId) {
  if (!env.AAA_DB) return;
  const old = await dbGetApp(env, oldId);
  if (!old) return;
  await env.AAA_DB.prepare("UPDATE store_apps SET status='superseded' WHERE id=?").bind(oldId).run();
  if (old.apk_r2_key && env.aaa_assets) {
    try { await env.aaa_assets.delete(old.apk_r2_key); } catch (e) {}
  }
}

export async function dbIncDownloads(env, id) {
  if (!env.AAA_DB) return;
  await env.AAA_DB.prepare("UPDATE store_apps SET downloads = downloads + 1 WHERE id = ?").bind(id).run();
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
  "You are Ari-Store-AI, the listing & moderation assistant for the Ari AI App Store, a free " +
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
    "\n\nReturn JSON only: {\"short_desc\":\"...\",\"long_desc\":\"...\",\"category\":\"...\",\"tags\":\"...\"}";
  try {
    const raw = await askAi(prompt, "gemini");
    return safeJson(raw);
  } catch (e) { return null; }
}

export async function aiModerate(adminAi, listing) {
  const prompt = STORE_AI_PERSONA + "\n\nMODERATE THIS LISTING:\n" + JSON.stringify(listing) +
    "\n\nReturn JSON only: {\"flag\":\"ok|review|spam\",\"score\":0-100,\"notes\":\"...\"}";
  try {
    const raw = await adminAi(prompt);
    return safeJson(raw) || { flag: "review", score: 50, notes: "AI unavailable; manual review." };
  } catch (e) { return { flag: "review", score: 50, notes: "AI unavailable; manual review." }; }
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
    '<a href="/download" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px">' +
    '<img src="/api/asset/public/Logo.png" width="30" height="30" alt="">Super AI</a></div>' +
    '<div class="nav-actions"><a class="nav-fb" href="https://www.facebook.com/share/1BzWH5P2bF/" target="_blank" rel="noopener">f</a>' +
    '<a class="dl ghost" href="/download">Get app</a>' +
    (user ? '<a class="dl" href="/store/upload">Upload app</a>' : '<a class="dl" href="/store/login">Sign in</a>') +
    '</div></div></nav>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="theme-color" content="#0b0b13">' +
    '<title>' + title + '</title><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}:root{color-scheme:dark}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#08080f;color:#f2f2f7;line-height:1.55}' +
    '.wrap{max-width:1100px;margin:0 auto;padding:0 20px}a{color:inherit;text-decoration:none}' +
    '.nav{position:sticky;top:0;z-index:20;backdrop-filter:blur(12px);background:rgba(8,8,15,.7);border-bottom:1px solid rgba(255,255,255,.06)}' +
    '.nav .wrap{display:flex;align-items:center;justify-content:space-between;padding:12px 20px}' +
    '.brand{display:flex;align-items:center;gap:10px;font-weight:800}' +
    '.brand img{width:32px;height:32px;border-radius:9px;box-shadow:0 2px 10px rgba(124,77,255,.4)}' +
    '.nav a.dl{background:linear-gradient(135deg,#7c4dff,#ff4d9d);padding:9px 18px;border-radius:50px;font-weight:700;font-size:.9rem}' +
    '.nav a.dl.ghost{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}' +
    '.nav-actions{display:flex;align-items:center;gap:10px}' +
    '.nav-fb{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:rgba(59,89,152,.18);border:1px solid rgba(59,89,152,.5);color:#9db4ff;font-weight:800}' +
    '.hero{position:relative;overflow:hidden;text-align:center;padding:72px 20px 48px;background:radial-gradient(circle at 50% 0%,rgba(124,77,255,.4),transparent 60%)}' +
    '.hero::before{content:"";position:absolute;inset:-40% -20% auto -20%;height:420px;z-index:-1;background:radial-gradient(circle at 70% 30%,rgba(255,77,157,.32),transparent 55%);filter:blur(40px)}' +
    '.hero h1{font-size:clamp(2rem,5vw,3rem);font-weight:800}.grad{background:linear-gradient(135deg,#a98bff,#ff8fc0);-webkit-background-clip:text;background-clip:text;color:transparent}' +
    '.sub{color:#b9b9c9;max-width:560px;margin:12px auto 24px}' +
    '.btn{display:inline-flex;align-items:center;gap:10px;padding:14px 28px;border-radius:50px;font-weight:700;background:linear-gradient(135deg,#7c4dff,#ff4d9d);color:#fff;transition:transform .15s,box-shadow .2s}' +
    '.btn:hover{transform:translateY(-2px);box-shadow:0 14px 34px rgba(255,77,157,.35)}' +
    '.bar{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:18px 0}' +
    '.chip{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);padding:7px 16px;border-radius:50px;font-size:.85rem;cursor:pointer;transition:.15s}' +
    '.chip:hover{border-color:rgba(124,77,255,.5)}' +
    '.chip.active{background:linear-gradient(135deg,#7c4dff,#ff4d9d);border-color:transparent}' +
    'input.search{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#fff;padding:12px 16px;border-radius:50px;min-width:280px;outline:none}' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:28px}' +
    '.card{display:block;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:18px;transition:transform .15s,border-color .2s}' +
    '.card:hover{transform:translateY(-4px);border-color:rgba(124,77,255,.5)}' +
    '.card img.ic{width:64px;height:64px;border-radius:16px;object-fit:cover;background:#222;box-shadow:0 6px 18px rgba(124,77,255,.25)}' +
    '.card h3{margin:12px 0 4px;font-size:1.05rem}.card p{color:#a6a6b8;font-size:.88rem;min-height:38px}' +
    '.cat{font-size:.72rem;color:#9db4ff;text-transform:uppercase;letter-spacing:1px;font-weight:700}' +
    '.meta{color:#8a8aa0;font-size:.78rem;margin-top:8px}' +
    'section{padding:40px 0}footer{text-align:center;padding:40px 20px;color:#6f6f82;font-size:.85rem;border-top:1px solid rgba(255,255,255,.06)}' +
    '.empty{text-align:center;padding:60px 20px;color:#9d9daf}.empty .big{font-size:3rem;margin-bottom:10px}' +
    '.detail{max-width:720px;margin:0 auto}.detail img.ic{width:96px;height:96px;border-radius:22px;object-fit:cover}' +
    '.form{max-width:620px;margin:0 auto;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:26px}' +
    '.form label{display:block;margin:14px 0 6px;color:#cfcfdd;font-size:.9rem}' +
    '.form input,.form textarea,.form select{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#fff;padding:11px 14px;border-radius:12px;outline:none;font-family:inherit}' +
    '.toggle{display:flex;gap:10px;margin:10px 0}.toggle button{flex:1;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#cfcfdd}' +
    '.toggle button.active{background:linear-gradient(135deg,#7c4dff,#ff4d9d);color:#fff;border-color:transparent}' +
    '</style></head><body>' + nav + '<div class="wrap">' + body + '</div>' +
    '<footer>&copy; ' + new Date().getFullYear() + ' Super AI &middot; A free Android app store.</footer></body></html>';
}

function appCard(a) {
  const icon = a.icon_url || "/api/asset/public/Logo.png";
  return '<a class="card" href="/store/app/' + a.id + '">' +
    '<img class="ic" src="' + icon + '" alt="" onerror="this.src=\'/api/asset/public/Logo.png\'">' +
    '<div class="cat">' + (a.category || "Other") + '</div>' +
    '<h3>' + escapeHtml(a.name) + '</h3>' +
    '<p>' + escapeHtml(a.short_desc || "") + '</p>' +
    '<div class="meta">⬇ ' + (a.downloads || 0) + ' downloads · v' + (a.version || "?") + '</div></a>';
}

export function storePage(list, categories, user) {
  const chips = ['<span class="chip ' + (!list.q && !list.category ? 'active' : '') + '" onclick="location=\'/store\'">All</span>']
    .concat(categories.map((c) =>
      '<span class="chip ' + (list.category === c ? 'active' : '') + '" onclick="location=\'/store?category=' + encodeURIComponent(c) + '\'">' + c + '</span>'
    )).join('');
  const body = '<header class="hero"><h1>Super AI <span class="grad">App Store</span></h1>' +
    '<p class="sub">A free, open Android app store. Anyone can publish — browse, download, and share apps.</p>' +
    '<a class="btn" href="' + (user ? '/store/upload' : '/store/login') + '">⬆ Publish your app</a></header>' +
    '<div class="bar"><input class="search" placeholder="Search apps…" onkeydown="if(event.key===\'Enter\')location=\'/store?q=\'+encodeURIComponent(this.value)"></div>' +
    '<div class="bar">' + chips + '</div>' +
    (list.apps.length ? '<div class="grid">' + list.apps.map(appCard).join('') + '</div>'
      : '<div class="empty"><div class="big">📦</div><p>No apps yet — be the first to publish!</p>' +
        '<a class="btn" style="margin-top:16px" href="' + (user ? '/store/upload' : '/store/login') + '">Publish an app</a></div>');
  return storeShell("Super AI App Store", body, user);
}

export function storeDetailPage(a, user) {
  if (!a) return storeShell("Not found", "<p style='text-align:center;margin-top:60px'>App not found.</p>", user);
  const icon = a.icon_url || "/api/asset/public/Logo.png";
  const dl = a.apk_r2_key
    ? '<a class="btn" href="/store/apks/' + a.id + '.apk">⬇ Download APK</a>'
    : (a.apk_url ? '<a class="btn" href="' + escapeHtml(a.apk_url) + '" target="_blank" rel="noopener">⬇ Get it here</a>' : '<span class="btn" style="opacity:.6">Download unavailable</span>');
  const body = '<div class="detail" style="padding-top:40px">' +
    '<img class="ic" src="' + icon + '" alt="" onerror="this.src=\'/api/asset/public/Logo.png\'">' +
    '<h1 style="margin:16px 0 4px">' + escapeHtml(a.name) + '</h1>' +
    '<div class="cat">' + (a.category || "Other") + (a.version ? ' · v' + a.version : '') + (a.min_android ? ' · Android ' + a.min_android + '+' : '') + '</div>' +
    '<p style="color:#cfcfdd;margin:18px 0;line-height:1.7">' + escapeHtml(a.long_desc || a.short_desc || "") + '</p>' +
    '<div style="margin:20px 0">' + dl + '</div>' +
    '<div class="meta">⬇ ' + (a.downloads || 0) + ' downloads</div></div>';
  return storeShell(a.name + " · Super AI Store", body, user);
}

export function uploadPage(user) {
  const body = '<div class="form"><h2 style="margin-bottom:6px">Publish an app</h2>' +
    '<p style="color:#a6a6b8;margin-bottom:8px">Fill in the details. AI will polish the listing; an admin approves before it goes live.</p>' +
    '<form id="f">' +
    '<label>App name *</label><input name="name" required maxlength="80">' +
    '<label>Category</label><select name="category">' + STORE_CATEGORIES.map((c) => '<option>' + c + '</option>').join('') + '</select>' +
    '<label>Version (e.g. 1.0.0)</label><input name="version" maxlength="20">' +
    '<label>Package name (e.g. com.acme.app)</label><input name="package_name" maxlength="120">' +
    '<label>Min Android (e.g. 7.0)</label><input name="min_android" maxlength="10">' +
    '<label>Short description</label><textarea name="short_desc" rows="2" maxlength="200"></textarea>' +
    '<label>Long description</label><textarea name="long_desc" rows="5" maxlength="2000"></textarea>' +
    '<label>Icon URL</label><input name="icon_url" placeholder="https://…" maxlength="500">' +
    '<div class="toggle"><button type="button" id="tR2" class="active" onclick="selMode(\'r2\')">Host APK with us</button>' +
    '<button type="button" id="tLink" onclick="selMode(\'link\')">External link</button></div>' +
    '<div id="r2box"><label>APK file (max 100 MB)</label><input type="file" name="apk" accept=".apk,application/vnd.android.package-archive"></div>' +
    '<div id="linkbox" style="display:none"><label>External download URL</label><input name="apk_url" placeholder="https://…" maxlength="500"></div>' +
    '<button class="btn" type="submit" style="margin-top:18px;width:100%;justify-content:center">Submit for review</button>' +
    '<p id="msg" style="margin-top:12px;color:#ff9b9b"></p></form>' +
    '<script>function selMode(m){document.getElementById("r2box").style.display=m===\'r2\'?\'block\':\'none\';' +
    'document.getElementById("linkbox").style.display=m===\'link\'?\'block\':\'none\';' +
    'document.getElementById("tR2").classList.toggle("active",m===\'r2\');document.getElementById("tLink").classList.toggle("active",m===\'link\');}' +
    'document.getElementById("f").addEventListener("submit",async function(e){e.preventDefault();' +
    'var fd=new FormData(this);var m=document.getElementById("r2box").style.display!=="none"?"r2":"link";' +
    'var body=new FormData();["name","category","version","package_name","min_android","short_desc","long_desc","icon_url"].forEach(function(k){body.append(k,fd.get(k)||"")});' +
    'if(m==="link"){body.append("apk_url",fd.get("apk_url")||"");}else{var f=fd.get("apk");if(f&&f.size)body.append("apk",f);}' +
    'var r=await fetch("/api/store/apps",{method:"POST",headers:{"x-session":new URLSearchParams(location.search).get("t")||localStorage.getItem("sess")||""},body:body});' +
    'var j=await r.json();document.getElementById("msg").textContent=j.ok?"✅ Submitted! Pending admin approval.":(j.error||"Failed");});</script></div>';
  return storeShell("Publish · Super AI Store", body, user);
}

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function loginPage(user, opts) {
  opts = opts || {};
  const bot = opts.botUsername || "AAA_Login_bot";
  const domain = opts.loginDomain || "app2629244753-login.tg.dev";
  const verifyUrl = opts.authUrl || ((opts.botOrigin || "https://aaa-ai-bot.aaateam.workers.dev") + "/api/telegram-widget-verify");
  const body = '<div class="form" style="max-width:460px;text-align:center">' +
    '<h2 style="margin-bottom:6px">Sign in to the App Store</h2>' +
    '<p style="color:#a6a6b8;margin-bottom:18px">Connect your Telegram account to publish and manage apps.</p>' +
    '<div class="tg" style="margin:18px 0"><script async src="https://telegram.org/js/telegram-widget.js?22" ' +
    'data-telegram-login="' + escapeHtml(bot) + '" data-size="large" data-userpic="false" data-radius="16" ' +
    'data-auth-url="' + escapeHtml(verifyUrl) + '" data-request-access="write"></script></div>' +
    '<div style="margin:14px 0;color:#6f6f82">or</div>' +
    '<div style="text-align:left"><label>Sign in with a Telegram link code</label>' +
    '<p style="color:#a6a6b8;font-size:.85rem;margin-bottom:10px">Open the Super AI app → Settings → "Link this account", copy the 6-character code, paste it below.</p>' +
    '<input id="code" placeholder="ABC123" maxlength="12" style="text-transform:uppercase;letter-spacing:2px;text-align:center">' +
    '<button class="btn" id="codeBtn" style="margin-top:14px;width:100%;justify-content:center">Verify code</button>' +
    '<p id="msg" style="margin-top:12px;color:#ff9b9b"></p></div>' +
    '<script>' +
    'function saveSess(t){try{localStorage.setItem("sess",t);}catch(e){}}' +
    // The widget verify returns a real session token (type tg-store-login).
    'window.addEventListener("message",function(e){if(e.data&&e.data.type==="tg-store-login"&&e.data.token){saveSess(e.data.token);location.href="/store";}});' +
    'document.getElementById("codeBtn").addEventListener("click",async function(){' +
    'var c=document.getElementById("code").value.trim();if(!c){document.getElementById("msg").textContent="Enter a code.";return;}' +
    'var r=await fetch("/api/store/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:c})});' +
    'var j=await r.json();if(j.ok){saveSess(j.token);location.href="/store";}else{document.getElementById("msg").textContent=j.error||"Invalid code.";}});' +
    '</script></div>';
  return storeShell("Sign in · Super AI Store", body, user);
}



// Re-export json for workers that need it
export { json };
