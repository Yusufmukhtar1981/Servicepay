/* ServicePay public-guide retrieval. No network, credentials or model calls. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ServicePayKnowledge = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  function normalize(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/ɓ/g, "b").replace(/ɗ/g, "d").replace(/ƙ/g, "k")
      .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  }
  function isSensitive(value) {
    const q = String(value || "");
    return q.length > 240 || /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(q) ||
      /(?:\d[\s().+-]*){6,}/.test(q) ||
      /\b(?:bearer\s+\S+|sk-[a-z0-9_-]{12,}|eyJ[a-z0-9_-]{15,}\.)/i.test(q) ||
      /\b(?:password|passcode|pin|otp|token|secret|kalmar sirri)\s*(?:is|na|=|:)\s*\S+/i.test(q);
  }
  const stop = new Set(("a an the is are was were be to of for on in at it i my me we you your how what why can do does " +
    "please servicepay da na ne ina yaya yadda zan za yi ake ake min ni ta ya mai menene mece wane").split(/\s+/));
  const concepts = {
    money: "wallet", kudi: "wallet", kudina: "wallet", balance: "wallet",
    asusu: "account", asusuna: "account", rajista: "register", registration: "register",
    shiga: "login", intanet: "data", bayanai: "data", bundle: "data", bundles: "data",
    recharge: "airtime", katin: "airtime", wuta: "electricity", lantarki: "electricity",
    meter: "electricity", makaranta: "edupay", school: "edupay", fees: "edupay",
    kai: "delivery", sako: "delivery", kaya: "delivery", courier: "delivery",
    taimako: "support", complaint: "support", complaints: "support", korafi: "support",
    korafe: "support", tsaro: "security", sirri: "password", manta: "password",
    pending: "pending", jiran: "pending", success: "successful", nasara: "successful",
    failed: "failed", failure: "failed", kasa: "failed", tarihin: "history",
    ciniki: "transaction", maamala: "transaction", transactions: "transaction",
    rana: "solar", bashi: "empowerment", cinikayya: "marketplace",
  };
  const words = text => normalize(text).split(" ").filter(w => w && !stop.has(w))
    .map(w => concepts[w] || w);
  function createEngine(data) {
    const documents = data.documents || [];
    const cats = new Map((data.categories || []).map(c => [c.id, c]));
    const prepared = documents.map(d => {
      const fields = [
        [d.title, 8], [d.description, 4], [(d.headings || []).join(" "), 5],
        [(d.categories || []).map(c => {
          const cat = cats.get(c); return cat ? cat.name + " " + cat.ha : c;
        }).join(" "), 2], [d.text, 1],
      ];
      const scores = new Map();
      for (const [text, weight] of fields)
        for (const term of new Set(words(text))) scores.set(term, (scores.get(term) || 0) + weight);
      return { doc: d, scores, phrase: normalize(d.title + " " + d.description) };
    });
    const frequency = new Map();
    prepared.forEach(p => p.scores.forEach((_, w) => frequency.set(w, (frequency.get(w) || 0) + 1)));
    function search(query, options = {}) {
      if (isSensitive(query)) return { items: [], total: 0, hasMore: false, related: [], sensitive: true };
      const q = normalize(query), terms = [...new Set(words(query))];
      const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
      const limit = Math.max(1, Math.min(30, Math.floor(Number(options.limit) || 6)));
      const category = options.category || "";
      const ranked = prepared.filter(p => !category || p.doc.categories.includes(category)).map(p => {
        let matched = 0, score = 0;
        for (const term of terms) {
          let weight = p.scores.get(term) || 0;
          if (!weight && term.length >= 4) {
            for (const [word, w] of p.scores) if (word.startsWith(term)) weight = Math.max(weight, w * 0.35);
          }
          if (weight) {
            matched++;
            score += weight * (1 + Math.log(1 + documents.length / (1 + (frequency.get(term) || 0))));
          }
        }
        if (q && p.phrase.includes(q)) score += 20;
        if (terms.length && matched) score *= matched / terms.length;
        return { ...p.doc, score, excerpt: excerpt(p.doc.text || p.doc.description, terms) };
      }).filter(d => !q || d.score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
      return { items: ranked.slice(offset, offset + limit), total: ranked.length,
        hasMore: offset + limit < ranked.length,
        related: ranked.slice(0, 4).map(d => d.title) };
    }
    function suggest(query) {
      if (!normalize(query) || isSensitive(query)) return [];
      return search(query, { limit: 5 }).items.map(d => ({ title: d.title, url: d.url }));
    }
    function answer(query, language = "en") {
      const ha = language === "ha";
      const unknown = {
        text: ha ? "Ban sami tabbatacciyar amsa a jagororinmu ba. Shiga asusunka don AI Smart Support ko tuntuɓi support@servicepay.ng. Kada ka tura PIN, OTP, BVN ko NIN a nan."
          : "I could not find a verified guide answer. Sign in for AI Smart Support or contact support@servicepay.ng. Do not share a PIN, OTP, BVN or NIN here.",
        links: [{ title: ha ? "Taimakon abokin ciniki" : "Contact support", url: "/contact/" }], known: false,
      };
      if (isSensitive(query) || !normalize(query)) return unknown;
      const wanted = new Set(words(query));
      const ranked = (data.answers || []).map(a => {
        let score = 0;
        for (const phrase of a.terms) {
          const terms = [...new Set(words(phrase))];
          if (terms.length && terms.every(t => wanted.has(t))) score = Math.max(score, terms.length);
        }
        return { a, score };
      }).filter(r => r.score).sort((a, b) => b.score - a.score);
      if (!ranked.length) {
        const top = search(query, { limit: 1 }).items[0];
        if (!top || top.score < 20) return unknown;
        return { text: (ha ? "Ga abin da jagoran Turanci ya ce: " : "From the published guide: ") +
          top.excerpt, links: [{ title: top.title, url: top.url }], known: true };
      }
      const best = ranked[0].a;
      return { text: best[ha ? "ha" : "en"], links: best.links, known: true };
    }
    return { search, suggest, answer };
  }
  function excerpt(text, terms) {
    const parts = String(text).replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
    let best = parts[0] || "", score = -1;
    for (const part of parts) {
      const set = new Set(words(part));
      const s = terms.reduce((n, t) => n + Number(set.has(t)), 0);
      if (s > score) { best = part; score = s; }
    }
    return best.length > 260 ? best.slice(0, 257).replace(/\s+\S*$/, "") + "…" : best;
  }
  return { normalize, isSensitive, createEngine };
});
