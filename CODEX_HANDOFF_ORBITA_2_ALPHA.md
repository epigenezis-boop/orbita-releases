# Codex handoff: Orbita 2.0 Alpha — native Discovery integration

## Goal

Implement the first real ListenBrainz-powered Discovery feature **inside the existing Orbita Electron application**. The standalone browser page in `discovery-lab/lab.html` is only a disposable experiment/diagnostic harness. Do not ship it as the product UI and do not build a second unrelated web app.

Repository: `epigenezis-boop/orbita-releases`  
Required branch: `experimental/orbita-2.0`  
Stable baseline: Orbita 1.8.0 on `main`.

## Safety and branch rules

1. Start with `git status --short --branch`, `git fetch origin`, and inspect local changes. Do not discard, reset, stash, or overwrite user changes.
2. Check out or create a local tracking checkout of `origin/experimental/orbita-2.0`. Work only on this branch. Never commit to or push `main`.
3. Do not modify the stable release payload, stable `release.json`, stable release tags, or stable update metadata.
4. Keep Orbita 1.8.0 installable and usable. Alpha must be a separate app identity, installation target, and user-data profile. Disable auto-update in alpha unless a genuinely separate alpha update channel is implemented and verified. Never let alpha update stable or stable update alpha.
5. Never ask the user to paste a ListenBrainz token into chat, a source file, a command-line argument, Git, an issue, or a log. The user enters it in Orbita settings. Do not print it.
6. Do not upload listening history/scrobbles to ListenBrainz in this milestone. Read-only recommendation requests only.
7. No paid APIs, LLM providers, subscriptions, analytics trackers, or new mandatory cloud services.

## First: understand and reproduce the real app

The repository stores the Electron app source inside `payload/app.asar.gz.part-000`. Read and use the existing extraction/build process:

- `tools/assemble.mjs` verifies the compressed payload checksum and extracts `package.json`, `package-lock.json`, `src/`, and `test/` into `app/`.
- It requires `@electron/asar@4.0.1` under `tools/`.
- The stable GitHub Actions workflow shows the supported Windows build/test sequence.

On Windows, use the repository's existing documented commands. If needed, install the archive reader with:
```powershell
npm install --prefix tools --ignore-scripts --no-audit --no-fund @electron/asar@4.0.1
node tools/assemble.mjs
cd app
npm ci --no-audit --no-fund
```

Inspect the actual source before editing. Identify:
- Electron main/preload/renderer boundaries and IPC conventions.
- Existing navigation, views, settings UI, theme tokens, localization and component patterns.
- Existing Zvuk provider client, search/matching methods, album metadata/artwork fields, playback controls and queue API.
- Existing persistence and settings storage.
- Existing tests and build scripts.

Build and run the unchanged baseline once if practical. Record the actual commands and outcome. Do not guess provider endpoints or invent an API that is not present in the source.

## First deliverable: a native end-to-end Discovery vertical slice

Add a real Discovery section to Orbita's existing navigation and render it using the app's established UI components and visual language. It must feel like part of Orbita, not an embedded external page. Keep the current Classic UI intact; do not start the full Ryoku redesign yet.

### Settings and credentials

- Add a ListenBrainz connection setting and a masked token input in the existing settings area.
- Store the token only in Electron's main process using Electron `safeStorage` (or an already established secure credential store if the app has one). Do not expose plaintext token to renderer storage, localStorage, logs, crash reports, or exported reports.
- If secure storage is unavailable, explain this in UI and do not silently store plaintext.
- Provide a connection check with clear states (connected, invalid token, network/proxy error, rate limited).
- Use the user's existing system/VPN routing. Do not hardcode a proxy address in production code. If the project already supports a proxy setting, reuse it.

### Recommendation flow

