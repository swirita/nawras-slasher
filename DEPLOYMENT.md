# Expo deployment — prepared, not published

Repository: `https://github.com/swirita/nawras-slasher.git` (existing origin).
Local branch: `main`. Expected Pages URL: `https://swirita.github.io/nawras-slasher/`.
No commit, push, workflow dispatch or deployment was performed during this finalization.
Repository settings and environment protection rules have not been inspected through an authenticated GitHub session; check them in the steps below.

## Prepared setup

`.github/workflows/deploy-pages.yml` installs the lockfile with `npm ci`, runs the tests, builds with Node 24 and `VITE_BASE_PATH=/nawras-slasher/`, and uploads only `dist/`. Pull requests build and test but cannot enter the deploy job. A push to `main` or a manual run on `main` deploys through the `github-pages` environment. The workflow uses verified official action tags: checkout v7, setup-node v7, configure-pages v5, upload-pages-artifact v4 and deploy-pages v5. Deployment has `pages: write`, `id-token: write` and a build dependency, as required by [GitHub's custom workflow guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

`vite.config.js` already has the correct repository base for build/preview and `/` for local development. The workflow now also sets the base explicitly. Public artwork and the model use `import.meta.env.BASE_URL`. Vite bundles the module worker from `new URL('./inference-worker.js', import.meta.url)` into the production assets directory.

Verified production paths:

- Site: `/nawras-slasher/`
- Images: `/nawras-slasher/assets/<catalog filename>`
- Model: `/nawras-slasher/models/hand_landmarker.task`
- Worker: `/nawras-slasher/assets/inference-worker-<build hash>.js`
- MediaPipe WASM: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/`

The worker, model and all 12 artwork files returned HTTP 200 in local production browser verification. MediaPipe 1.0.1 remains in the lockfile and its WASM dependency is preserved. Browser verification served the installed version-matched WASM files locally; the Expo deployment still uses the CDN and needs internet access for initial tracking startup. No offline support is claimed.

## Exact remaining publishing steps — perform later

1. Review `git diff` and `git status`. Include the source, tests, lockfile, `.node-version`, Vite configuration, workflow and documentation. Do not commit `dist/`, `node_modules/` or `.production-check/` (already ignored).
2. In `swirita/nawras-slasher`, open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**. In **Settings → Actions → General**, ensure Actions and the official actions used above are allowed. If the `github-pages` environment restricts branches, allow `main`; retain any required approval rules.
3. Run the final local checks on Node 24: `npm ci`, `npm test`, `npm run build`, then `npm run preview -- --host 127.0.0.1`. Open the printed `/nawras-slasher/` URL. In PowerShell, use `npm.cmd` if the script execution policy blocks `npm.ps1`.
4. On the actual Expo laptop/browser/webcam, allow camera access and test a full round with fast turns, brief hand loss, fullscreen, reset and replay. Check sound, scoring and the local leaderboard. This real-webcam rehearsal remains outstanding.
5. Once ready to publish, commit the reviewed files and push `main` to `origin`. **That push starts deployment automatically.** Alternatively, after the files are on GitHub, run **Actions → Deploy to GitHub Pages → Run workflow**, selecting `main`. Approve the environment only if its rules require it.
6. Wait for both build and deploy jobs to succeed. Open the URL reported by the deployment, expected to be `https://swirita.github.io/nawras-slasher/`. Verify camera startup, Debug delegate/FPS, reset, F/fullscreen, scoring, completion and leaderboard on the deployed HTTPS page. Check DevTools for missing model/worker/image/CDN requests.

Leaderboard scores are stored in the browser's local storage. Localhost scores do not transfer to the Pages origin, and separate browsers/devices maintain separate leaderboards. Preserve the same Expo browser/profile between players.

For a different repository or a custom-domain root, change `VITE_BASE_PATH` consistently for the workflow, local build and preview; use a slash-terminated base such as `/other-repository/` or `/`. No custom domain is configured by these changes.
