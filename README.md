# Nawras Slasher

A webcam-controlled browser arcade game. It uses one MediaPipe-tracked hand, a processed index-fingertip slash path, and local technology and NawrasEdu artwork.

## Run locally

Requires Node.js 20.19+ or 22.12+, npm, a webcam, and a current Chrome or Safari browser.

```sh
npm install
npm run dev
```

Open the URL printed by Vite. On this Windows PowerShell setup, use `npm.cmd` instead of `npm` if the `npm.ps1` execution policy blocks npm.

```sh
npm.cmd test
npm.cmd run build
```

Camera access needs browser permission and HTTPS or localhost. The Hand Landmarker model is served from `public/models/hand_landmarker.task`; the version-matched MediaPipe WASM runtime currently loads from jsDelivr, so camera startup needs internet access.

## Controls

- **Player entry:** enter a name (up to 16 characters) and press START or Enter. The camera request and normal countdown follow. A fresh page asks for a player again; active identity stays only in memory.
- **ENABLE CAMERA:** request the webcam only after a player clicks it. The camera fades out over 400 ms when the round ends and all stream tracks are stopped 700 ms after TIME'S UP.
- **START GAME:** show a 3, 2, 1 countdown; the 90-second timer and target spawning begin at SLASH!
- The Start button becomes available after the camera tracker and all eleven local images load. If an image fails, the status shows an error and gameplay stays disabled.
- **PLAY AGAIN:** keep the current player, reacquire the webcam, wait for video and tracking readiness, reset round state, then start the countdown automatically. No extra camera/start click is needed. A failed request keeps the result and shows TRY AGAIN. The session high score remains until page refresh.
- **NEW PLAYER:** on the result screen, turn off the camera and return to name entry for the next participant. PLAY AGAIN keeps the current player; RESET GAME also keeps them while discarding the unfinished attempt.
- **RESET GAME:** during PLAYING, click the subtle bottom-left control twice within two seconds to abandon the current attempt. This releases the camera and returns to READY without a completed result or high-score update. The previous completed session best and sound preference remain. The developer Reset Round control still resets the round while leaving the camera on for testing.
- **SOUND ON / SOUND OFF:** available in the hidden developer panel. The choice lasts for the current page session. Master volume is 0.52. Audio starts only after a user interaction and gracefully falls silent if Web Audio is unavailable.
- **Ctrl + Shift + D:** toggle the hidden developer panel. It starts hidden on every page load. The panel contains manual Camera Off and Reset Round controls, a two-click CLEAR LEADERBOARD control, finger/hand diagnostics, target selection and test spawning, tracking overlays, and the HYBRID/FINGER ONLY comparison. These controls do not appear in the normal event interface.

Completed rounds update a local Top 5 leaderboard. `localStorage` key `nawrasSlasherLeaderboard` holds up to 100 unique players' best completed scores; ties favor the earlier best-score time. Names match after trimming, collapsing internal whitespace, and lowercasing for comparison. The current player is not persisted. If storage is unavailable, ranking works in memory until the page closes. Staff clearing removes only this leaderboard key.

The already loaded MediaPipe model, images, audio system, sound preference, and in-memory high score remain available between players. Only the physical MediaStream and transient player/round state are released or reset. During gameplay, the system mouse cursor hides after 1.7 seconds without pointer movement and reappears when the pointer moves.

## Tracking and gameplay notes

