# Nawras Slasher

A webcam-controlled browser game prototype. It uses one MediaPipe-tracked hand, a processed index-fingertip slash path, and simple colored targets. Final assets and game systems are not included.

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

- **Camera On / Camera Off:** start or release the webcam. Camera permission is requested only after Camera On is clicked.
- **Start:** begin the 90-second round and target spawning. The timer does not run before Start.
- **Reset:** restore the timer, target state, hits, slash state, and starting difficulty while keeping the camera running.
- **Debug:** show finger/hand speed, hand direction stability, slash arming, prediction, and a manual Spawn Test Target button. The tracking overlay compares the raw fingertip, processed fingertip, hand anchor/path, and gameplay slash. The Motion source button switches between **HYBRID** (default) and **FINGER ONLY** for physical comparison; switching clears movement history safely.

## Tracking and gameplay notes

- The browser requests approximately 640 × 480 at up to 30 camera frames per second. Actual resolution is shown in Debug. Detection runs only for a new video frame in a single animation loop.
- Raw fingertip coordinates are mapped through the source-video-to-viewport `object-fit: cover` crop and mirror. Visible cursor positions use an adaptive exponential average: alpha is 0.27 for slow motion and rises to 0.82 for fast motion, adjusted for time between samples.
- An isolated large sideways fingertip jump is held for one frame. In HYBRID mode, motion uses a palm anchor: 12% wrist (landmark 0) plus 22% each of index, middle, ring, and pinky MCP joints (5, 9, 13, 17). The anchor uses a frame-time-adjusted exponential average with base alpha 0.65. A recent fingertip-minus-anchor offset uses alpha 0.28. During fast motion, an offset jump over the larger of 30 CSS pixels or 3.5% of the screen diagonal causes the game to use anchor plus recent offset for up to 120 ms. The visible pointer otherwise follows the processed index fingertip.
- The gameplay slash begins with a causal three-point fingertip average (0.62, 0.28, 0.10) and a short time-based line fit. During fast, directionally stable hand movement, its position is additionally constrained toward the palm trajectory plus finger offset, suppressing perpendicular fingertip wobble without fixing a horizontal, vertical, or diagonal direction. **Only cleaned gameplay segments** are rendered strongly and collision-tested. Invisible tolerance beyond target radius is 24 CSS pixels for normal valid slashes, 40 for fast armed slashes, and 50 for valid predicted segments. Slow pointer movement still creates no hittable segment.
- In HYBRID mode, three recent continuous palm samples (at most 70 ms apart), hand speed at least 0.38 screen diagonals/second, direction cosine at least 0.86, and a fresh finger offset arm prediction. Finger-only comparison retains the prior fingertip thresholds (0.43 and 0.90). On complete hand loss, the last hand-anchor velocity (70% newest, 30% previous) moves the hand forward; the recent smoothed finger offset places the predicted fingertip. Velocity decays linearly to zero over at most 150 ms. Valid predicted segments can hit targets. Long loss or inconsistent reacquisition starts a fresh path.
- The game lasts 90 seconds. Target spawn interval decreases gradually from 4.3 to 1.5 seconds. Launch speed scale rises from 0.82 to 1.10. Pair probability rises from 0 to 0.56, triple probability from 0 to 0.10. The practical active target limit rises from one to five, with a hard cap of five. All difficulty values use elapsed time divided by the 90-second round duration.
- The visible webcam uses 28% opacity, 8 px blur, 1.35 brightness, and 0.55 contrast over a pale blue background, plus a white/blue tint and a faint grid. These are display-only CSS effects; MediaPipe still receives the original video element frames. The values are grouped as CSS variables in `src/style.css` for manual privacy tuning.
- Targets, slash segments, cursor, and collision sizes all use CSS pixels in the fullscreen mirrored display. Canvas backing pixels scale by `devicePixelRatio` for sharp drawing. Resizing clears targets and movement history to prevent false hits.

Vite produces a static site in `dist/`. For a future GitHub Pages repository site, set Vite's `base` to `/<repository-name>/` before deployment.

Landmark names and indices follow [Google's Hand Landmarker landmark reference](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/drawing_styles/hand_landmarker/HandLandmark); the [web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) describes the normalized results and JavaScript video API.
