/* ServicePay guide-page enhancement: related guides, opt-in recently viewed, local-only feedback. */
(function () {
  "use strict";
  var SCRIPT = document.currentScript && document.currentScript.src;
  function boot() {
    try { run(); } catch (e) { /* leave original page untouched */ }
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === "text") n.textContent = attrs[k]; else if (k === "cls") n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function ls(fn) { try { return fn(window.localStorage); } catch (e) { return null; } }
  function list(k) { var v = ls(function (s) { return JSON.parse(s.getItem(k) || "[]"); }); return Array.isArray(v) ? v : []; }
  function safeUrl(u) { return typeof u === "string" && /^\/[a-z0-9/_-]*$/i.test(u) ? u : "/knowledge/"; }

  function run() {
    var main = document.getElementById("main");
    if (!main || document.querySelector(".kc-guide")) return;
    var link = document.querySelector('link[rel="canonical"]');
    var canon = link ? link.href : location.origin + location.pathname;
    var path; try { path = new URL(canon).pathname; } catch (e) { path = location.pathname; }
    var titleEl = document.querySelector("h1");
    var title = (titleEl ? titleEl.textContent : document.title).trim().slice(0, 90);
    var consent = ls(function (s) { return s.getItem("sp-kc-consent"); }) === "yes";

    if (!document.querySelector('link[href$="knowledge-ui.css"]') && SCRIPT) {
      document.head.appendChild(el("link", { rel: "stylesheet", href: new URL("knowledge-ui.css", SCRIPT).href }));
    }

    if (consent) {
      var v = list("sp-kc-views").filter(function (x) { return x && x.url !== path; });
      v.unshift({ url: path, title: title, t: Date.now() });
      ls(function (s) { s.setItem("sp-kc-views", JSON.stringify(v.slice(0, 10))); });
    }

    if (!SCRIPT || !window.fetch) return;
    fetch(new URL("knowledge-index.json", SCRIPT).href, { credentials: "omit", referrerPolicy: "no-referrer" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || d.version !== 1 || !Array.isArray(d.documents) || !d.documents.length) return;
        try { build(d); } catch (e) {}
      })
      .catch(function () {});

    function build(d) {
    var sec = el("section", { cls: "kc-guide", "aria-label": "More help" });
    var wrap = el("div", { cls: "wrap kc-guide-grid" });
    var left = el("div"), right = el("div");
    wrap.appendChild(left); wrap.appendChild(right); sec.appendChild(wrap);

    /* feedback, local only */
    var fbKey = "sp-kc-feedback";
    var fb = el("div", { cls: "kc-fb" });
    var q = el("p", { text: "Was this guide helpful?" });
    var row = el("div", { cls: "kc-row", role: "group", "aria-label": "Guide feedback" });
    var note = el("p", { cls: "kc-small", role: "status", "aria-live": "polite", text: "Your answer stays on this device only. It is not sent to ServicePay." });
    var prev = (ls(function (s) { return JSON.parse(s.getItem(fbKey) || "{}"); }) || {})[path];
    [["yes", "Yes, helpful"], ["no", "Not really"]].forEach(function (o) {
      var b = el("button", { type: "button", cls: "kc-btn", "aria-pressed": String(prev === o[0]), text: o[1] });
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(row.children, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        if (consent) ls(function (s) { var m = JSON.parse(s.getItem(fbKey) || "{}"); if (typeof m !== "object" || !m) m = {}; m[path] = o[0]; s.setItem(fbKey, JSON.stringify(m)); });
        note.textContent = o[0] === "yes" ? "Thanks. Noted on this device only." : "Sorry it missed. Email support@servicepay.ng or call +234 913 615 1515 and a person will help. Never share your PIN or password.";
      });
      row.appendChild(b);
    });
    fb.appendChild(q); fb.appendChild(row); fb.appendChild(note);
    fb.appendChild(el("p", { cls: "kc-small" }, ["Need a person? ", el("a", { href: "mailto:support@servicepay.ng", text: "support@servicepay.ng" }), " or ", el("a", { href: "tel:+2349136151515", text: "+234 913 615 1515" }), ". For your own transactions, ", el("a", { href: "/?mode=login", text: "sign in" }), " and open Profile, then AI Smart Support, or Help & Support to create a ticket."]));
    right.appendChild(fb);

    if (consent) {
      var recent = list("sp-kc-views").filter(function (x) { return x && x.url !== path && typeof x.title === "string"; }).slice(0, 4);
      if (recent.length) {
        right.appendChild(el("h2", { text: "Recently viewed" }));
        var ru = el("ul"); recent.forEach(function (x) { ru.appendChild(el("li", null, [el("a", { href: safeUrl(x.url), text: x.title })])); });
        right.appendChild(ru);
      }
    }

    left.appendChild(el("h2", { text: "Related guides" }));
    var rl = el("ul");
    rl.appendChild(el("li", null, [el("a", { href: "/knowledge/", text: "Search the knowledge centre" })]));
    left.appendChild(rl);

    var footer = document.querySelector(".site-footer");
    if (footer && footer.parentNode) footer.parentNode.insertBefore(sec, footer); else main.appendChild(sec);

    var norm = function (u) { return String(u || "").replace(/\/$/, ""); };
    var me = d.documents.filter(function (x) { return x && norm(x.url) === norm(path); })[0];
    var cats = me && Array.isArray(me.categories) ? me.categories : [];
    d.documents.filter(function (x) { return x && x !== me && typeof x.title === "string" && typeof x.url === "string"; }).map(function (x) {
      var s = 0; (x.categories || []).forEach(function (c) { if (cats.indexOf(c) !== -1) s++; }); return { x: x, s: s };
    }).filter(function (o) { return o.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 5)
      .forEach(function (o) { rl.insertBefore(el("li", null, [el("a", { href: safeUrl(o.x.url), text: o.x.title })]), rl.lastChild); });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
