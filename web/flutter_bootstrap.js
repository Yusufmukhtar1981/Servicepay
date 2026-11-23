{{flutter_js}}
{{flutter_build_config}}

function servicepayStartupMark(name) {
  try { performance.mark(name); } catch (_) {}
}
servicepayStartupMark("servicepay-bootstrap-ready");
// This release is not a PWA. Do not wait for/register a removed Flutter worker.
_flutter.loader.load({
  onEntrypointLoaded: async function (initializer) {
    try {
      servicepayStartupMark("servicepay-entrypoint-ready");
      const runner = await initializer.initializeEngine();
      servicepayStartupMark("servicepay-engine-ready");
      await runner.runApp();
      servicepayStartupMark("servicepay-runapp-complete");
    } catch (_) {
      window.servicepayStartupFailure?.();
    }
  }
}).catch(() => window.servicepayStartupFailure?.());
