// ===========================================================================
// AAA App Store — fresh design system (built from scratch).
// Glassmorphism + gradient aesthetic, animated hero, and TABBED navigation:
//   • Home: tab bar (Featured · All · <Category> …) with client-side filtering
//   • Detail: tabbed panel (About · Reviews · Versions)
//   • Auth/Profile: clean centered cards
// Consumed by storeShared.js so both workers render the same site.
// ===========================================================================

const GRAD = "linear-gradient(135deg,#7c4dff 0%,#b14dff 45%,#ff4d9d 100%)";

// ---------------------------------------------------------------------------
// <head>
// ---------------------------------------------------------------------------
export function shellHead(title) {
  return '<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="theme-color" content="#0a0a14">' +
    '<link rel="icon" href="/api/asset/public/aaa-store-logo.png" type="image/png">' +
    '<title>' + title + '</title><style>' + tokens() + base() + '</style></head>';
}

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------
export function shellNav(user, opts) {
  opts = opts || {};
  const next = encodeURIComponent(opts.next || "/store");
  const chip = user
    ? '<a class="chip" href="/store/me" title="Your profile">' +
      (user.photo_url
        ? '<img class="av" src="' + e(user.photo_url) + '" alt="">'
        : '<span class="av av--i">' + e((user.display_name || user.tg_username || "U").slice(0, 1).toUpperCase()) + '</span>') +
      '<span class="chip-name">' + e(user.display_name || user.tg_username || user.uid) + (user.is_premium ? ' <span class="star">★</span>' : '') + '</span></a>'
    : '';
  return '<nav class="nav"><div class="wrap">' +
    '<a class="brand" href="/store"><span class="logo">A</span><span class="brand-tx">AA<span class="g">Store</span></span></a>' +
    '<div class="nav-act">' +
    '<button class="icn" onclick="toggleTheme()" title="Theme">◐</button>' +
    '<a class="icn fb" href="https://www.facebook.com/share/1BzWH5P2bF/" target="_blank" rel="noopener" aria-label="Facebook">f</a>' +
    '<a class="pill ghost" href="/download">Get app</a>' +
    (user ? '<a class="pill" href="/store/upload">+ Publish</a>'
          : '<a class="pill" href="/store/login?next=' + next + '">Sign in</a>') +
    chip +
    (user ? '<button class="icn" onclick="logout()" title="Sign out">⏻</button>' : '') +
    '</div></div></nav>';
}

export function shellFoot() {
  return '<footer class="foot"><div class="foot-grad"></div><div class="wrap foot-in">' +
    '<div><div class="brand"><span class="logo">A</span><span class="brand-tx">AA<span class="g">Store</span></span></div>' +
    '<p class="muted">The free, open Android app store. No Play Store required.</p></div>' +
    '<div class="foot-links"><a href="/store">Browse</a><a href="/download">Get the app</a>' +
    '<a href="/store/login">Sign in</a><a href="https://www.facebook.com/share/1BzWH5P2bF/" target="_blank" rel="noopener">Community</a></div>' +
    '</div><p class="copy">© ' + new Date().getFullYear() + ' AAA App Store · Built for the open Android community.</p></footer>';
}

export function shell(title, body, user, opts) {
  return shellHead(title) + '<body>' +
    '<script>try{var t=localStorage.getItem("theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>' +
    shellNav(user, opts) + '<main class="wrap">' + body + '</main>' + shellFoot() +
    '<script>function toggleTheme(){var h=document.documentElement;var c=h.getAttribute("data-theme")==="light"?"dark":"light";h.setAttribute("data-theme",c);try{localStorage.setItem("theme",c);}catch(e){}}' +
    'function logout(){try{var t=localStorage.getItem("sess");if(t){fetch("/api/store/logout",{method:"POST",headers:{"x-session":t}}).catch(function(){});}localStorage.removeItem("sess");localStorage.removeItem("sessUser");}catch(e){}location.href="/store";}</script>' +
    '</body></html>';
}

