# Production finalization — 1 October 2026

The fullscreen, cursor, GitHub Pages, deployment, and conservative cleanup milestone is complete locally. The repository has not been pushed or deployed to GitHub. Existing gameplay systems, packages, image/model assets, button design, and the completed header correction are preserved.

## Fullscreen

1. Plain `f` / `F` calls `document.documentElement.requestFullscreen()` from the keyboard gesture. Repeated presses and pending requests cannot stack requests; F does not toggle out of fullscreen.
2. Inputs, textareas, selects, inherited contenteditable regions, and editable nodes in an event's composed path retain normal typing.
3. Ctrl, Meta, Alt, and Shift modifiers preserve browser/system shortcuts. Ctrl+Shift+D continues to toggle Debug.
4. Escape has no application fullscreen handler and is never prevented by the fullscreen controller. Native browser Escape remains responsible for exiting. Fullscreen callbacks do not change game state, score, timer, identity, targets, or camera ownership.
5. The quiet bottom hint reads `PRESS F FOR FULLSCREEN`. It is shown in name-entry/normal READY outside fullscreen, hidden in fullscreen and other phases, and hidden if the native API is unavailable. In normal READY it sits above the existing camera/start controls.
6. Existing ResizeObserver, video `object-fit: cover`, display-coordinate mapping, and device-pixel-ratio backing resolution are reused. Root fills the viewport with 100vh/100dvh fallback and no document scrolling. One necessary adjustment removes target clearing on resize, so fullscreen cannot discard live targets; motion histories still reset to prevent false hits. Targets keep their existing CSS-pixel positions, velocity, gravity, and collision sizes. Fullscreen is never exited by a game-state transition.

## Cursor

7. `.app[data-phase="PLAYING"]` and its descendants use `cursor: none !important` immediately. No frame-loop cursor manipulation exists.
8. Mouse movement only informs the existing FINISHED idle system; it cannot reveal the PLAYING cursor. Browser checks include aggressive movement, WEB RUSH, and FINAL 15.
9. Existing phase synchronization removes the PLAYING match immediately for READY, COUNTDOWN, FINISHED, reset, and camera interruption. Normal button/input cursors then apply. TRY AGAIN and result actions remain usable.
10. Fullscreen state never participates in the cursor selector. Entry and exit while PLAYING preserve the hidden cursor.
11. Removed `mouseIdleTimer`, `clearMouseIdle()`, `armMouseIdle()`, their phase/pointer calls, and the `.cursor-idle` CSS requirement. The former 1700ms delay has one replacement: phase-driven CSS. FINISHED inactivity tracking remains intact.

## GitHub Pages

