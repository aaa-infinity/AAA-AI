// Worker 2 — aaa-store: public App Store + downloads + store API.
// Shares D1/R2/KV with Worker 1 (aaa-ai-bot). Auth/sessions are cross-worker
// because the session token is just a KV key both workers can read.
import {
  STORE_CATEGORIES, dbUpsertUser, dbGetUser, dbInsertApp, dbGetApp, dbGetAppByPackage,
  dbUpdateAppStatus, dbSupersede, dbIncDownloads, dbListApps,
  pushPending, removePending, getPendingList, createSession, getSessionUid,
  requireUser, aiGenerateListing, aiModerate, storePage, storeDetailPage,
  uploadPage, loginPage, downloadPage, escapeHtml, json, dbAddRating, dbGetRatings, dbVersionHistory,
} from "./storeShared.js";
import { askAi, adminAi, verifyTelegramWidget, adminChannelNotify } from "./index.js";

let ENV = {};

async function requireAdmin(request, env) {
  const { uid, error } = await requireUser(request, env);
  if (error) return { error };
  const u = await dbUpsertUser(env, { uid }); // ensures row exists
  if (!u || !u.is_admin) return { error: json({ ok: false, error: "forbidden" }, 403) };
  return { uid };
}

// Notify the app owner (via the Login bot) about a moderation decision.
async function notifyOwner(env, appId, decision, message) {
  if (!env.AAA_DB || !env.LOGIN_BOT_TOKEN) return;
  try {
    const a = await env.AAA_DB.prepare("SELECT owner_uid, name FROM store_apps WHERE id = ?").bind(appId).first();
    if (!a) return;
    const u = await dbGetUser(env, a.owner_uid);
    const tg = u && u.telegram_id;
    if (!tg) return;
    const txt = decision === "approved"
      ? "✅ Your app <b>" + (a.name || "app") + "</b> was approved and is now live on the AAA App Store!\n" + (message || "")
      : "⚠️ Your app <b>" + (a.name || "app") + "</b> was not published.\nReason: " + (message || "did not pass review.");
    await fetch("https://api.telegram.org/bot" + env.LOGIN_BOT_TOKEN + "/sendMessage", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: tg, text: txt, parse_mode: "HTML" }),
    }).catch(() => {});
  } catch (e) {}
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
    // Fetch all approved apps; client-side tabs handle category/search filtering.
    const list = await dbListApps(env, { status: "approved", category: "", q: "", page: 0 });
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
      authUrl: origin + "/api/store/widget-verify?next=" + encodeURIComponent(url.searchParams.get("next") || "/store"),
      next: url.searchParams.get("next") || "/store",
    }), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (request.method === "GET" && (p === "/download" || p === "/download/")) {
    const token = request.headers.get("x-session") || "";
    const uid = await getSessionUid(env, token);
    const user = uid ? await dbUpsertUser(env, { uid }) : null;
    return new Response(downloadPage(user), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
  }
  // ---- Profile page (full Telegram details) ----
  if (request.method === "GET" && (p === "/store/me" || p === "/store/me/")) {
    const token = request.headers.get("x-session") || "";
    const uid = await getSessionUid(env, token);
    if (!uid) {
      const origin = env.PUBLIC_ORIGIN || "https://aaa-store.aaateam.workers.dev";
      return Response.redirect(origin + "/store/login?next=" + encodeURIComponent("/store/me"), 302);
    }
    const user = await dbUpsertUser(env, { uid });
    return new Response(profilePage(user), { headers: { "content-type": "text/html; charset=utf-8" } });
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
    await dbUpsertUser(env, { uid, fromTg: true, username: profile?.username || "", display_name: profile?.display_name || "", first_name: profile?.first_name || "", last_name: profile?.last_name || "", photo_url: profile?.photo_url || "", language_code: profile?.language_code || "", is_premium: profile?.is_premium, phone: profile?.phone || "", is_admin: false });
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
    await dbUpsertUser(env, { uid, fromTg: true, username: body.username || "", display_name: (body.first_name || "") + " " + (body.last_name || ""), first_name: body.first_name || "", last_name: body.last_name || "", photo_url: body.photo_url || "", language_code: body.language_code || "", is_premium: !!body.is_premium, phone: body.phone || "", is_admin: false });
    const token = await createSession(env, uid);
    const user = { uid, username: body.username, first_name: body.first_name, last_name: body.last_name, photo_url: body.photo_url };
    // Return to the page the user was trying to reach (e.g. a download or /store/me).
    const next = (url.searchParams.get("next") || "/store");
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
      'var t=' + JSON.stringify(token) + ';var u=' + JSON.stringify(user) + ';var n=' + JSON.stringify(next) + ';' +
      'try{localStorage.setItem("sess",t);localStorage.setItem("sessUser",JSON.stringify(u));}catch(e){}' +
      'try{if(window.opener)window.opener.postMessage({type:"tg-store-login",token:t,user:u},"*");}catch(e){}' +
      'try{parent.postMessage({type:"tg-store-login",token:t,user:u},"*");}catch(e){}' +
      'try{if(window.TgLoginBridge)window.TgLoginBridge.onResult(JSON.stringify({token:t,user:u}));}catch(e){}' +
      'document.write("✅ Signed in as "+(u.username||u.uid)+". Redirecting…");' +
      'setTimeout(function(){try{if(window.opener||window.parent!==window){window.close();}else{location.href=n;}}catch(e){location.href=n;}},700);' +
      '</script></body></html>';
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (request.method === "POST" && p === "/api/store/logout") {
    const token = request.headers.get("x-session") || "";
    if (token && env.AAA_KV) await env.AAA_KV.delete("sess:" + token).catch(function () {});
    return json({ ok: true });
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

    // AI enrich listing (fail-soft): descriptions, category, tags, SEO tagline.
    let short_desc = (fields.short_desc || "").trim();
    let long_desc = (fields.long_desc || "").trim();
    let finalCategory = category;
    let aiTags = "", aiSeo = "";
    const ai = await aiGenerateListing(askAi, name, short_desc, long_desc);
    if (ai) {
      if (!short_desc && ai.short_desc) short_desc = ai.short_desc;
      if (!long_desc && ai.long_desc) long_desc = ai.long_desc;
      if (ai.category && STORE_CATEGORIES.includes(ai.category)) finalCategory = ai.category;
      if (ai.tags) aiTags = ai.tags;
      if (ai.seo) aiSeo = ai.seo;
    }

    const id = "app_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    await dbInsertApp(env, {
      id, owner_uid: uid, name, package_name: (fields.package_name || "").trim() || null,
      version: (fields.version || "").trim(), category: finalCategory,
      short_desc, long_desc, icon_url: (fields.icon_url || "").trim() || null,
      apk_url, apk_r2_key, apk_size, min_android: (fields.min_android || "").trim(),
      status: "pending",
    });
    // Persist AI-generated tags / SEO so the store can surface them.
    await env.AAA_DB.prepare("UPDATE store_apps SET tags=?, seo=? WHERE id=?")
      .bind(aiTags, aiSeo, id).run();

    // AI moderation pre-check (structured decision).
    const moderation = await aiModerate(adminAi, { name, short_desc, long_desc, category: finalCategory, apk_url, icon_url: fields.icon_url });
    await env.AAA_DB.prepare("UPDATE store_apps SET moderation = ? WHERE id = ?").bind(JSON.stringify(moderation), id).run();

    await env.AAA_KV?.put(rlKey, String(used + 1), { expirationTtl: 3600 });

    // AI-managed store: auto-approve clearly safe apps; auto-reject spam;
    // everything else waits for light human review.
    if (moderation.decision === "reject") {
      const why = (moderation.reasons || []).join("; ");
      await dbUpdateAppStatus(env, id, "rejected", "AI auto-review: " + why);
      await notifyOwner(env, id, "rejected", why);
      return json({ ok: false, error: "rejected by automated review: " + why }, 422);
    }
    if (moderation.decision === "approve" && moderation.auto_approve) {
      // Supersede any previously-approved same package.
      if ((fields.package_name || "").trim()) {
        const prev = await dbGetAppByPackage(env, fields.package_name.trim());
        if (prev && prev.id !== id && prev.status === "approved") await dbSupersede(env, prev.id, id);
      }
      await dbUpdateAppStatus(env, id, "approved", "AI auto-approved");
      await notifyOwner(env, id, "approved", "Your app passed automated review and is now live.");
      return json({ ok: true, id: id, status: "approved", auto: true, moderation: moderation });
    }
    // Otherwise: queue for human review.
    await pushPending(env, id);
    if (env.ADMIN_BOT_TOKEN && env.ADMIN_CHAT_ID) {
      const why = (moderation.reasons || []).join("; ");
      await fetch("https://api.telegram.org/bot" + env.ADMIN_BOT_TOKEN + "/sendMessage", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: env.ADMIN_CHAT_ID, text: "📦 New app: " + name + " [" + finalCategory + "]\nAI: " + (moderation.decision) + " (" + moderation.risk_score + "/100)" + (why ? " — " + why : "") + "\nReview: /review" }),
      }).catch(() => {});
    }
    adminChannelNotify(env, "New App Submission", {
      "Name": name, "Category": finalCategory, "ID": id,
      "AI Decision": moderation.decision + " (" + moderation.risk_score + "/100)",
    }).catch(function () {});
    return json({ ok: true, id: id, status: "pending", moderation: moderation });
  }
  if (request.method === "POST" && p.match(/\/api\/store\/apps\/[^/]+\/approve$/)) {
    const { error } = await requireAdmin(request, env);
    if (error) return error;
    const id = p.split("/")[4];
    const a = await dbGetApp(env, id);
    if (!a) return json({ ok: false, error: "not found" }, 404);
    // Remove every older approved/superseded version of the same package so only
    // this (latest) version remains live. Previous versions are deleted entirely.
    if (a.package_name) {
      const rows = await env.AAA_DB.prepare(
        "SELECT id FROM store_apps WHERE package_name = ? AND id != ? AND status IN ('approved','superseded')"
      ).bind(a.package_name, id).all();
      for (const r of (rows && rows.results) || []) await dbSupersede(env, r.id, id);
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

  // ---- Rate an app (logged-in store user) ----
  if (request.method === "POST" && p.match(/\/api\/store\/apps\/[^/]+\/rate$/)) {
    const token = request.headers.get("x-session") || "";
    const uid = await getSessionUid(env, token);
    if (!uid) return json({ ok: false, error: "sign in required" }, 401);
    const id = p.split("/")[4];
    const body = await request.json().catch(() => ({}));
    const stars = Math.max(1, Math.min(5, parseInt(body.stars, 10) || 5));
    const ok = await dbAddRating(env, id, uid, stars, body.review || "");
    return json({ ok: ok });
  }

  // ---- Static asset serving from R2 (logos, icons, etc.) ----
  if (request.method === "GET" && p.startsWith("/api/asset/")) {
    const key = decodeURIComponent(p.slice("/api/asset/".length));
    const obj = env.aaa_assets ? await env.aaa_assets.get(key) : null;
    if (!obj) return new Response("Not found", { status: 404 });
    const body = await obj.arrayBuffer();
    return new Response(body, {
      headers: {
        "content-type": (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream",
        "cache-control": "public, max-age=86400",
      },
    });
  }

  // ---- APK download (streamed from R2) — login required ----
  if (request.method === "GET" && p.startsWith("/store/apks/")) {
    const id = decodeURIComponent(p.slice("/store/apks/".length).replace(/\.apk$/, ""));
    const token = request.headers.get("x-session") || "";
    const uid = await getSessionUid(env, token);
    // Gate downloads behind a Telegram login so only verified users can fetch APKs.
    if (!uid) {
      const origin = env.PUBLIC_ORIGIN || "https://aaa-store.aaateam.workers.dev";
      return Response.redirect(origin + "/store/login?next=" + encodeURIComponent(p), 302);
    }
    const a = await dbGetApp(env, id);
    if (!a || a.status !== "approved") return new Response("Not available", { status: 403 });
    const key = a.apk_r2_key || ("store/apks/" + id + ".apk");
    const obj = env.aaa_assets ? await env.aaa_assets.get(key) : null;
    if (!obj) return new Response("Not found", { status: 404 });
    await dbIncDownloads(env, id);
    return new Response(obj.body, {
      headers: {
        "content-type": "application/vnd.android-package-archive",
        "content-disposition": 'attachment; filename="' + (a.name || "app") + '.apk"',
        "cache-control": "public, max-age=60",
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
    // Redirect any unknown path (incl. the old bare root) to the redesigned store.
    const origin = (env && env.PUBLIC_ORIGIN) || "https://aaa-store.aaateam.workers.dev";
    if (request.method === "GET") return Response.redirect(origin + "/store", 302);
    return new Response("Ari AI App Store.", { headers: { "content-type": "text/plain" } });
  },
};