// ---------------------------------------------------------------------------
// HOME — with tab bar
// ---------------------------------------------------------------------------
export function homePage(list, categories, user) {
  const apps = list.apps || [];
  const cats = (categories && categories.length) ? categories : ["Game", "Tools", "Social", "Productivity", "Entertainment", "Education", "Finance", "Other"];
  // Tabs: Featured, All, then each category.
  const tabs = ['<button class="tab on" data-tab="featured">★ Featured</button>',
                '<button class="tab" data-tab="all">All</button>']
    .concat(cats.map((c) => '<button class="tab" data-tab="' + e(c) + '">' + e(c) + '</button>')).join('');
  // Cards rendered once; filtering done in JS via data-cat attribute.
  const cards = apps.length
    ? apps.map((a) => appCard(a)).join('')
    : '<div class="empty"><div class="emo">📦</div><h3>No apps yet</h3><p>Be the first to publish to the store.</p>' +
      '<a class="btn" href="' + (user ? '/store/upload' : '/store/login?next=' + enc('/store/upload')) + '">Publish an app</a></div>';
  const body =
    '<header class="hero"><div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div>' +
    '<span class="kicker">OPEN · FREE · ANDROID</span>' +
    '<h1>The app store built for <span class="g">everyone</span>.</h1>' +
    '<p class="lede">Discover Super AI and community-made Android apps — download in one tap, no Play Store, no limits.</p>' +
    '<div class="hero-cta"><a class="btn" href="' + (user ? '/store/upload' : '/store/login?next=' + enc('/store/upload')) + '">⬆ Publish your app</a>' +
    '<a class="btn ghost" href="/download">⬇ Get Super AI</a></div>' +
    '<form class="search" onsubmit="return doSearch(event)"><span class="si">🔍</span>' +
    '<input id="q" placeholder="Search apps, games, tools…" value="' + e(list.q || "") + '"></form></header>' +
    '<section class="browse">' +
    '<div class="tabs" id="tabs">' + tabs + '</div>' +
    '<div class="grid" id="grid" data-apps=\'' + e(JSON.stringify(apps.map((a) => ({ id: a.id, cat: a.category || "Other" })))) + '\'>' + cards + '</div>' +
    '<div class="empty" id="nores" style="display:none"><div class="emo">🔍</div><h3>Nothing here</h3><p>Try another tab or search.</p></div>' +
    '</section>' +
    '<script>' +
    'function doSearch(e){e.preventDefault();var v=document.getElementById("q").value.trim();' +
    'var grid=document.getElementById("grid");var apps=JSON.parse(grid.getAttribute("data-apps")||"[]");' +
    'filterGrid(apps,v,grid.getAttribute("data-tab")||"all");}' +
    'function filterGrid(apps,q,tab){var grid=document.getElementById("grid");var cards=grid.querySelectorAll(".card");var n=0;' +
    'cards.forEach(function(c){var id=c.getAttribute("data-id");var m=apps.find(function(a){return a.id===id;});var cat=m?m.cat:"Other";' +
    'var ok=(tab==="all"||tab==="featured"||cat===tab);var match=!q||c.textContent.toLowerCase().indexOf(q.toLowerCase())>-1;' +
    'var show=(tab==="featured")?c.classList.contains("feat"):(ok&&match);c.style.display=show?"":"none";if(show)n++;});' +
    'document.getElementById("nores").style.display=n?"none":"block";}' +
    'document.getElementById("tabs").addEventListener("click",function(ev){var b=ev.target.closest(".tab");if(!b)return;' +
    'this.querySelectorAll(".tab").forEach(function(x){x.classList.remove("on");});b.classList.add("on");' +
    'var tab=b.getAttribute("data-tab");document.getElementById("grid").setAttribute("data-tab",tab);' +
    'var apps=JSON.parse(document.getElementById("grid").getAttribute("data-apps")||"[]");filterGrid(apps,document.getElementById("q").value.trim(),tab);});' +
    '</script>';
  return shell("AAA App Store — Free Android apps", body, user);
}

// ---------------------------------------------------------------------------
// App card (includes data-cat + featured flag for tab filtering)
// ---------------------------------------------------------------------------
export function appCard(a) {
  const icon = a.icon_url || "/api/asset/public/aaa-store-logo.png";
  const isFeat = (a.id === "app_superai");
  return '<a class="card' + (isFeat ? ' feat' : '') + '" data-id="' + e(a.id) + '" href="/store/app/' + enc(a.id) + '">' +
    '<div class="card-ic"><img src="' + icon + '" alt="" loading="lazy" onerror="this.src=\'/api/asset/public/aaa-store-logo.png\'"></div>' +
    '<div class="card-cat">' + e(a.category || "Other") + (isFeat ? ' · ⭐ Flagship' : '') + '</div>' +
    '<h3>' + e(a.name) + '</h3><p>' + e(a.short_desc || "") + '</p>' +
    '<div class="card-meta">⬇ ' + (a.downloads || 0) + ' · v' + e(a.version || "?") + '</div></a>';
}

