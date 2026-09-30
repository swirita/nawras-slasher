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
- **Start:** begin the three-minute round and target spawning. The timer does not run before Start.
- **Reset:** restore the timer, target state, hits, slash state, and starting difficulty while keeping the camera running.
- **Debug:** show detection FPS, inference time, tracking and prediction state, and a manual Spawn Test Target button. The helper works during a round.

## Tracking and gameplay notes

- The browser requests approximately 640 × 480 at up to 30 camera frames per second. Actual resolution is shown in Debug. Detection runs only for a new video frame in a single animation loop.
- Raw fingertip coordinates are mapped through the source-video-to-viewport `object-fit: cover` crop and mirror. Visible cursor positions use an adaptive exponential average: alpha is 0.27 for slow motion and rises to 0.82 for fast motion, adjusted for time between samples.
- An isolated large sideways jump is held for one frame. If the next sample returns to the prior trajectory, the jump is dropped; two nearby samples confirm a real direction change. The slash path uses a causal three-point average with weights 0.62, 0.28, and 0.10 on newest to oldest samples. These are initial tuning values.
- A slash is made of line segments. Collision treats each segment as a capsule with a 14 CSS-pixel hit radius beyond the target radius. Only active slash segments can hit. During a stable, fast slash, tracking loss can produce decaying predicted segments for at most 120 ms; a long loss resets slash history. Prediction is marked in Debug and internally on each segment.
- The game lasts 180 seconds. Target spawn interval decreases gradually from 4.3 to 1.5 seconds. Launch speed scale rises from 0.82 to 1.10. Pair probability rises from 0 to 0.56, triple probability from 0 to 0.10. The practical active target limit rises from one to five, with a hard cap of five.
- Targets, slash segments, cursor, and collision sizes all use CSS pixels in the fullscreen mirrored display. Canvas backing pixels scale by `devicePixelRatio` for sharp drawing. Resizing clears targets and movement history to prevent false hits.

Vite produces a static site in `dist/`. For a future GitHub Pages repository site, set Vite's `base` to `/<repository-name>/` before deployment.