12. `vite.config.js` centrally defaults to `/nawras-slasher/` for build and production preview, `/` for development. `VITE_BASE_PATH` can override either; supply a slash-terminated base for an alternate repository/custom domain.
13. Deployment URL: `https://<username>.github.io/nawras-slasher/`.
14. Existing image preloads already concatenate `import.meta.env.BASE_URL` with relative catalog paths. No asset helper or scattered repository prefix was needed. The HTML favicon is relative, and Vite manages the source module/built JS/CSS URLs.
15. The model request remains `${import.meta.env.BASE_URL}models/hand_landmarker.task`, yielding `/nawras-slasher/models/hand_landmarker.task`. Model bytes are unchanged.
16. MediaPipe stays at the locked 1.0.1 version. Its existing absolute `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm` URL is unchanged. Only user actions request a camera; fresh page load requests none.
17. `.github/workflows/deploy-pages.yml` triggers on pushes to main and workflow_dispatch. Build: checkout → setup Node → npm ci → npm test → npm run build → configure Pages → upload dist. Deploy depends on successful build and uses the github-pages environment and deployment URL. Official actions: checkout@v7, setup-node@v7, configure-pages@v5, upload-pages-artifact@v3, deploy-pages@v5. Build gets contents:read; deploy gets pages:write/id-token:write. Pages concurrency does not cancel an active deployment.
18. `.node-version` specifies Node 24 LTS. Local verification used Node 24.13.1; no dependency upgrades or lockfile changes were made.
19. Windows commands: `npm.cmd install`, `npm.cmd run dev`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run preview`. CI uses npm ci/test/run build. Production preview opens `/nawras-slasher/` rather than the domain root.

The deployment pattern follows [GitHub's official Pages workflow](https://raw.githubusercontent.com/actions/starter-workflows/main/pages/static.yml), with the current official [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node) actions. Node 24 is listed as LTS in the [Node release schedule](https://github.com/nodejs/Release).

## Cleanup

20. No tracked game/source/test/asset file was deleted. Removed the previous `.logo-check/` inspection artifacts and this milestone's `.production-check/` inspection scripts, screenshots, measurements, and disposable Chrome profile/cache. [CLEANUP_REPORT.md](CLEANUP_REPORT.md) lists every removed file with its reason and verification evidence.
21. The only deleted functions/variable are the obsolete mouse-idle system named above. AST inspection found no unused imports or unreferenced top-level functions in main; no other functions/imports were removed.
22. Removed `.text-button` / `.text-button:hover`: repository-wide search found no HTML, JS, runtime class, test, catalog, or build reference outside these CSS definitions. Current buttons have their own active styles. No other CSS class candidate lacked an HTML/runtime source reference after this removal.
23. Cursor-delay functions, timer, class, and hooks were fully removed; no competing cursor system remains.
24. Temporary screenshot/baseline/browser files were removed after their results were recorded. Disposable browser and preview processes started for this milestone were stopped. Existing dist remains available for review.
25. No dependencies removed: Vite drives the scripts/build, MediaPipe is imported by main, and Node's built-in test runner drives regression tests. Packages and lockfile remain unchanged.
26. `.gitignore` adds `.vite/`, `*.log`, `.logo-check/`, and `.production-check/`; node_modules/ and dist/ were already ignored and are untracked.
27. Retained the intentionally hidden developer panel and its controls, tested compatibility exports MAX_COMBO/createGameClock, and the exported INITIAL_LAUNCH_SPEED_SCALE/FINAL_LAUNCH_SPEED_SCALE constants. The two latter exports have no current consuming identifier in the AST audit, but belong to the frozen difficulty-module interface; they were left intact rather than alter tuned systems. No tracking, geometry, hand, slash, targets, timer, leaderboard, or camera module was refactored.

## Verification

28. Modified: `.gitignore`, `README.md`, `index.html`, `src/main.js`, `src/style.css`. Added: `.node-version`, `vite.config.js`, `.github/workflows/deploy-pages.yml`, `src/fullscreen.js`, `tests/fullscreen.test.js`, `tests/deployment.test.js`, this report, and `CLEANUP_REPORT.md`. Existing uncommitted header changes from the previous milestone were preserved.
29. Added 25 tests covering F/f, all editable/modifier protections, repeated/handled keys, request duplication/rejection/unsupported APIs, actual fullscreen state and hint behavior, round independence, Ctrl+Shift+D, exclusive cursor ownership, actual resize handler preservation of targets/backing pixels, Vite bases, and public asset/model URLs. All 124 original tests remain.
30. `npm.cmd test`: **149 passed; 0 failures; 0 skipped**.
31. `npm.cmd run build`: success, Vite 8.3.1, 29 modules. Output: HTML, CSS, bundled JavaScript, unchanged public assets/model. `git diff --check` passes.
32. Verified all 11 images and the 7,819,105-byte model are present in dist and served byte-for-byte identical to public originals. Built HTML uses `/nawras-slasher/assets/` for JS/CSS; built runtime model and public image URLs have the repository prefix. The model is not requested from the domain root. node_modules and dist are not tracked.
33. Real headless Chrome production preview at `http://127.0.0.1:4173/nawras-slasher/` passed with a synthetic camera and accelerated clock, without changing application files. Branding, styles, READY particles, name entry, camera/tracker initialization, full rounds, replay, New Player, reset, re-enable/start, camera-error retry, and developer Camera Off passed. Camera requests were 0 initially and exactly 1 per each of 5 explicit starts; there was never more than one live stream, and release left none.
34. No HTTP 404/error responses or failed network requests in the successful browser run. All catalog images, model, JS, and CSS returned 200 under the production base; the external MediaPipe runtime loaded successfully.
35. No uncaught exceptions or application console errors. MediaPipe emits `INFO: Created TensorFlow Lite XNNPACK delegate for CPU.` through console.error; this is an upstream informational diagnostic, recorded rather than suppressed. No repetitive application debug logging was found.
36. Actual F fullscreen entry passed; F in the name input typed normally. Actual document.exitFullscreen exit, fullscreenchange/hint updates, continued timer/camera/cursor, and fullscreen persistence through all repeated states passed. Headless Chrome's CDP-dispatched Escape did not invoke the native browser accelerator; a physical Escape key press still needs checking on the event browser. This is a verification limitation, not an application Escape override. Browser checks at 1440/1024/700/480px confirmed exact existing logo/Score/Time/cyan-line boxes, natural logo aspect ratio, correct canvas backing resolution at DPR 2, video cover geometry, no document overflow, and hidden PLAYING cursor. READY and FINISHED screenshots were also inspected. Physical hand gestures/webcam performance remain an event-device check; tracking code/configuration are unchanged.
37. Manual GitHub steps:
    1. Create/push the `nawras-slasher` repository with these changes and its lockfile to `main`.
    2. Set **Settings → Pages → Build and deployment → Source → GitHub Actions**.
    3. If required, enable Actions under **Settings → Actions → General** and allow the official actions used above.
    4. Ensure the `github-pages` environment allows main and approve any reviewer gate you have configured.
    5. Open **Actions → Deploy to GitHub Pages → Run workflow → main** after enabling Pages, or push to main; inspect the successful deployment URL.
    6. Open the HTTPS Pages URL on the event device. Enter a name/start and allow its camera permission. Test physical F/Esc and a real hand-tracked round. The leaderboard remains local to that browser/device/origin.

No live deployment was performed, and no GitHub account settings were changed.
