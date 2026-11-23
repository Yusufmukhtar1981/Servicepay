const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(__dirname + '/customer_startup.js', 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup({stalled = false} = {}) {
  const scripts = [], removed = [], deleted = [], marks = [], listeners = {}, timers = new Map();
  let timerId = 0, reloads = 0;
  const message = {textContent: ''}, buttons = [];
  const shell = {style: {}};
  const session = {
    style: {},
    querySelector: selector => selector === 'p' ? message : buttons[0],
    appendChild: button => buttons.push(button),
  };
  const window = {
    SERVICEPAY_STARTUP: {bootstrap: 'flutter_bootstrap.hash.js'},
    location: {reload: () => reloads++},
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  const context = {
    window, URL,
    performance: {mark: name => marks.push(name)},
    setTimeout: (callback, delay) => { timers.set(++timerId, {callback, delay}); return timerId; },
    clearTimeout: id => timers.delete(id),
    document: {
      getElementById: id => id === 'servicepay-session-shell' ? session : shell,
      createElement: () => ({addEventListener(name, callback) { this[name] = callback; }}),
      body: {appendChild: script => scripts.push(script)},
    },
    navigator: {serviceWorker: {getRegistrations: () => stalled
      ? new Promise(() => {})
      : Promise.resolve(['flutter_service_worker.js', 'firebase-messaging-sw.js']
        .map(name => ({
          active: {scriptURL: 'https://servicepay.ng/' + name},
          unregister: async () => removed.push(name),
        })))}},
    caches: {keys: async () => ['flutter-app-cache', 'other-cache'],
      delete: async name => deleted.push(name)},
  };
  window.caches = context.caches;
  vm.runInNewContext(code, context);
  return {window, scripts, removed, deleted, marks, listeners, timers, session, message, buttons,
    reloads: () => reloads,
    fire: delay => [...timers.values()].find(timer => timer.delay === delay).callback()};
}

test('cleans only Flutter caches/workers and starts the exact release script', async () => {
  const env = setup();
  await flush();
  assert.deepEqual(env.removed, ['flutter_service_worker.js']);
  assert.deepEqual(env.deleted, ['flutter-app-cache']);
  assert.equal(env.scripts.length, 1);
  assert.equal(env.scripts[0].src, 'flutter_bootstrap.hash.js');
  env.listeners['flutter-first-frame']();
  assert.equal(env.timers.size, 0);
});

test('stalled cache cleanup cannot permanently block the release', async () => {
  const env = setup({stalled: true});
  assert.equal(env.scripts.length, 0);
  env.fire(500);
  await flush();
  assert.equal(env.scripts.length, 1);
});

test('failed downloads expose manual retry without sending anything automatically', async () => {
  const env = setup();
  await flush();
  env.scripts[0].onerror();
  env.window.servicepayStartupFailure();
  assert.match(env.message.textContent, /Check your connection/);
  assert.equal(env.buttons.length, 1);
  assert.equal(env.reloads(), 0);
  env.buttons[0].click();
  assert.equal(env.reloads(), 1);
});

test('missing first frame gets bounded feedback; late success clears the timer', async () => {
  const env = setup();
  await flush();
  env.fire(45000);
  assert.equal(env.buttons[0].textContent, 'Try again');
  env.listeners['flutter-first-frame']();
  assert.ok(env.marks.includes('servicepay-first-frame'));
  assert.equal(env.timers.size, 0);
});
