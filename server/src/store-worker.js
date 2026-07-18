// Worker 2 — aaa-store: public App Store + downloads + store API.
// Shares D1/R2/KV with Worker 1 (aaa-ai-bot). Auth/sessions are cross-worker
// because the session token is just a KV key both workers can read.
import {
  STORE_CATEGORIES, dbUpsertUser, dbInsertApp, dbGetApp, dbGetAppByPackage,
  dbUpdateAppStatus, dbSupersede, dbIncDownloads, dbListApps,
  pushPending, removePending, getPendingList, createSession, getSessionUid,
  requireUser, aiGenerateListing, aiModerate, storePage, storeDetailPage,
  uploadPage, loginPage, escapeHtml, json,
} from "./storeShared.js";
import { askAi, adminAi, verifyTelegramWidget } from "./index.js";

let ENV = {};

async function requireAdmin(request, env) {
  const { uid, error } = await requireUser(request, env);
  if (error) return { error };
  const u = await dbUpsertUser(env, { uid }); // ensures row exists
  if (!u || !u.is_admin) return { error: json({ ok: false, error: "forbidden" }, 403) };
  return { uid };
}

async function handleStore(request, env) {
  ENV = env || {};
  const url = new URL(request.url);
  const p = url.pathname;

  // ---- Storefront pages ----
  if (request.method === "GET" && (p === "/store" || p === "/store/")) {
    const cat = url.searchParams.get("category") || "";
    const q = url.searchParams.get("q") || "";
    const page = parseInt(url.searchParams.get("page") || "0", 10) || 0;
    const list = await dbListApps(env, { status: "approved", category: cat, q: q, page: page });
    const token = request.headers.get("x-session") || "";
    const uid = await getSessionUid(env, token);
    const user = uid ? await dbUpsertUser(env, { uid }) : null;
    return new Response(storePage({ apps: list.apps, total: list.total, category: cat, q: q }, STORE_CATEGORIES, user), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  }
  if (request.method === "GET" && p.startsWith("/store/app/")) {
    const id = p.slice("/store/app/".length).replace(/\.html$/, "");
    const a = await dbGetApp(env, id);
    const token = request.headers.get("x-session") || "";
    const uid = await getSessionUid(env, token);
    const user = uid ? await dbUpsertUser(env, { uid }) : null;
    if (!a || (a.status !== "approved" && a.owner_uid !== (uid || ""))) {
      return new Response(storeDetailPage(null, user), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response(storeDetailPage(a, user), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (request.method === "GET" && (p === "/store/upload")) {
    const { uid, error } = await requireUser(request, env);
    const token = request.headers.get("x-session") || "";
    if (error) return Response.redirect(url.origin + "/store/login?t=" + token, 302);
    const user = await dbUpsertUser(env, { uid });
    return new Response(uploadPage(user), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (request.method === "GET" && (p === "/store/login" || p === "/store/login/")) {
    const token = request.headers.get("x-session") || "";
    const uid = await getSessionUid(env, token);
    const user = uid ? await dbUpsertUser(env, { uid }) : null;
    const origin = env.PUBLIC_ORIGIN || "https://aaa-ai-bot.aaateam.workers.dev";
    return new Response(loginPage(user, {
      botUsername: env.LOGIN_BOT_USERNAME || "AAA_Login_bot",
      loginDomain: env.LOGIN_BOT_DOMAIN || "app2629244753-login.tg.dev",
      authUrl: origin + "/api/store/widget-verify",
    }), { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // ---- Store API ----
  if (request.method === "POST" && p === "/api/store/login") {
    const body = await request.json().catch(() => ({}));
    // Accepts { code } (Telegram link code) or { widget } (Telegram login widget fields).
    let uid = null, profile = null;
    if (body.widget) {
      const ok = await verifyTelegramWidget(body.widget);
      if (ok) { uid = String(body.widget.id); profile = { uid, username: body.widget.username, display_name: (body.widget.first_name || "") + " " + (body.widget.last_name || ""), photo_url: body.widget.photo_url }; }
    } else if (body.code) {
      const v = await fetch(url.origin + "/api/verify?code=" + encodeURIComponent(body.code)).then((r) => r.json()).catch(() => ({}));
      if (v.ok) { uid = String(v.chatId); profile = v.profile; }
    }
    if (!uid) return json({ ok: false, error: "login failed" }, 401);
    await dbUpsertUser(env, { uid, username: profile?.username || "", display_name: profile?.display_name || "", photo_url: profile?.photo_url || "", is_admin: false });
    const token = await createSession(env, uid);
    return json({ ok: true, token: token, user: { uid } });
  }
  if (request.method === "POST" && p === "/api/store/widget-verify") {
    // Telegram Login Widget posts signed fields here. We verify, create a
    // session, then hand a TOKEN (not just the uid) back to the opener/WebView.
    const body = await request.json().catch(() => ({}));
    const ok = await verifyTelegramWidget(body);
    if (!ok) {
      return new Response("⛔ Login failed.", { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const uid = String(body.id);
    await dbUpsertUser(env, { uid, username: body.username || "", display_name: (body.first_name || "") + " " + (body.last_name || ""), photo_url: body.photo_url || "", is_admin: false });
    const token = await createSession(env, uid);
    const user = { uid, username: body.username, first_name: body.first_name, last_name: body.last_name, photo_url: body.photo_url };
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
      'var t=' + JSON.stringify(token) + ';var u=' + JSON.stringify(user) + ';' +
      'try{if(window.opener)window.opener.postMessage({type:"tg-store-login",token:t,user:u},"*");}catch(e){}' +
      'try{parent.postMessage({type:"tg-store-login",token:t,user:u},"*");}catch(e){}' +
      'try{if(window.TgLoginBridge)window.TgLoginBridge.onResult(JSON.stringify({token:t,user:u}));}catch(e){}' +
      'document.write("✅ Signed in as "+(u.username||u.uid)+". You can close this tab.");' +
      'setTimeout(function(){try{window.close();}catch(e){}},800);' +
      '</script></body></html>';
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (request.method === "GET" && p === "/api/store/me") {
    const { uid, error } = await requireUser(request, env);
    if (error) return error;
    const u = await dbUpsertUser(env, { uid });
    return json({ ok: true, user: { uid: u.uid, username: u.tg_username, display_name: u.display_name, is_admin: !!u.is_admin } });
  }
  if (request.method === "GET" && p === "/api/store/apps") {
    const cat = url.searchParams.get("category") || "";
    const q = url.searchParams.get("q") || "";
    const page = parseInt(url.searchParams.get("page") || "0", 10) || 0;
    const list = await dbListApps(env, { status: "approved", category: cat, q: q, page: page });
    return json({ ok: true, apps: list.apps.map(publicApp), total: list.total });
  }
  if (request.method === "GET" && p.startsWith("/api/store/apps/") && !p.includes("/approve") && !p.includes("/reject")) {
    const id = p.slice("/api/store/apps/".length);
    const a = await dbGetApp(env, id);
    if (!a || a.status !== "approved") return json({ ok: false, error: "not found" }, 404);
    return json({ ok: true, app: publicApp(a) });
  }
  if (request.method === "POST" && p === "/api/store/apps") {
    const { uid, error } = await requireUser(request, env);
    if (error) return error;
    // Rate-limit: 5 pending submissions / hour per user.
    const rlKey = "store_up:" + uid;
    const used = parseInt(await env.AAA_KV?.get(rlKey) || "0", 10) || 0;
    if (used >= 5) return json({ ok: false, error: "too many uploads, slow down" }, 429);

    const form = await request.formData().catch(() => null);
    let fields = {};
    if (form) {
      for (const [k, v] of form.entries()) fields[k] = typeof v === "string" ? v : v;
    } else {
      fields = await request.json().catch(() => ({}));
    }
    const name = (fields.name || "").trim();
    if (!name) return json({ ok: false, error: "name required" }, 400);
    const category = STORE_CATEGORIES.includes(fields.category) ? fields.category : "Other";

    let apk_r2_key = null, apk_size = null, apk_url = null;
    const modeIsLink = !!(fields.apk_url && fields.apk_url.trim());
    if (modeIsLink) {
      const u = fields.apk_url.trim();
      if (!/^https?:\/\//i.test(u)) return json({ ok: false, error: "external link must be http(s)" }, 400);
      apk_url = u;
    } else if (form) {
      const file = form.get("apk");
      if (file && file.size) {
        if (file.size > 100 * 1024 * 1024) return json({ ok: false, error: "APK too large (max 100MB)" }, 400);
        const key = "store/apks/app_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".apk";
        await env.aaa_assets.put(key, file, { httpMetadata: { contentType: "application/vnd.android.package-archive" } });
        apk_r2_key = key; apk_size = file.size;
      }
    }

    // AI enrich listing (fail-soft).
    let short_desc = (fields.short_desc || "").trim();
    let long_desc = (fields.long_desc || "").trim();
    let finalCategory = category;
    const ai = await aiGenerateListing(askAi, name, short_desc, long_desc);
    if (ai) {
      if (!short_desc && ai.short_desc) short_desc = ai.short_desc;
      if (!long_desc && ai.long_desc) long_desc = ai.long_desc;
      if (ai.category && STORE_CATEGORIES.includes(ai.category)) finalCategory = ai.category;
    }

    const id = "app_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    await dbInsertApp(env, {
      id, owner_uid: uid, name, package_name: (fields.package_name || "").trim() || null,
      version: (fields.version || "").trim(), category: finalCategory,
      short_desc, long_desc, icon_url: (fields.icon_url || "").trim() || null,
      apk_url, apk_r2_key, apk_size, min_android: (fields.min_android || "").trim(),
      status: "pending",
    });

    // AI moderation pre-check.
    const moderation = await aiModerate(adminAi, { name, short_desc, long_desc, category: finalCategory, apk_url, icon_url: fields.icon_url });
    await env.AAA_DB.prepare("UPDATE store_apps SET moderation = ? WHERE id = ?").bind(JSON.stringify(moderation), id).run();

    if (moderation.flag === "spam") {
      await dbUpdateAppStatus(env, id, "rejected", "Auto-moderation: " + (moderation.notes || "spam"));
      await env.AAA_KV?.put(rlKey, String(used + 1), { expirationTtl: 3600 });
      return json({ ok: false, error: "rejected by automated review: " + (moderation.notes || "") }, 422);
    }
    await pushPending(env, id);
    await env.AAA_KV?.put(rlKey, String(used + 1), { expirationTtl: 3600 });
    // Notify admin.
    if (env.ADMIN_BOT_TOKEN && env.ADMIN_CHAT_ID) {
      const note = moderation.flag === "review" ? " ⚠ AI flagged for review: " + (moderation.notes || "") : "";
      await fetch("https://api.telegram.org/bot" + env.ADMIN_BOT_TOKEN + "/sendMessage", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: env.ADMIN_CHAT_ID, text: "📦 New app submitted: " + name + note + "\nReview: /review" }),
      }).catch(() => {});
    }
    return json({ ok: true, id: id, status: "pending", moderation: moderation });
  }
  if (request.method === "POST" && p.match(/\/api\/store\/apps\/[^/]+\/approve$/)) {
    const { error } = await requireAdmin(request, env);
    if (error) return error;
    const id = p.split("/")[4];
    const a = await dbGetApp(env, id);
    if (!a) return json({ ok: false, error: "not found" }, 404);
    // Supersede any currently-approved app with the same package.
    if (a.package_name) {
      const cur = await dbGetAppByPackage(env, a.package_name);
      if (cur && cur.id !== id) await dbSupersede(env, cur.id, id);
    }
    await dbUpdateAppStatus(env, id, "approved", null);
    await removePending(env, id);
    await env.AAA_DB.prepare("UPDATE store_users SET apps_count = apps_count + 1 WHERE uid = ?").bind(a.owner_uid).run();
    return json({ ok: true, status: "approved" });
  }
  if (request.method === "POST" && p.match(/\/api\/store\/apps\/[^/]+\/reject$/)) {
    const { error } = await requireAdmin(request, env);
    if (error) return error;
    const id = p.split("/")[4];
    const body = await request.json().catch(() => ({}));
    await dbUpdateAppStatus(env, id, "rejected", body.reason || "rejected by admin");
    await removePending(env, id);
    return json({ ok: true, status: "rejected" });
  }

  // ---- APK download (streamed from R2) ----
  if (request.method === "GET" && p.startsWith("/store/apks/")) {
    const key = "store/apks/" + p.slice("/store/apks/".length);
    const obj = env.aaa_assets ? await env.aaa_assets.get(key) : null;
    if (!obj) return new Response("Not found", { status: 404 });
    // Only serve if the app is approved (look up by key).
    const id = key.replace(/^store\/apks\//, "").replace(/\.apk$/, "");
    const a = await dbGetApp(env, id);
    if (!a || a.status !== "approved") return new Response("Not available", { status: 403 });
    await dbIncDownloads(env, id);
    return new Response(obj.body, {
      headers: {
        "content-type": "application/vnd.android.package-archive",
        "content-disposition": 'attachment; filename="' + (a.name || "app") + '.apk"',
        "cache-control": "public, max-age=300",
      },
    });
  }

  return null; // not a store route
}

function publicApp(a) {
  return {
    id: a.id, name: a.name, category: a.category, short_desc: a.short_desc,
    long_desc: a.long_desc, icon_url: a.icon_url, version: a.version,
    min_android: a.min_android, downloads: a.downloads, apk_url: a.apk_url,
    owner_uid: a.owner_uid,
  };
}

export default {
  async fetch(request, env, ctx) {
    ENV = env || {};
    const res = await handleStore(request, env);
    if (res) return res;
    return new Response("Ari AI App Store.", { headers: { "content-type": "text/plain" } });
  },
};
