"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const root = fs.existsSync("artifacts/servicepay-customer/flutter/web") ?
  "artifacts/servicepay-customer/flutter/web" : "web";
const sandbox = { module: { exports: {} } };
require("node:vm").runInNewContext(fs.readFileSync(path.join(root, "assets/knowledge-engine.js"), "utf8"), sandbox);
const api = sandbox.module.exports;
const data = JSON.parse(fs.readFileSync(path.join(root, "assets/knowledge-index.json")));
const engine = api.createEngine(data);
test("all original public pages and all 17 categories are represented", () => {
  assert.equal(data.documents.length, 32);
  assert.equal(data.categories.length, 17);
  assert.equal(new Set(data.documents.map(d => d.url)).size, 32);
  for (const url of ["/", "/about/", "/knowledge/", "/privacy-policy", "/delete-account",
    "/data/", "/airtime/", "/edupay/", "/terms-and-conditions", "/virtual-account/"])
    assert(data.documents.some(d => d.url === url), url);
  for (const category of data.categories)
    assert(data.documents.some(d => d.categories.includes(category.id)), category.id);
  for (const d of data.documents) {
    assert(d.url.startsWith("/") && !d.url.startsWith("//"));
    assert(!d.url.includes("?") && !d.url.includes("/api/"));
    assert(!d.text.includes("function(") && !d.text.includes("auth_token"));
    assert(d.title && d.description && d.text);
  }
});
test("English relevance, Hausa normalization, categories and pagination work", () => {
  for (const [query, wanted] of [["Data subscription", "/data/"], ["wutar lantarki", "/electricity/"],
    ["manta kalmar sirri", "/security/"], ["virtual account", "/virtual-account/"]])
    assert(engine.search(query, { limit: 5 }).items.some(d => d.url === wanted), query);
  const wallet = engine.search("", { category: "wallet" });
  assert(wallet.items.length && wallet.items.every(d => d.categories.includes("wallet")));
  const page1 = engine.search("", { limit: 6 }), page2 = engine.search("", { offset: 6, limit: 6 });
  assert.equal(page1.total, 32); assert(page1.hasMore);
  assert(!page1.items.some(a => page2.items.some(b => a.id === b.id)));
  assert.equal(engine.search("xyzzzzundefinedtopic").total, 0);
  assert.equal(api.normalize("ƘORAFI"), "korafi");
  assert(engine.suggest("vir").some(d => d.url === "/virtual-account/"));
});
test("curated bilingual answers cite existing public sources and never invent outcomes", () => {
  const routes = new Set(data.documents.map(d => d.url));
  for (const a of data.answers) {
    assert(a.en && a.ha);
    for (const link of a.links) assert(routes.has(link.url), link.url);
  }
  assert(engine.answer("data pending").text.includes("not yet definitive"));
  assert(engine.answer("Ina taimako", "ha").text.includes("Shiga asusunka"));
  assert(engine.answer("unknownzzzz").known === false);
  assert(engine.answer("virtual account").text.includes("do not repeatedly"));
  assert(!engine.answer("refund my transaction immediately").text.includes("refunded successfully"));
});
test("sensitive queries are rejected before search, answer or suggestions", () => {
  for (const q of ["123456", "08000000000", "me@example.com", "password: abcdefghi",
    "NIN 1234 5678 901", "Bearer private-session-token", "sk-veryprivatekeystring123"]) {
    assert(api.isSensitive(q), q);
    assert.equal(engine.search(q).total, 0);
    assert.equal(engine.suggest(q).length, 0);
    assert.equal(engine.answer(q).known, false);
  }
  for (const q of ["how do I reset my password", "16 KB app support", "NIN verification"])
    assert(!api.isSensitive(q), q);
});
test("search results are noindex, public guides stay canonical, queries never enter network URLs", () => {
  const resultHtml = fs.readFileSync(path.join(root, "knowledge/search/index.html"), "utf8");
  assert(/name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(resultHtml));
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert(!sitemap.includes("/knowledge/search/"));
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  assert(!robots.includes("Disallow: /knowledge/search/"),
    "Allow crawlers to read the search page noindex directive");
  for (const file of ["knowledge-app.js", "knowledge-guide.js"]) {
    const js = fs.readFileSync(path.join(root, "assets", file), "utf8");
    assert(!/\b(?:eval|document\.write)\s*\(/.test(js));
    assert(!/\.innerHTML\s*=/.test(js), file + ": use safe DOM construction");
    assert(!js.includes("OPENAI_API_KEY") && !js.includes("auth_token"));
    assert(!/fetch\([^)]*(?:query|question|encodeURIComponent)/.test(js), file);
  }
});
test("retrieval is instant on this bounded corpus", () => {
  const start = performance.now();
  for (let i = 0; i < 100; i++) engine.search(i % 2 ? "data missing" : "jiran transaction");
  const perQuery = (performance.now() - start) / 100;
  assert(perQuery < 100, `${perQuery.toFixed(2)} ms/query exceeded 100ms`);
  console.log(`Search benchmark: ${perQuery.toFixed(2)} ms/query (100 local queries; not a mobile field metric).`);
});
test("public guide links cannot escape to external or executable URLs", () => {
  for (const file of ["knowledge-app.js", "knowledge-guide.js"]) {
    const source = fs.readFileSync(path.join(root, "assets", file), "utf8");
    const helper = source.match(/function safeUrl\(u\) \{[^\n]+/)[0];
    const context = {};
    require("node:vm").runInNewContext(helper, context);
    for (const url of ["//evil.example", "/\\evil.example", "javascript:alert(1)",
      "/%2f%2fevil.example", "/?token=private", "https://evil.example"])
      assert.equal(context.safeUrl(url), "/knowledge/", file + ": " + url);
    assert.equal(context.safeUrl("/virtual-account/"), "/virtual-account/");
  }
});
