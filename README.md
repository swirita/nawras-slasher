# Nawras Slasher

A small Vite prototype for a future webcam-controlled NawrasEdu browser game. It shows a mirrored webcam feed, tracks one index fingertip, and draws temporary swipe segments. Game mechanics are not included.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- Chrome or Safari, a webcam, and camera permission

## Install and run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173/`). On Windows PowerShell systems that block `npm.ps1`, use `npm.cmd install` and `npm.cmd run dev` instead.

To check the static production build:

```sh
npm run build
npm run preview
```

Run the slash state checks with `npm test` (or `npm.cmd test` in PowerShell).

## Planned stack

- HTML, CSS, and vanilla JavaScript
- Vite for development and static builds
- MediaPipe Tasks Vision `HandLandmarker` for one-hand tracking

The Hand Landmarker model is served locally from `public/models/hand_landmarker.task`. The MediaPipe WASM runtime is loaded from jsDelivr for `@mediapipe/tasks-vision@1.0.1`, so startup currently needs an internet connection.

The temporary debug readout shows tracking state, time missing, and a brief `BRIDGED` marker when a plausible short tracking gap is joined. The swipe path uses line segments in mirrored display coordinates. A gap longer than 130 ms resets the active swipe; the next detection starts fresh. Swipe speed and gap limits are initial values to tune with real webcam use.

Vite writes the production site to `dist/`. For a future GitHub Pages repository site, set Vite's `base` to `/<repository-name>/` before deployment. Camera access requires browser permission and a secure context such as HTTPS or localhost. Click **Stop Camera** to release the webcam.