- The browser requests approximately 640 × 480 at up to 30 camera frames per second. Actual resolution is shown in Debug. Detection runs only for a new video frame in a single animation loop.
- Raw fingertip coordinates are mapped through the source-video-to-viewport `object-fit: cover` crop and mirror. Visible cursor positions use an adaptive exponential average: alpha is 0.27 for slow motion and rises to 0.82 for fast motion, adjusted for time between samples.
- An isolated large sideways fingertip jump is held for one frame. In HYBRID mode, motion uses a palm anchor: 12% wrist (landmark 0) plus 22% each of index, middle, ring, and pinky MCP joints (5, 9, 13, 17). The anchor uses a frame-time-adjusted exponential average with base alpha 0.65. A recent fingertip-minus-anchor offset uses alpha 0.28. During fast motion, an offset jump over the larger of 30 CSS pixels or 3.5% of the screen diagonal causes the game to use anchor plus recent offset for up to 120 ms. The visible pointer otherwise follows the processed index fingertip.
- The gameplay slash begins with a causal three-point fingertip average (0.62, 0.28, 0.10) and a short time-based line fit. During fast, directionally stable hand movement, its position is additionally constrained toward the palm trajectory plus finger offset, suppressing perpendicular fingertip wobble without fixing a horizontal, vertical, or diagonal direction. **Only cleaned gameplay segments** are rendered strongly and collision-tested. Invisible tolerance beyond target radius is 24 CSS pixels for normal valid slashes, 40 for fast armed slashes, and 50 for valid predicted segments. Slow pointer movement still creates no hittable segment.
- In HYBRID mode, three recent continuous palm samples (at most 70 ms apart), hand speed at least 0.38 screen diagonals/second, direction cosine at least 0.86, and a fresh finger offset arm prediction. Finger-only comparison retains the prior fingertip thresholds (0.43 and 0.90). On complete hand loss, the last hand-anchor velocity (70% newest, 30% previous) moves the hand forward; the recent smoothed finger offset places the predicted fingertip. Velocity decays linearly to zero over at most 150 ms. Valid predicted segments can hit targets. Long loss or inconsistent reacquisition starts a fresh path.
- The game lasts 90 seconds. Spawn interval eases through 3.4, 3.05, 2.65, 2.3, 1.95, 1.65, 1.35, and 1.12 seconds at 0, 10, 20, 30, 45, 60, 75, and 90 seconds. Launch speed scales through 0.82, 0.88, 0.96, 1.08, 1.20, 1.31, 1.38, and 1.45. Pairs begin early and become common; triples remain occasional. The active-target cap stays five. Late targets have stronger gravity, keeping their faster arcs inside the play area.
- At 00:45 remaining, WEB RUSH runs once for six seconds. The existing spawn loop temporarily uses 950 ms waves, 30% singles, 50% pairs, and 20% triples, favoring HTML, CSS, JavaScript, and React for 90% of ordinary picks. Golden Nawras keeps its independent 3% eligible-spawn chance. Physics, points, combo rules, and the five-target cap stay the same. The hidden developer panel can trigger the same event early for testing; that consumes the round's one rush.
- Technology targets award 10, 15, or 20 base points according to `src/catalog.js`; Golden Nawras awards 50. Hits within two seconds build an uncapped combo streak; the scoring multiplier rises from ×1 to ×5 and stays capped at ×5 for every target, including Golden Nawras. Gameplay shows `COMBO 12` with `×5 MAX` at streaks of five or more. Best Combo records the actual streak. Misses have no penalty. The session tracks targets sliced, best combo, and a page-memory high score. Small bounded canvas effects show actual awarded points, slice pieces, and six cool or eighteen golden particles per hit. Game events are centralized in `src/game.js`; `src/audio.js` synthesizes layered, filtered Web Audio cues with musical combo pitch steps and no sound files or network requests. During the final 15 seconds, a localized edge glow and timer accent appear; from 10 to 1, each timer second gets a short tick.
- The visible webcam uses 28% opacity, 8 px blur, 1.35 brightness, and 0.55 contrast over a pale blue background, plus a white/blue tint and a faint grid. These are display-only CSS effects; MediaPipe still receives the original video element frames. The values are grouped as CSS variables in `src/style.css` for manual privacy tuning.
- Targets, slash segments, cursor, and collision sizes all use CSS pixels in the fullscreen mirrored display. Canvas backing pixels scale by `devicePixelRatio` for sharp drawing. Resizing clears targets and movement history to prevent false hits.
- `public/assets/nawras-name.png` is the horizontal wordmark on the ready and result screens. The nine technology assets are ordinary flying targets. Their catalog stores local paths, scores, relative weights, and modest visual scale adjustments. Images are drawn into aspect-ratio-preserving bounds and sliced with the same generic clipping path. All ordinary targets retain the same circular collision footprint regardless of logo shape. Automatic selection avoids a third identical tech in a row and favors unique techs within each pair or triple. `public/assets/nawras-small.png` is used only for Golden Nawras. It is ineligible for the first nine seconds; afterward each eligible spawn has an independent 3% chance. Its pulsing aura, ring, rays, six bounded live motes, and brief shimmer remain. All eleven images are preloaded before gameplay.

Vite produces a static site in `dist/`. For a future GitHub Pages repository site, set Vite's `base` to `/<repository-name>/` before deployment.

Landmark names and indices follow [Google's Hand Landmarker landmark reference](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/drawing_styles/hand_landmarker/HandLandmark); the [web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) describes the normalized results and JavaScript video API.
