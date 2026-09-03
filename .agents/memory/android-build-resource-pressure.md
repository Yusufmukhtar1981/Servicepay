---
name: Android build resource pressure
description: Replit resource behavior observed during full Flutter Android release builds.
---

Run full Android release builds without a concurrent Flutter web build or workflow restart, preferably as a monitored background command.

**Why:** Multiple release APK attempts were interrupted by Kotlin daemon filesystem failures, command timeouts, or full workspace restarts when Gradle and Flutter web builds overlapped. These interruptions produced no app compile error and no APK.

**How to apply:** Stop or avoid restarting other Flutter workflows during the Android build, use the workspace-local PUB_CACHE, monitor the background build, and report a missing artifact honestly if the container restarts rather than treating the interruption as a code failure.

Flutter's configured Android SDK can override `ANDROID_HOME` and rewrite `android/local.properties`; keep Flutter pointed at the writable project SDK during Android builds when plugins need platforms absent from the read-only Nix SDK.

On this Replit environment, `/home/runner` and `/tmp` can hit separate quotas despite `df` showing free disk. Keep one Gradle worker, use in-process Kotlin compilation, and preserve large transforms on the workspace volume behind the temporary Gradle cache path when `/tmp` reaches its quota.

Java 17 can crash with `SIGBUS` in `PerfLongVariant::sample` during long Gradle builds. Preserve incremental outputs, move the Gradle cache onto the workspace volume, and disable JVM perf-data mapping with `JAVA_TOOL_OPTIONS=-XX:-UsePerfData`.

**Why:** The read-only Nix SDK rejected a plugin-requested platform install, a missing temporary build-link target blocked output creation, and HotSpot perf-data sampling crashed after compilation had progressed.

**How to apply:** Before rebuilding, verify the configured SDK is writable and all build symlink targets exist. Reuse caches and generated outputs; avoid cleaning unless those outputs are corrupt.