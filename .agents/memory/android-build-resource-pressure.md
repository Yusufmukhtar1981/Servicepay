---
name: Android build resource pressure
description: Replit resource behavior observed during full Flutter Android release builds.
---

Run full Android release builds without a concurrent Flutter web build or workflow restart, preferably as a monitored background command.

**Why:** Multiple release APK attempts were interrupted by Kotlin daemon filesystem failures, command timeouts, or full workspace restarts when Gradle and Flutter web builds overlapped. These interruptions produced no app compile error and no APK.

**How to apply:** Stop or avoid restarting other Flutter workflows during the Android build, use the workspace-local PUB_CACHE, monitor the background build, and report a missing artifact honestly if the container restarts rather than treating the interruption as a code failure.