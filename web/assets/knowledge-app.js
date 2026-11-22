/* ServicePay knowledge centre search UI. No network calls beyond the public index. Queries never enter URLs. */
(function () {
  "use strict";
  var SCRIPT = document.currentScript && document.currentScript.src;
  var INDEX_URL = new URL("knowledge-index.json", SCRIPT || location.href).href;
  var PENDING = "sp-kc-pending";
  var CONSENT = "sp-kc-consent";
  var HIST = "sp-kc-searches";
  var VIEWS = "sp-kc-views";
  var PAGE = 6;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "cls") n.className = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function safeUrl(u) { return typeof u === "string" && /^\/[a-z0-9/_-]*$/i.test(u) ? u : "/knowledge/"; }

  /* ---------- storage, failure tolerant ---------- */
  var store = {
    get: function (area, k) { try { return window[area].getItem(k); } catch (e) { return null; } },
    set: function (area, k, v) { try { window[area].setItem(k, v); return true; } catch (e) { return false; } },
    del: function (area, k) { try { window[area].removeItem(k); } catch (e) {} },
    list: function (k) {
      try { var v = JSON.parse(store.get("localStorage", k) || "[]"); return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === "object"; }) : []; }
      catch (e) { store.del("localStorage", k); return []; }
    }
  };
  function consented() { return store.get("localStorage", CONSENT) === "yes"; }

  var K, engine, data, root, mode, input, form, list, statusEl, lang = "en";
  var state = { q: "", cat: "", offset: 0, items: [], active: -1, sugg: [] };

  function sensitive(q) {
    try { if (K && K.isSensitive) return !!K.isSensitive(q); } catch (e) {}
    var digits = (q.match(/\d/g) || []).length;
    return digits >= 6 || /\b(pin|password|otp|bvn|token|cvv)\b\s*[:=]?\s*\S*\d/i.test(q);
  }
  function setStatus(msg, err) { if (!statusEl) return; statusEl.textContent = msg || ""; statusEl.classList.toggle("err", !!err); }

  /* ---------- highlight using text nodes + mark ---------- */
  function terms(q) {
    var n = (K && K.normalize ? K.normalize(q) : q.toLowerCase());
    return n.split(/\s+/).filter(function (t) { return t.length > 1; }).slice(0, 8);
  }
  function highlight(text, ts) {
    var frag = document.createDocumentFragment();
    text = String(text || "");
    if (!ts.length) { frag.appendChild(document.createTextNode(text)); return frag; }
    var lower = text.toLowerCase(), i = 0;
    while (i < text.length) {
      var best = -1, len = 0;
      for (var j = 0; j < ts.length; j++) {
        var p = lower.indexOf(ts[j], i);
        if (p !== -1 && (best === -1 || p < best || (p === best && ts[j].length > len))) { best = p; len = ts[j].length; }
      }
      if (best === -1) { frag.appendChild(document.createTextNode(text.slice(i))); break; }
      if (best > i) frag.appendChild(document.createTextNode(text.slice(i, best)));
      frag.appendChild(el("mark", { cls: "kc-hl", text: text.slice(best, best + len) }));
      i = best + len;
    }
    return frag;
  }

  /* ---------- history ---------- */
  function remember(q) {
    if (!consented() || sensitive(q)) return;
    var h = store.list(HIST).filter(function (x) { return x.q !== q; });
    h.unshift({ q: q.slice(0, 120), t: Date.now() });
    store.set("localStorage", HIST, JSON.stringify(h.slice(0, 8)));
  }
  function renderHistory() {
    var slots = document.querySelectorAll("[data-kc-history]");
    var wrap = $("[data-kc-history-wrap]");
    if (wrap) wrap.hidden = false;
    Array.prototype.forEach.call(slots, function (slot) {
      clear(slot);
      var box = el("div", { cls: "kc-hist" });
      box.appendChild(el("h3", { text: "Your recent activity" }));
      if (consented()) {
        var s = store.list(HIST), v = store.list(VIEWS);
        if (!s.length && !v.length) box.appendChild(el("p", { cls: "kc-small", text: "Nothing yet. Searches and guides you open will appear here, only on this device." }));
        if (s.length) {
          box.appendChild(el("p", { cls: "kc-small", text: "Recent searches" }));
          var ul = el("ul");
          s.forEach(function (x) {
            if (typeof x.q !== "string" || sensitive(x.q)) return;
            var b = el("button", { type: "button", text: x.q });
            b.addEventListener("click", function () { go(x.q); });
            ul.appendChild(el("li", null, [b]));
          });
          box.appendChild(ul);
        }
        if (v.length) {
          box.appendChild(el("p", { cls: "kc-small", text: "Recently viewed guides" }));
          var ul2 = el("ul");
          v.slice(0, 6).forEach(function (x) {
            if (typeof x.title !== "string") return;
            ul2.appendChild(el("li", null, [el("a", { href: safeUrl(x.url), text: x.title })]));
          });
          box.appendChild(ul2);
        }
        var off = el("button", { type: "button", cls: "kc-btn", text: "Clear and stop saving" });
        off.addEventListener("click", function () {
          store.del("localStorage", HIST); store.del("localStorage", VIEWS); store.del("localStorage", CONSENT);
          store.del("localStorage", "sp-kc-feedback");
          setStatus("History cleared. Nothing is being saved on this device.");
          renderHistory();
        });
        box.appendChild(off);
      } else {
        var lab = el("label", { cls: "kc-consent" });
        var cb = el("input", { type: "checkbox" });
        cb.addEventListener("change", function () {
          if (store.set("localStorage", CONSENT, "yes")) { setStatus("Recent searches and guides will be saved on this device only."); renderHistory(); }
          else { cb.checked = false; setStatus("This browser is blocking local storage, so history cannot be saved.", true); }
        });
        lab.appendChild(cb);
        lab.appendChild(el("span", { text: "Save my recent searches and viewed guides on this device. Nothing is sent to ServicePay. Sensitive searches are never saved." }));
        box.appendChild(lab);
      }
      slot.appendChild(box);
    });
  }

  /* ---------- assistant (curated answers only) ---------- */
  function renderAnswer(q) {
    var slots = document.querySelectorAll("[data-kc-answer]");
    Array.prototype.forEach.call(slots, function (slot) {
      clear(slot);
      var holder = slot.closest("[data-kc-assist]");
      if (!q) { if (mode === "search" && holder) holder.hidden = true; return; }
      if (holder) holder.hidden = false;
      var box = el("div", { cls: "kc-answer" });
      if (sensitive(q)) {
        box.appendChild(el("span", { cls: "kc-answer-tag", text: "Keep it private" }));
        box.appendChild(el("p", { text: lang === "ha" ? "Kada ka rubuta lambobin sirri a nan. Shiga ServicePay, buɗe All Services sannan AI Support, ko Help & support don aika ƙorafi." : "That looks like private details. Please do not type numbers, PINs or passwords here. Sign in, open All Services → AI Support, or the dashboard Help & support button to create a ticket." }));
        box.appendChild(el("a", { cls: "kc-btn primary", href: "/?mode=login", text: "Sign in securely" }));
        slot.appendChild(box); return;
      }
      var a = null;
      try { a = engine.answer(q, lang); } catch (e) { a = null; }
      var langRow = el("div", { cls: "kc-row", role: "group", "aria-label": "Answer language" });
      [["en", "English"], ["ha", "Hausa"]].forEach(function (l) {
        var b = el("button", { type: "button", cls: "kc-btn", "aria-pressed": String(lang === l[0]), lang: l[0] === "ha" ? "ha" : "en", text: l[1] });
        b.addEventListener("click", function () { lang = l[0]; renderAnswer(q); });
        langRow.appendChild(b);
      });
      box.appendChild(el("span", { cls: "kc-answer-tag", text: "Instant guide answer" }));
      if (a && a.known && a.text) {
        box.appendChild(el("p", { lang: lang === "ha" ? "ha" : "en", text: a.text }));
        if (a.links && a.links.length) {
          var ul = el("ul");
          a.links.slice(0, 4).forEach(function (l) { ul.appendChild(el("li", null, [el("a", { href: safeUrl(l.url), text: l.title })])); });
          box.appendChild(ul);
        }
      } else {
        box.appendChild(el("p", { text: lang === "ha" ? "Ba mu da tabbataccen amsa ga wannan tambayar ba. Duba jagororin da ke kasa, ko tuntubi tallafi." : "We do not have a verified answer for that yet. Check the guides below, or contact support and a person will help." }));
        box.appendChild(el("a", { href: "#kc-support", text: lang === "ha" ? "Tuntubi tallafi" : "Contact support" }));
      }
      box.appendChild(langRow);
      box.appendChild(el("p", { cls: "kc-small", text: "From verified, published ServicePay guidance. Not an AI chat. For your own transactions and AI chat, sign in and open All Services → AI Support." }));
      slot.appendChild(box);
    });
  }

  /* ---------- autocomplete ---------- */
  function closeSuggest() { list.hidden = true; clear(list); state.active = -1; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
  function openSuggest() {
    var q = input.value.trim();
    if (q.length < 2 || sensitive(q)) { closeSuggest(); if (q && sensitive(q)) setStatus("Private details detected. They will not be searched or saved."); return; }
    var s = [];
    try { s = engine.suggest(q) || []; } catch (e) { s = []; }
    state.sugg = s.slice(0, 6);
    clear(list);
    if (!state.sugg.length) { closeSuggest(); return; }
    var ts = terms(q);
    state.sugg.forEach(function (it, i) {
      var li = el("li", { id: "kc-opt-" + i, role: "option", "aria-selected": "false" }, [el("span", null, [highlight(it.title, ts)]), el("small", { text: "Guide" })]);
      li.addEventListener("mousedown", function (ev) { ev.preventDefault(); location.href = safeUrl(it.url); });
      list.appendChild(li);
    });
    list.hidden = false; input.setAttribute("aria-expanded", "true");
  }
  function move(d) {
    var opts = list.querySelectorAll("li"); if (!opts.length) return;
    state.active = (state.active + d + opts.length) % opts.length;
    Array.prototype.forEach.call(opts, function (o, i) { o.setAttribute("aria-selected", String(i === state.active)); });
    input.setAttribute("aria-activedescendant", "kc-opt-" + state.active);
  }

  /* ---------- search flow ---------- */
  function go(q) {
    q = (q || "").trim();
    closeSuggest();
    if (!q) { setStatus("Type a few words, for example: pending data.", true); input.focus(); return; }
    if (sensitive(q)) { input.value = ""; setStatus("For your safety, that search was not run or saved. Remove numbers, PINs or passwords and try again."); renderAnswer(q); return; }
    if (mode === "landing") {
      if (!store.set("sessionStorage", PENDING, JSON.stringify({ q: q, cat: state.cat }))) { setStatus("Your browser blocked session storage. Showing an answer here instead."); renderAnswer(q); return; }
      location.assign(new URL("search/", location.href.split("?")[0].split("#")[0]).href);
      return;
    }
    remember(q);
    state.q = q; state.offset = 0; state.items = [];
    runSearch(false);
  }

  function runSearch(append) {
    var out = $("[data-kc-results]");
    if (!append) {
      clear(out);
      for (var i = 0; i < 3; i++) out.appendChild(el("div", { cls: "kc-skel", "aria-hidden": "true" }));
    }
    renderAnswer(state.q);
    var res;
    try { res = engine.search(state.q, { category: state.cat, limit: PAGE, offset: state.offset }); }
    catch (e) { return showError(out, "Search ran into a problem."); }
    var ts = terms(state.q);
    if (!append) clear(out);
    var ul = $(".kc-list", out);
    if (!res.items.length && !append) return noResults(out, res);
    if (!ul) {
      out.appendChild(el("p", { cls: "kc-count", text: res.total + (res.total === 1 ? " guide" : " guides") + (state.cat ? " in " + catName(state.cat) : "") }));
      ul = el("ul", { cls: "kc-list" }); out.appendChild(ul);
    }
    var firstNew = null;
    res.items.forEach(function (it, i) {
      var a = el("a", { href: safeUrl(it.url) }, [highlight(it.title, ts)]);
      var li = el("li", { cls: "kc-item", style: "animation-delay:" + (i * 40) + "ms" }, [
        el("h2", { style: "margin:0;font-size:inherit" }, [a]),
        el("div", { cls: "kc-url", text: safeUrl(it.url) }),
        el("p", null, [highlight(it.excerpt || it.description || "", ts)])
      ]);
      var tags = (it.categories || []).slice(0, 3).map(function (c) { return el("span", { text: catName(c) }); });
      if (tags.length) li.appendChild(el("div", { cls: "kc-tags" }, tags));
      ul.appendChild(li);
      if (!firstNew) firstNew = a;
    });
    var oldMore = $(".kc-more", out); if (oldMore) oldMore.remove();
    state.offset += res.items.length;
    if (res.hasMore) {
      var more = el("button", { type: "button", cls: "kc-btn kc-more", text: "Show more guides" });
      more.addEventListener("click", function () { runSearch(true); });
      out.appendChild(more);
    }
    if (append && firstNew) firstNew.focus();
    setStatus(res.total + " results for your search.");
    renderRelated(res.related || []);
  }

  function noResults(out, res) {
    var box = el("div", { cls: "kc-empty" }, [
      el("h2", { text: "No guides matched that" }),
      el("p", { cls: "muted", text: "Try fewer or simpler words, check spelling, or pick a topic below. Hausa words such as \"rajista\" or \"wutar lantarki\" work too." })
    ]);
    var chips = el("div", { cls: "kc-chips" });
    ["pending transaction", "register", "data", "electricity", "contact support"].forEach(function (s) {
      var b = el("button", { type: "button", cls: "kc-btn", text: s });
      b.addEventListener("click", function () { input.value = s; go(s); });
      chips.appendChild(b);
    });
    box.appendChild(chips);
    if (state.cat) {
      var all = el("button", { type: "button", cls: "kc-link", text: "Search all topics instead" });
      all.addEventListener("click", function () { state.cat = ""; syncCats(); go(state.q); });
      box.appendChild(all);
    }
    out.appendChild(box);
    setStatus("No results. Suggestions are shown.");
    renderRelated(res.related || []);
  }

  function showError(out, msg) {
    clear(out);
    var retry = el("button", { type: "button", cls: "kc-btn primary", text: "Try again" });
    retry.addEventListener("click", function () { location.reload(); });
    out.appendChild(el("div", { cls: "kc-empty", role: "alert" }, [el("h2", { text: msg }), el("p", { cls: "muted", text: "You can still browse every guide below." }), retry]));
  }

  function renderRelated(rel) {
    var slot = $("[data-kc-related]"); if (!slot) return; clear(slot);
    rel = rel.filter(function (r) { return typeof r === "string" && !sensitive(r); }).slice(0, 6);
    if (!rel.length) return;
    slot.appendChild(el("h2", { text: "Related searches" }));
    var c = el("div", { cls: "kc-chips" });
    rel.forEach(function (r) { var b = el("button", { type: "button", cls: "kc-btn", text: r }); b.addEventListener("click", function () { input.value = r; go(r); }); c.appendChild(b); });
    slot.appendChild(c);
  }

  /* ---------- categories ---------- */
  function catName(id) { var c = (data.categories || []).filter(function (x) { return x.id === id; })[0]; return c ? c.name : id; }
  function syncCats() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-kc-cat]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-kc-cat") === state.cat)); });
  }
  function renderCats() {
    var target = $("[data-kc-cats]") || $("[data-kc-filter]"); if (!target) return;
    clear(target);
    var cats = data.categories || [];
    if (mode === "search") cats = [{ id: "", name: "All topics" }].concat(cats);
    target.setAttribute("role", "group"); target.setAttribute("aria-label", "Topics");
    cats.forEach(function (c) {
      var b = el("button", { type: "button", cls: "kc-cat", "data-kc-cat": c.id, "aria-pressed": "false", title: c.description || null }, [el("span", { text: c.name })]);
      if (c.ha && mode === "landing") b.appendChild(el("small", { lang: "ha", text: c.ha }));
      b.addEventListener("click", function () {
        state.cat = state.cat === c.id && mode === "search" ? "" : c.id;
        syncCats();
        if (mode === "landing") {
          store.set("sessionStorage", PENDING, JSON.stringify({ q: "", cat: c.id }));
          location.assign(new URL("search/", location.href.split("?")[0].split("#")[0]).href);
        } else if (state.q) { state.offset = 0; runSearch(false); }
        else browseCategory();
      });
      target.appendChild(b);
    });
    syncCats();
  }
  function browseCategory() {
    var out = $("[data-kc-results]"); clear(out);
    var docs = (data.documents || []).filter(function (d) { return !state.cat || (d.categories || []).indexOf(state.cat) !== -1; });
    out.appendChild(el("p", { cls: "kc-count", text: docs.length + " guides" + (state.cat ? " in " + catName(state.cat) : "") }));
    var ul = el("ul", { cls: "kc-list" });
    docs.forEach(function (d) {
      ul.appendChild(el("li", { cls: "kc-item" }, [el("h2", { style: "margin:0;font-size:inherit" }, [el("a", { href: safeUrl(d.url), text: d.title })]), el("p", { text: d.description || "" })]));
    });
    out.appendChild(ul);
    renderAnswer("");
  }

  /* ---------- voice (opt-in, click only) ---------- */
  function setupVoice() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var mic = $("[data-kc-mic]"), panel = $("[data-kc-voice]");
    if (!SR || !mic || !panel) return;
    mic.hidden = false;
    var rec = null, vlang = "en-NG";
    mic.addEventListener("click", function () {
      if (rec) { try { rec.stop(); } catch (e) {} return; }
      panel.hidden = !panel.hidden;
      if (panel.hidden) return;
      clear(panel);
      panel.appendChild(el("p", { text: "Voice search uses your browser's speech service, which may send audio to its provider (for example Google or Apple). ServicePay does not receive the recording. Never speak account numbers, passwords, PINs, OTPs, BVN or NIN; dictate general service questions only. Hausa recognition is not available in every browser; typing always works." }));
      var row = el("div", { cls: "kc-row" });
      [["en-NG", "English"], ["ha-NG", "Hausa"]].forEach(function (l) {
        var b = el("button", { type: "button", cls: "kc-btn", "aria-pressed": String(vlang === l[0]), text: l[1] });
        b.addEventListener("click", function () { vlang = l[0]; Array.prototype.forEach.call(row.querySelectorAll(".kc-btn:not(.primary)"), function (x) { x.setAttribute("aria-pressed", String(x === b)); }); });
        row.appendChild(b);
      });
      var start = el("button", { type: "button", cls: "kc-btn primary", text: "Start listening" });
      start.addEventListener("click", function () {
        try {
          rec = new SR(); rec.lang = vlang; rec.interimResults = false; rec.maxAlternatives = 1;
          rec.onresult = function (ev) {
            var t = (ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript) || "";
            if (sensitive(t)) { setStatus("We heard private details, so nothing was searched. Please type a general question."); return; }
            input.value = t; openSuggest(); setStatus("Heard your question. Press Search or pick a suggestion.");
          };
          rec.onerror = function (ev) {
            var m = { "not-allowed": "Microphone permission was declined. You can type instead.", "no-speech": "No speech was heard. Try again or type.", "language-not-supported": "This browser cannot recognise that language. Try English or type your question.", "network": "The browser speech service is unreachable. Please type instead." };
            setStatus(m[ev.error] || "Voice search stopped. Please type instead.", true);
          };
          rec.onend = function () { rec = null; mic.setAttribute("aria-pressed", "false"); start.textContent = "Start listening"; };
          rec.start(); mic.setAttribute("aria-pressed", "true"); start.textContent = "Listening..."; setStatus("Listening. Speak your question.");
        } catch (e) { rec = null; setStatus("Voice search could not start in this browser. Please type instead.", true); }
      });
      row.appendChild(start);
      panel.appendChild(row);
    });
  }

  /* ---------- boot ---------- */
  function wire() {
    input.disabled = false; $(".kc-go", form).disabled = false;
    input.addEventListener("input", function () { setStatus(""); openSuggest(); });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown") { ev.preventDefault(); if (list.hidden) openSuggest(); else move(1); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); move(-1); }
      else if (ev.key === "Escape") { closeSuggest(); }
      else if (ev.key === "Enter" && state.active > -1 && state.sugg[state.active]) { ev.preventDefault(); location.href = safeUrl(state.sugg[state.active].url); }
    });
    input.addEventListener("blur", function () { setTimeout(closeSuggest, 120); });
    form.addEventListener("submit", function (ev) { ev.preventDefault(); go(input.value); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-kc-pop]"), function (a) {
      a.addEventListener("click", function (ev) { ev.preventDefault(); input.value = a.getAttribute("data-kc-pop"); go(input.value); });
    });
    setupVoice();
  }

  function start() {
    root = $("main.kc"); if (!root) return;
    mode = root.getAttribute("data-kc-mode");
    form = $("[data-kc-form]"); input = $("#kc-q"); list = $("#kc-suggest"); statusEl = $("[data-kc-status]");
    if (!form || !input) return;
    // Never keep query strings: strip any that arrive.
    if (location.search && history.replaceState) { try { history.replaceState(null, "", location.pathname); } catch (e) {} }
    K = window.ServicePayKnowledge;
    if (!K || !K.createEngine) { setStatus("Search is unavailable right now. Browse every guide below.", true); if (mode === "search") showError($("[data-kc-results]"), "Search could not load."); return; }
    if (mode === "search") { var out = $("[data-kc-results]"); clear(out); for (var i = 0; i < 3; i++) out.appendChild(el("div", { cls: "kc-skel", "aria-hidden": "true" })); }
    setStatus("Loading guides...");
    fetch(INDEX_URL, { credentials: "omit", referrerPolicy: "no-referrer", cache: "default" })
      .then(function (r) { if (!r.ok) throw new Error("index " + r.status); return r.json(); })
      .then(function (d) {
        if (!d || d.version !== 1 || !Array.isArray(d.documents) || !Array.isArray(d.categories)) throw new Error("bad index");
        data = d; engine = K.createEngine(d);
        setStatus("");
        wire(); renderCats(); renderHistory();
        if (mode === "search") {
          var p = null;
          try { p = JSON.parse(store.get("sessionStorage", PENDING) || "null"); } catch (e) { p = null; }
          store.del("sessionStorage", PENDING);
          if (p && typeof p.cat === "string") { state.cat = p.cat; syncCats(); }
          if (p && typeof p.q === "string" && p.q && !sensitive(p.q)) { input.value = p.q; go(p.q); }
          else { browseCategory(); }
          if (!p) input.focus();
        }
      })
      .catch(function () {
        setStatus("Guides could not load. Check your connection and try again.", true);
        if (mode === "search") showError($("[data-kc-results]"), "Guides could not load.");
      });
  }

  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start(); }
  catch (e) { /* never break crawlable links */ }
})();