// ---------------------------------------------------------------------------
// DETAIL — with tabbed panel (About · Reviews · Versions)
// ---------------------------------------------------------------------------
export function detailPage(a, user, ratings, versions) {
  if (!a) return shell("Not found", '<div class="empty"><div class="emo">🔍</div><h3>App not found</h3><p>This app may have been removed.</p><a class="btn" href="/store">Back to store</a></div>', user);
  const icon = a.icon_url || "/api/asset/public/aaa-store-logo.png";
  const r = ratings || { avg: 0, count: 0, reviews: [] };
  const stars = "★★★★★".slice(0, Math.round(r.avg)) + "☆☆☆☆☆".slice(0, 5 - Math.round(r.avg));
  const verified = a.status === "approved" ? '<span class="badge ok">✓ Verified</span>' : '';
  const reviews = (r.reviews || []).slice(0, 20).map((rv) => {
    const s = "★★★★★".slice(0, rv.stars || 5);
    return '<div class="review"><div class="r-stars">' + s + '</div>' +
      (rv.review ? '<p>' + e(rv.review) + '</p>' : '') + '<div class="r-uid">' + e(rv.uid || "anon") + '</div></div>';
  }).join('');
  const verBlock = (versions && versions.length)
    ? versions.map((v) => '<div class="ver"><b>v' + e(v.version) + '</b>' +
        (v.size ? ' · ' + Math.round(v.size / 1048576) + ' MB' : '') +
        (v.changelog ? '<div class="muted">' + e(v.changelog) + '</div>' : '') + '</div>').join('')
    : '<p class="muted">No version history yet.</p>';
  const rateForm = user
    ? '<div class="stars" id="stars">' + [1,2,3,4,5].map((n) => '<button type="button" data-n="' + n + '" onclick="setStars(' + n + ')">★</button>').join('') + '</div>' +
      '<textarea id="rv" placeholder="Write a review (optional)…"></textarea>' +
      '<button class="btn sm" onclick="postRate()">Submit rating</button><p id="rmsg" class="rmsg"></p>' +
      '<script>var _st=5;function setStars(n){_st=n;document.querySelectorAll("#stars button").forEach(function(x,i){x.classList.toggle("on",i<n);});}setStars(5);' +
      'function postRate(){var rv=document.getElementById("rv").value;fetch("/api/store/apps/' + enc(a.id) + '/rate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({stars:_st,review:rv})}).then(function(r){return r.json();}).then(function(j){document.getElementById("rmsg").textContent=j.ok?"Thanks!":"Failed";setTimeout(function(){location.reload();},800);});}</script>'
    : '<p class="muted center">Sign in to rate this app.</p>';
  const dlHref = a.apk_r2_key ? ("/store/apks/" + enc(a.apk_r2_key.replace(/^store\/apks\//, "").replace(/\.apk$/, "")) + ".apk")
    : (a.apk_url || "");
  const dlBtn = dlHref
    ? (user
        ? '<a class="btn dl" href="' + e(dlHref) + (a.apk_url && !a.apk_r2_key ? '" target="_blank" rel="noopener' : '') + '">⬇ Download APK</a>'
        : '<a class="btn dl" href="/store/login?next=' + enc(dlHref) + '">🔐 Sign in to download</a>')
    : '<span class="btn dl" style="opacity:.6">Download unavailable</span>';
  const body =
    '<article class="detail"><a class="back" href="/store">‹ Back</a>' +
    '<header class="d-head"><img class="d-ic" src="' + icon + '" alt="" onerror="this.src=\'/api/asset/public/aaa-store-logo.png\'">' +
    '<div><h1>' + e(a.name) + '</h1><div class="d-sub">' + e(a.category || "Other") + ' · v' + e(a.version || "?") + ' ' + verified + '</div>' +
    '<div class="d-stars">' + stars + ' <span class="muted">' + r.avg + ' · ' + r.count + ' rating' + (r.count === 1 ? '' : 's') + '</span></div></div>' +
    dlBtn + '</header>' +
    // Tabs
    '<div class="tabs det-tabs" id="dtabs">' +
    '<button class="tab on" data-d="about">About</button>' +
    '<button class="tab" data-d="reviews">Reviews (' + r.count + ')</button>' +
    '<button class="tab" data-d="versions">Versions</button></div>' +
    '<div class="panel" id="p-about"><p class="d-desc">' + e(a.long_desc || a.short_desc || "No description provided.") + '</p>' +
    '<div class="rate-box"><h3>Rate &amp; review</h3>' + rateForm + '</div></div>' +
    '<div class="panel" id="p-reviews" style="display:none"><h3>Reviews</h3><div class="reviews">' + (reviews || '<p class="muted">No reviews yet.</p>') + '</div></div>' +
    '<div class="panel" id="p-versions" style="display:none"><h3>Version history</h3>' + verBlock + '</div>' +
    '<script>document.getElementById("dtabs").addEventListener("click",function(ev){var b=ev.target.closest(".tab");if(!b)return;' +
    'this.querySelectorAll(".tab").forEach(function(x){x.classList.remove("on");});b.classList.add("on");' +
    '["about","reviews","versions"].forEach(function(k){document.getElementById("p-"+k).style.display=k===b.getAttribute("data-d")?"block":"none";});});</script>' +
    '</article>';
  return shell(a.name + " — AAA App Store", body, user);
}

// ---------------------------------------------------------------------------
// DOWNLOAD landing
// ---------------------------------------------------------------------------
export function downloadPage(available, versionName, sizeLabel, stats, changelog, qr) {
  const st = stats || {};
  const body =
    '<header class="hero sm"><div class="orb o1"></div><div class="orb o2"></div>' +
    '<div class="dl-logo">🤖</div><h1>Get <span class="g">Super AI</span></h1>' +
    '<p class="lede">The free all-in-one AI app for Android. Chat, create, download — all in one tap.</p>' +
    (available
      ? '<div class="dl-card"><div class="dl-info"><div class="dl-ver">v' + e(versionName || "2.2.14") + (sizeLabel ? ' · ' + e(sizeLabel) : '') + '</div>' +
        '<div class="dl-stats"><span>⬇ ' + (st.downloads || 0) + ' downloads</span><span>⭐ ' + (st.stars || 0) + ' rating</span></div></div>' +
        '<div class="dl-qr">' + (qr ? '<img src="' + qr + '" alt="QR">' : '') + '<span>Scan to install</span></div></div>' +
        '<a class="btn big" href="/store/apks/app_superai.apk">⬇ Download APK</a>'
      : '<div class="dl-card"><div class="muted">Download temporarily unavailable. Please try again soon.</div></div>') +
    (changelog ? '<details class="chg"><summary>What\'s new</summary><p>' + e(changelog) + '</p></details>' : '') +
    '</header>' +
    '<section class="steps">' +
    step(1, "Download the APK", "Tap the button above and save the file to your phone.") +
    step(2, "Allow unknown sources", "Open the file, then enable “Install unknown apps” for your browser when prompted.") +
    step(3, "Install & enjoy", "Open Super AI, sign in with Telegram, and start creating.") +
    '</section>';
  return shell("Download Super AI — AAA App Store", body, null);
}

function step(n, t, d) {
  return '<div class="step"><div class="n">' + n + '</div><div><h4>' + e(t) + '</h4><p>' + e(d) + '</p></div></div>';
}

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------
export function loginPage(opts) {
  opts = opts || {};
  const bot = opts.botUsername || "AAA_Login_bot";
  const verifyUrl = opts.authUrl || ((opts.botOrigin || "https://aaa-ai-bot.aaateam.workers.dev") + "/api/telegram-widget-verify");
  const next = opts.next || "/store";
  const body =
    '<div class="auth"><div class="auth-card"><div class="auth-glow"></div><h2>Welcome back</h2>' +
    '<p class="muted">Sign in with Telegram to publish apps and manage your profile.</p>' +
    '<div class="tg"><script async src="https://telegram.org/js/telegram-widget.js?22" ' +
    'data-telegram-login="' + e(bot) + '" data-size="large" data-userpic="false" data-radius="16" ' +
    'data-auth-url="' + e(verifyUrl) + '" data-request-access="write"></script></div>' +
    '<div class="div">or</div><label>Telegram link code</label>' +
    '<p class="hint">Open Super AI → Profile → Link Telegram, copy the code, paste below.</p>' +
    '<input id="code" placeholder="ABC123" maxlength="12" autocomplete="off">' +
    '<button class="btn" id="codeBtn">Verify code</button><p id="msg" class="msg"></p></div>' +
    '<script>var NEXT=' + JSON.stringify(next) + ';' +
    'function saveSess(t){try{localStorage.setItem("sess",t);}catch(e){}}' +
    'window.addEventListener("message",function(ev){if(ev.data&&ev.data.type==="tg-store-login"&&ev.data.token){saveSess(ev.data.token);location.href=NEXT;}});' +
    'document.getElementById("codeBtn").addEventListener("click",function(){' +
    'var c=document.getElementById("code").value.trim();if(!c){document.getElementById("msg").textContent="Enter a code.";return;}' +
    'fetch("/api/store/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:c})}).then(function(r){return r.json();}).then(function(j){if(j.ok){saveSess(j.token);location.href=NEXT;}else{document.getElementById("msg").textContent=j.error||"Invalid code.";}});});</script>' +
    '</div>';
  return shell("Sign in — AAA App Store", body, null);
}

// ---------------------------------------------------------------------------
// UPLOAD
// ---------------------------------------------------------------------------
export function uploadPage(user) {
  if (!user) return shell("Sign in required", '<div class="empty"><div class="emo">🔒</div><h3>Please sign in</h3><p>You need a Telegram account to publish apps.</p><a class="btn" href="/store/login?next=' + enc('/store/upload') + '">Sign in</a></div>', null);
  const cats = ["Game", "Tools", "Social", "Productivity", "Entertainment", "Education", "Finance", "Other"];
  const body =
    '<div class="auth wide"><div class="auth-card"><h2>Publish an app</h2>' +
    '<p class="muted">Share your Android app with the community.</p>' +
    '<form id="up" class="up" onsubmit="return submitApp(event)">' +
    fld("App name", '<input id="name" required placeholder="My awesome app">') +
    fld("Package name", '<input id="package_name" placeholder="com.example.app">') +
    fld("Category", '<select id="category">' + cats.map((c) => '<option>' + e(c) + '</option>').join('') + '</select>') +
    fld("Version", '<input id="version" placeholder="1.0.0">') +
    fld("Short description", '<input id="short_desc" maxlength="120" placeholder="One line about your app">') +
    fld("Full description", '<textarea id="long_desc" rows="4" placeholder="Tell users what it does…"></textarea>') +
    fld("APK URL (external link)", '<input id="apk_url" placeholder="https://… .apk">') +
    fld("Icon URL", '<input id="icon_url" placeholder="https://… .png">') +
    '<button class="btn" type="submit">Submit for review</button><p id="umsg" class="msg"></p></form>' +
    '<script>function submitApp(e){e.preventDefault();var d={name:name.value,package_name:package_name.value,category:category.value,version:version.value,short_desc:short_desc.value,long_desc:long_desc.value,apk_url:apk_url.value,icon_url:icon_url.value};' +
    'fetch("/api/store/apps",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(d)}).then(function(r){return r.json();}).then(function(j){document.getElementById("umsg").textContent=j.ok?"Submitted! Awaiting review.":("Error: "+(j.error||"unknown"));});return false;}</script>' +
    '</div></div>';
  return shell("Publish — AAA App Store", body, user);
}

// ---------------------------------------------------------------------------
// PROFILE
// ---------------------------------------------------------------------------
export function profilePage(user) {
  if (!user) return shell("Profile", '<div class="empty"><div class="emo">🔒</div><h3>Not signed in</h3><a class="btn" href="/store/login?next=' + enc('/store/me') + '">Sign in</a></div>', null);
  const avatar = user.photo_url ? '<img class="p-av" src="' + e(user.photo_url) + '" alt="">'
    : '<div class="p-av p-av--i">' + e((user.display_name || user.tg_username || "U").slice(0, 1).toUpperCase()) + '</div>';
  const tg = user.telegram_id;
  const rows = [
    ["Telegram ID", tg ? e(String(tg)) : '<span class="muted">not linked</span>'],
    ["Account UID", e(user.uid || "")],
    ["Username", user.tg_username ? "@" + e(user.tg_username) : '<span class="muted">—</span>'],
    ["First name", user.first_name ? e(user.first_name) : '<span class="muted">—</span>'],
    ["Last name", user.last_name ? e(user.last_name) : '<span class="muted">—</span>'],
    ["Premium", user.is_premium ? "★ Yes" : "No"],
    ["Language", user.language_code ? e(user.language_code) : '<span class="muted">—</span>'],
    ["Phone", user.phone ? e(user.phone) : '<span class="muted">—</span>'],
  ];
  const body =
    '<div class="auth wide"><div class="auth-card"><div class="p-head">' + avatar +
    '<div><div class="p-name">' + e(user.display_name || user.tg_username || user.uid || "User") + (user.is_premium ? ' <span class="star">★</span>' : '') + '</div>' +
    '<div class="p-sub">' + (user.tg_username ? "@" + e(user.tg_username) : e(user.uid || "")) + '</div></div></div>' +
    '<div class="kv">' + rows.map((r) => '<div class="kv-row"><div class="k">' + r[0] + '</div><div class="v">' + r[1] + '</div></div>').join('') + '</div>' +
    '<a class="btn ghost" href="/store" style="margin-top:18px">← Back to store</a></div></div>';
  return shell("Your profile — AAA App Store", body, user);
}

// ===========================================================================
// Design tokens + CSS
// ===========================================================================
function tokens() {
  return ':root{color-scheme:dark;' +
    '--bg:#07070f;--bg2:#0d0d1a;--fg:#f4f4fb;--muted:#9a9ab2;--card:rgba(255,255,255,.045);' +
    '--card2:rgba(255,255,255,.07);--border:rgba(255,255,255,.09);--input:rgba(255,255,255,.06);' +
    '--brand:#7c4dff;--brand2:#ff4d9d;--grad:linear-gradient(135deg,#7c4dff,#ff4d9d);' +
    '--glow:rgba(124,77,255,.45);--radius:20px;--maxw:1120px;--shadow:0 18px 50px rgba(0,0,0,.45);}' +
    'html[data-theme="light"]{--bg:#f5f6fc;--bg2:#fff;--fg:#16162a;--muted:#5d5d78;' +
    '--card:rgba(20,20,50,.04);--card2:rgba(20,20,50,.07);--border:rgba(20,20,50,.12);--input:rgba(20,20,50,.05);--shadow:0 18px 50px rgba(80,60,160,.12);}' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);line-height:1.6;-webkit-font-smoothing:antialiased;transition:background .25s,color .25s;overflow-x:hidden}' +
    'a{color:inherit;text-decoration:none}.wrap{max-width:var(--maxw);margin:0 auto;padding:0 22px}' +
    '.muted{color:var(--muted)}.center{text-align:center}.g{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}';
}

function base() {
  return '' +
    // Nav
    '.nav{position:sticky;top:0;z-index:40;backdrop-filter:blur(14px);background:color-mix(in srgb,var(--bg) 72%,transparent);border-bottom:1px solid var(--border)}' +
    '.nav .wrap{display:flex;align-items:center;justify-content:space-between;padding:14px 22px}' +
    '.brand{display:flex;align-items:center;gap:10px;font-weight:900;font-size:1.15rem;letter-spacing:-.02em}' +
    '.logo{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--grad);color:#fff;font-weight:900;box-shadow:0 6px 18px var(--glow)}' +
    '.brand-tx .g{font-weight:900}.nav-act{display:flex;align-items:center;gap:10px}' +
    '.icn{width:38px;height:38px;border-radius:50%;border:1px solid var(--border);background:var(--input);color:var(--fg);cursor:pointer;font-size:1.05rem;transition:.18s;display:flex;align-items:center;justify-content:center}' +
    '.icn:hover{border-color:var(--brand);transform:translateY(-1px)}.fb{color:#9db4ff;font-weight:900}' +
    '.pill{background:var(--grad);color:#fff;font-weight:700;font-size:.88rem;padding:10px 18px;border-radius:50px;transition:.18s;white-space:nowrap}' +
    '.pill:hover{transform:translateY(-2px);box-shadow:0 10px 26px var(--glow)}.pill.ghost{background:var(--input);border:1px solid var(--border);color:var(--fg)}' +
    '.chip{display:flex;align-items:center;gap:8px;background:var(--input);border:1px solid var(--border);border-radius:50px;padding:5px 12px 5px 5px;font-weight:600;font-size:.85rem;transition:.18s}' +
    '.chip:hover{border-color:var(--brand)}.chip .av{width:28px;height:28px;border-radius:50%;object-fit:cover}' +
    '.chip .av--i{display:flex;align-items:center;justify-content:center;background:var(--grad);color:#fff;font-weight:800;font-size:.8rem}' +
    '.chip-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.star{color:#ffd54a}' +
    // Buttons
    '.btn{display:inline-flex;align-items:center;gap:8px;justify-content:center;background:var(--grad);color:#fff;font-weight:700;padding:14px 28px;border-radius:50px;border:none;cursor:pointer;transition:.18s;box-shadow:0 10px 30px rgba(124,77,255,.3)}' +
    '.btn:hover{transform:translateY(-2px);box-shadow:0 16px 40px var(--glow)}.btn.ghost{background:var(--input);border:1px solid var(--border);color:var(--fg);box-shadow:none}' +
    '.btn.sm{padding:10px 18px;font-size:.85rem}.btn.big{padding:16px 40px;font-size:1.05rem}' +
    // Hero
    '.hero{position:relative;text-align:center;padding:88px 22px 56px;overflow:hidden}' +
    '.hero.sm{padding:70px 22px 40px}' +
    '.orb{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55;z-index:0;animation:float 9s ease-in-out infinite}' +
    '.o1{width:340px;height:340px;background:#7c4dff;top:-120px;left:8%}.o2{width:300px;height:300px;background:#ff4d9d;top:-80px;right:6%;animation-delay:1.5s}.o3{width:240px;height:240px;background:#4dd2ff;top:40px;left:45%;opacity:.35;animation-delay:3s}' +
    '@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(26px)}}' +
    '.hero>*{position:relative;z-index:1}' +
    '.kicker{display:inline-block;font-size:.72rem;font-weight:800;letter-spacing:.22em;color:var(--muted);border:1px solid var(--border);padding:6px 14px;border-radius:50px;margin-bottom:18px}' +
    '.hero h1{font-size:clamp(2.2rem,6vw,3.6rem);font-weight:900;letter-spacing:-.03em;line-height:1.05}' +
    '.lede{color:var(--muted);max-width:600px;margin:16px auto 26px;font-size:1.05rem}' +
    '.hero-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}' +
    '.search{display:flex;align-items:center;gap:10px;max-width:520px;margin:30px auto 0;background:var(--input);border:1px solid var(--border);border-radius:50px;padding:6px 18px;transition:.18s}' +
    '.search:focus-within{border-color:var(--brand);box-shadow:0 0 0 4px rgba(124,77,255,.15)}' +
    '.search .si{opacity:.6}.search input{flex:1;background:none;border:none;outline:none;color:var(--fg);padding:12px 0;font-size:1rem}' +
    // Tabs
    '.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:30px 0 8px}' +
    '.tab{background:var(--input);border:1px solid var(--border);color:var(--fg);padding:10px 18px;border-radius:50px;font-size:.9rem;cursor:pointer;transition:.16s;font-weight:600;white-space:nowrap}' +
    '.tab:hover{border-color:var(--brand)}.tab.on{background:var(--grad);border-color:transparent;color:#fff}' +
    // Grid + cards
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px;margin-top:24px}' +
    '.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;transition:.2s;display:block}' +
    '.card:hover{transform:translateY(-5px);border-color:var(--brand);box-shadow:var(--shadow)}' +
    '.card.feat{border-color:rgba(124,77,255,.45);background:linear-gradient(135deg,rgba(124,77,255,.12),rgba(255,77,157,.1))}' +
    '.card-ic{width:64px;height:64px;border-radius:16px;overflow:hidden;background:var(--card2)}.card-ic img{width:100%;height:100%;object-fit:cover}' +
    '.card-cat{font-size:.7rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#b9a4ff;margin:14px 0 6px}' +
    '.card h3{font-size:1.1rem;margin-bottom:6px}.card p{color:var(--muted);font-size:.88rem;min-height:40px}' +
    '.card-meta{color:var(--muted);font-size:.78rem;margin-top:12px}' +
    '.empty{text-align:center;padding:70px 20px}.empty .emo{font-size:3rem;margin-bottom:10px}.empty h3{font-size:1.4rem;margin-bottom:8px}.empty .btn{margin-top:16px}' +
    // Detail
    '.detail{max-width:780px;margin:24px auto 40px}.back{color:var(--muted);font-weight:600}.back:hover{color:var(--fg)}' +
    '.d-head{display:flex;align-items:center;gap:20px;margin:18px 0;flex-wrap:wrap}' +
    '.d-ic{width:104px;height:104px;border-radius:24px;object-fit:cover;box-shadow:0 10px 30px var(--glow)}' +
    '.d-head h1{font-size:1.9rem;font-weight:900}.d-sub{color:var(--muted);margin:4px 0 8px;font-size:.9rem}' +
    '.d-stars{color:#ffd54a;font-size:1.1rem}.badge.ok{display:inline-block;margin-left:8px;font-size:.7rem;font-weight:800;color:#7CFC9B;background:rgba(124,252,155,.12);border:1px solid rgba(124,252,155,.3);padding:3px 8px;border-radius:50px;vertical-align:middle}' +
    '.d-head .dl{margin-left:auto}.d-desc{color:var(--muted);margin:18px 0;white-space:pre-wrap}' +
    '.det-tabs{margin-top:26px}' +
    '.panel{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:22px;margin:14px 0}' +
    '.panel h3{font-size:1.1rem;margin-bottom:14px}' +
    '.rate-box{margin-top:18px;border-top:1px solid var(--border);padding-top:18px}' +
    '.rate-box .stars{font-size:1.6rem;color:#3a3a4a;margin-bottom:10px}.rate-box .stars button{background:none;border:none;cursor:pointer;color:#3a3a4a;font-size:1.6rem;transition:.12s}' +
    '.rate-box .stars button.on{color:#ffd54a}.rate-box textarea{width:100%;background:var(--input);border:1px solid var(--border);color:var(--fg);border-radius:12px;padding:12px;font-family:inherit;resize:vertical}' +
    '.rmsg{color:#7CFC9B;margin-top:8px;font-size:.9rem}.reviews{display:grid;gap:12px}' +
    '.review{background:var(--input);border:1px solid var(--border);border-radius:12px;padding:14px}.r-stars{color:#ffd54a}.review p{margin:6px 0;font-size:.92rem}.r-uid{color:var(--muted);font-size:.74rem}' +
    '.ver{padding:10px 0;border-top:1px solid var(--border)}.ver:first-child{border-top:none}' +
    // Auth / forms
    '.auth{display:flex;justify-content:center;padding:60px 22px}.auth.wide{display:block;max-width:680px;margin:0 auto}' +
    '.auth-card{position:relative;width:100%;max-width:440px;background:var(--card);border:1px solid var(--border);border-radius:24px;padding:32px;text-align:center;box-shadow:var(--shadow);overflow:hidden}' +
    '.auth-glow{position:absolute;top:-60px;left:50%;transform:translateX(-50%);width:240px;height:240px;background:var(--grad);filter:blur(70px);opacity:.4}' +
    '.auth-card>*{position:relative;z-index:1}.auth-card h2{font-size:1.7rem;font-weight:900;margin-bottom:6px}.auth-card .muted{margin-bottom:18px}' +
    '.tg{margin:18px 0}.div{color:var(--muted);margin:14px 0;font-size:.85rem}.auth-card label{display:block;text-align:left;font-weight:600;margin:14px 0 6px}.hint{color:var(--muted);font-size:.82rem;text-align:left;margin-bottom:8px}' +
    '.auth-card input{width:100%;background:var(--input);border:1px solid var(--border);color:var(--fg);padding:13px 16px;border-radius:12px;outline:none;font-size:1rem;text-align:center;letter-spacing:2px;text-transform:uppercase}.auth-card input:focus{border-color:var(--brand)}' +
    '.auth-card .btn{width:100%;margin-top:14px}.msg{color:#ff9b9b;margin-top:10px;font-size:.9rem;min-height:18px}' +
    '.up label{display:block;text-align:left;font-weight:600;margin:14px 0 6px;color:var(--muted);font-size:.9rem}.up input,.up textarea,.up select{width:100%;background:var(--input);border:1px solid var(--border);color:var(--fg);padding:12px 14px;border-radius:12px;outline:none;font-family:inherit}' +
    // Profile
    '.p-head{display:flex;align-items:center;gap:18px;margin-bottom:22px}.p-av{width:72px;height:72px;border-radius:50%;object-fit:cover}.p-av--i{display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:900;color:#fff;background:var(--grad)}' +
    '.p-name{font-size:1.4rem;font-weight:900}.p-sub{color:var(--muted);font-size:.92rem}' +
    '.kv{display:grid;grid-template-columns:1fr 1fr;gap:12px}.kv-row{background:var(--input);border:1px solid var(--border);border-radius:12px;padding:13px 15px}' +
    '.kv .k{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.kv .v{font-size:1rem;font-weight:600;margin-top:4px;word-break:break-word}' +
    // Download
    '.dl-logo{width:96px;height:96px;margin:0 auto 18px;border-radius:28px;display:flex;align-items:center;justify-content:center;font-size:3rem;background:var(--grad);box-shadow:0 14px 40px var(--glow)}' +
    '.dl-card{display:flex;align-items:center;gap:20px;justify-content:space-between;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px 24px;max-width:560px;margin:24px auto}' +
    '.dl-ver{font-weight:800;font-size:1.1rem}.dl-stats{color:var(--muted);font-size:.85rem;display:flex;gap:14px;margin-top:4px}.dl-qr{text-align:center}.dl-qr img{width:96px;height:96px;border-radius:12px;background:#fff;padding:6px}.dl-qr span{display:block;color:var(--muted);font-size:.72rem;margin-top:6px}' +
    '.chg{max-width:560px;margin:18px auto 0;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:12px 18px}.chg summary{cursor:pointer;font-weight:700}.chg p{margin-top:8px;color:var(--muted);font-size:.9rem}' +
    '.steps{max-width:640px;margin:30px auto 10px;display:grid;gap:12px}.step{display:flex;gap:14px;align-items:flex-start;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px}.step .n{flex:0 0 34px;height:34px;border-radius:50%;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800}.step h4{margin-bottom:4px}.step p{color:var(--muted);font-size:.9rem}' +
    // Footer
    '.foot{position:relative;margin-top:60px;border-top:1px solid var(--border);padding:46px 0 30px;overflow:hidden}' +
    '.foot-grad{position:absolute;top:0;left:50%;transform:translateX(-50%);width:500px;height:200px;background:var(--grad);filter:blur(90px);opacity:.18}' +
    '.foot-in{display:flex;justify-content:space-between;gap:30px;flex-wrap:wrap;position:relative}.foot .brand{margin-bottom:10px}.foot-links{display:flex;flex-direction:column;gap:8px}.foot-links a{color:var(--muted);font-size:.92rem}.foot-links a:hover{color:var(--fg)}' +
    '.copy{text-align:center;color:var(--muted);font-size:.82rem;margin-top:28px;position:relative}' +
    // Responsive
    '@media(max-width:640px){.kv{grid-template-columns:1fr}.d-head .dl{margin-left:0;width:100%}.nav-act .pill.ghost{display:none}}';
}

// helpers
function e(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function enc(s) { return encodeURIComponent(String(s == null ? "" : s)); }
function fld(label, control) { return '<label>' + e(label) + '</label>' + control; }