- Let the user enter 1–4 seed artists. Accept exact names; where MusicBrainz returns ambiguous matches, show choices with disambiguation rather than silently choosing one.
- Offer ListenBrainz Radio modes `easy`, `medium`, `hard`, and a modest result count (10/20/30).
- Resolve artists through MusicBrainz to MBIDs, then request ListenBrainz Radio recommendations.
- Enrich candidate recordings through MusicBrainz with title, artist credit, duration, ISRCs and release/album information.
- Deduplicate by Recording MBID and diversify across recommended artists. Do not mistake community listen count for a similarity score.
- Handle empty/204 responses, missing MBIDs, 401/403, 429, timeouts, offline state and malformed payloads. Respect provider rate limits; cache results and avoid repeated requests.
- Make the request flow cancellable and keep the UI responsive.

### Match to Zvuk and playback

- Use the existing Orbita Zvuk client and its real search methods. Do not reverse-engineer or invent new undocumented endpoints if the current client already provides the necessary operations.
- Match using the strongest available identifiers first (ISRC/MBID if Zvuk exposes them), then normalized artist + title + album + duration. Show ambiguous matches for review; do not silently substitute live/remaster/cover versions.
- For matched tracks, show the existing Zvuk artwork and metadata. **Zvuk remains the primary artwork source.** Do not add Cover Art Archive requests to this feature.
- Add working actions using the existing player/queue APIs: play now, add to queue, open album/artist where supported.
- Unmatched candidates remain visible with a clear “not found in Zvuk” status; do not fabricate playback links.

### Feedback and report

- Add local like/dislike feedback for each candidate and persist it locally. Do not submit these reactions to ListenBrainz.
- Provide a JSON export of the experiment results without credentials or personal tokens.
- Show source/provenance and match confidence in a compact details view.
- Do not implement the complete SQLite music graph, album recommendation engine, daily playlist scheduler, or AI curator in this milestone. Keep the code structured so these can be added later.

## Alpha isolation and packaging

Create a separate Windows alpha build that can be installed alongside Orbita 1.8.0:
- Distinct Electron `appId`, product/display name, installer filename and app data directory.
- Disable auto-updater in alpha or ensure it points only to a separate verified alpha channel. Stable update metadata must remain untouched.
- Keep alpha build configuration separate from stable configuration. Do not bump stable version or overwrite stable release artifacts.
- Produce a local Windows installer (and portable build only if already supported by the project). Do not claim a GitHub release exists until the installer has actually been built, verified and uploaded.
- If CI is needed, add a separate alpha workflow scoped to this branch/tag; never broaden or alter the stable release trigger.

## Validation: focused, meaningful tests

Do not create a large synthetic test suite. Add a few targeted tests for:
- MBID parsing and duplicate removal.
- Artist-name ambiguity.
- API error mapping (204, 401/403, 429, timeout).
- Matching confidence and rejection of wrong versions.
- Credential handling (token never appears in renderer messages/logs/export).
- Alpha identity and data-directory separation from stable.
- Existing playback and queue behavior remains unchanged.

Then run the existing relevant tests, launch the real Electron app, and manually verify:
1. Stable 1.8.0 still starts and retains its own settings/data.
2. Alpha installs/starts alongside stable and has an isolated profile.
3. ListenBrainz token can be saved securely and connection status is accurate.
4. A search for Nightwish, Epica and Within Temptation returns real candidate data or a precise actionable error.
5. Zvuk matches are correct; artwork comes from Zvuk; play/add-to-queue work.
6. No listening history is uploaded and no paid service is contacted.

## Definition of done

- Discovery exists in the actual Orbita Electron UI.
- Recommendations are fetched from ListenBrainz and enriched with MusicBrainz.
- Tracks are matched to Zvuk through the existing provider integration and can be played/queued.
- Token is securely stored and never leaked.
- Alpha is isolated from stable app identity, data and updater.
- Focused tests pass; Windows alpha installer is built and its exact path/checksum recorded.
- Changes are committed and pushed only to `experimental/orbita-2.0`.

## Final report required

Report: changed files, architecture discovered, exact commands/tests run and results, alpha installer path and checksum, known limitations, commit SHA and branch link. Clearly distinguish what was actually executed from what remains unverified.
