# Audit follow-up after Orbita 1.8.0

Baseline: 1.7.3 source. The supplied 1.4.9/1.5.2 mixed installation is not the release integrity reference.

Implemented and covered: serialized local modifications; external cover cache and migration; asynchronous snapshots with lightweight progress writes; final checkpoint; DSP single-flight and native-element fallback; mono channel preservation; bounded background decode; idle audio timeout; one-shot URL renewal; HTML detection; transient restore retry and single-flight; token rollback on save failure; logout block reset; HTTPS redirect checks/download denial; private literal/hostname rejection; Space handling; loaded-prefix unlike offset; end-of-queue transport reset; restore local/wave/liked view; display-aware initial window height. Widget seek focus freeze was already fixed in 1.7.3.

Remaining (not claimed fixed):
- Authenticode signing, Electron fuses/embedded ASAR integrity and fuller third-party licensing notices.
- Complete login-provider/CDN allowlists and DNS-resolution/rebinding protection. Public HTTPS auth navigation remains supported for SSO compatibility.
- Full-catalog “Play all” continuation, complete restoration of artist/album/search/playlist detail views.
- Remove obsolete login dialog/CSS; further status/terminology/MediaSession cleanup; broad UI virtualization.
- Move all local decoding outside the UI process; loudness profile saves remain synchronous. Current patch limits decode memory and avoids the prior forced mono copy.
- Cancel already active GraphQL requests across track switches (server-side request counting cannot be undone by client cancellation).
- Real-account/provider validation of URL expiry formats, CDN renewal and account policy. Unit tests exercise synthetic timestamps, rejection and no-loop behavior.
- Real Windows GUI, multi-monitor disconnect and corporate antivirus testing.

Validation: node --test test/*.test.cjs; npm run test:ui; npm run test:audio. UI/audio scripts require the pinned Playwright development dependency and its Chromium browser. npm ci; npx playwright install chromium. Release CI executes all three before packaging. Production packaging excludes tests and development dependencies.
