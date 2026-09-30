# Nawras Slasher

A small Vite starter for a future webcam-controlled NawrasEdu browser game. The current screen is a placeholder; the **Start Camera** button only displays a status message and does not access the camera.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

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

## Planned stack

- HTML, CSS, and vanilla JavaScript
- Vite for development and static builds
- Later: MediaPipe Tasks Vision `HandLandmarker` for webcam hand tracking (not installed yet)

Vite writes the production site to `dist/`. For a future GitHub Pages repository site, set Vite's `base` to `/<repository-name>/` before deployment. Camera access will require browser permission and a secure context such as HTTPS or localhost.
