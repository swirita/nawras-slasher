import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { createSlashTracker, TRACKING_LOSS_GRACE_MS, TRAIL_FADE_MS } from './slash.js'
import './style.css'

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_URL = `${import.meta.env.BASE_URL}models/hand_landmarker.task`

const stage = document.querySelector('#camera-stage')
const video = document.querySelector('#camera-video')
const canvas = document.querySelector('#tracking-canvas')
const context = canvas.getContext('2d')
const startButton = document.querySelector('#start-camera')
const stopButton = document.querySelector('#stop-camera')
const status = document.querySelector('#status')
const fpsValue = document.querySelector('#fps-value')
const trackingState = document.querySelector('#tracking-state')
const missingDuration = document.querySelector('#missing-duration')
const bridgeIndicator = document.querySelector('#bridge-indicator')

// x and y are CSS pixels within the mirrored camera stage.
const finger = { x: 0, y: 0, detected: false }
const slash = createSlashTracker()

let stream = null
let handLandmarker = null
let animationFrameId = null
let sessionId = 0
let lastVideoTime = -1
let frameCount = 0
let fpsStartTime = 0
let displayWidth = 0
let displayHeight = 0
let cancelMetadataWait = null

function setStatus(message, isError = false) {
  status.textContent = message
  status.classList.toggle('error', isError)
}

function resizeCanvas() {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const pixelRatio = window.devicePixelRatio || 1

  canvas.width = Math.round(width * pixelRatio)
  canvas.height = Math.round(height * pixelRatio)
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

  if (displayWidth && displayHeight && (width !== displayWidth || height !== displayHeight)) {
    // A resize changes display coordinates. Start fresh rather than making a false segment.
    slash.reset()
    finger.detected = false
  }
  displayWidth = width
  displayHeight = height
  drawTracking(performance.now())
}

function drawTracking(now) {
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)

  for (const segment of slash.state.trail) {
    const opacity = Math.max(0, 1 - (now - segment.at) / TRAIL_FADE_MS)
    context.beginPath()
    context.moveTo(segment.from.x, segment.from.y)
    context.lineTo(segment.to.x, segment.to.y)
    context.lineWidth = 7
    context.lineCap = 'round'
    context.strokeStyle = segment.bridged
      ? `rgba(255, 213, 133, ${opacity})`
      : `rgba(135, 220, 206, ${opacity})`
    context.stroke()
  }

  const graceOpacity = slash.state.tracking === 'GRACE' && slash.state.lastReliableAt !== null
    ? Math.max(0, 1 - (now - slash.state.lastReliableAt) / TRACKING_LOSS_GRACE_MS)
    : 0
  const dotOpacity = finger.detected ? 1 : graceOpacity
  const dot = finger.detected ? finger : slash.state.lastReliablePoint
  if (!dot || dotOpacity <= 0) return

  context.globalAlpha = dotOpacity
  context.beginPath()
  context.arc(dot.x, dot.y, 13, 0, Math.PI * 2)
  context.fillStyle = '#87dcce'
  context.fill()
  context.lineWidth = 3
  context.strokeStyle = '#102136'
  context.stroke()
  context.globalAlpha = 1
}

function updateTrackingDebug(now) {
  trackingState.textContent = slash.state.tracking
  missingDuration.textContent = slash.state.missingForMs
  bridgeIndicator.hidden = slash.state.tracking !== 'DETECTED' || now >= slash.state.bridgedUntil
}

function processResult(result, now) {
  const tip = result.landmarks[0]?.[8]
  finger.detected = Boolean(tip)

  if (tip) {
    // The video is CSS-mirrored. The canvas is not, so mirror x once here.
    // This keeps the drawn cursor and reusable display coordinates aligned.
    finger.x = (1 - tip.x) * canvas.clientWidth
    finger.y = tip.y * canvas.clientHeight
    slash.detected({ x: finger.x, y: finger.y }, now, Math.hypot(canvas.clientWidth, canvas.clientHeight))
    setStatus('Hand detected')
  } else {
    slash.missing(now)
    setStatus(slash.state.tracking === 'GRACE' ? 'Tracking briefly lost...' : 'Show your hand')
  }
}

function updateFps(now) {
  frameCount += 1
  const elapsed = now - fpsStartTime
  if (elapsed >= 1000) {
    fpsValue.textContent = Math.round((frameCount * 1000) / elapsed)
    frameCount = 0
    fpsStartTime = now
  }
}

function trackingLoop(activeSession) {
  if (activeSession !== sessionId || !handLandmarker) return

  try {
    const now = performance.now()
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
      const result = handLandmarker.detectForVideo(video, now)
      lastVideoTime = video.currentTime
      processResult(result, now)
      updateFps(now)
    }
    slash.tick(now)
    if (slash.state.tracking === 'LOST') finger.detected = false
    if (!finger.detected && slash.state.tracking === 'LOST') setStatus('Show your hand')
    updateTrackingDebug(now)
    drawTracking(now)
  } catch (error) {
    console.error('Hand tracking failed:', error)
    stopCamera('Hand tracking stopped. Please try again.', true)
    return
  }

  if (activeSession === sessionId) {
    animationFrameId = requestAnimationFrame(() => trackingLoop(activeSession))
  }
}

async function initializeHandTracker() {
  let vision
  try {
    vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
  } catch (error) {
    console.error('MediaPipe WASM initialization failed:', error)
    throw new Error('Could not load the hand tracking runtime. Check your internet connection and try again.')
  }

  let modelBuffer
  try {
    const response = await fetch(MODEL_URL)
    if (!response.ok) throw new Error(`Model request returned HTTP ${response.status}`)
    modelBuffer = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    console.error('Hand Landmarker model download failed:', error)
    throw new Error('Could not load the hand tracking model. Please try again.')
  }

  try {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: modelBuffer },
      runningMode: 'VIDEO',
      numHands: 1,
    })
  } catch (error) {
    console.error('Hand Landmarker initialization failed:', error)
    throw new Error('Could not start hand tracking. Please try again.')
  }
}

function waitForVideoMetadata() {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve()
  return new Promise((resolve, reject) => {
    function cleanup() {
      video.removeEventListener('loadedmetadata', onMetadata)
      video.removeEventListener('error', onError)
      cancelMetadataWait = null
    }
    function onMetadata() {
      cleanup()
      resolve()
    }
    function onError() {
      cleanup()
      reject(new Error('Camera video could not load.'))
    }
    cancelMetadataWait = () => {
      cleanup()
      reject(new Error('Camera startup was cancelled.'))
    }
    video.addEventListener('loadedmetadata', onMetadata)
    video.addEventListener('error', onError)
  })
}

function cameraErrorMessage(error) {
  switch (error.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was denied. Allow camera access in your browser and try again.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Connect a webcam and try again.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is unavailable. Close other apps using it and try again.'
    default:
      return 'Could not start the camera. Please check your webcam and try again.'
  }
}

async function startCamera() {
  if (startButton.disabled) return
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('This browser cannot access a camera here. Use HTTPS or localhost in a supported browser.', true)
    return
  }

  const activeSession = ++sessionId
  startButton.disabled = true
  stopButton.disabled = false
  setStatus('Requesting camera...')

  try {
    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user' },
      })
      if (activeSession !== sessionId) {
        cameraStream.getTracks().forEach((track) => track.stop())
        return
      }
      stream = cameraStream
    } catch (error) {
      console.error('Camera access failed:', error)
      throw new Error(cameraErrorMessage(error))
    }

    video.srcObject = stream
    await waitForVideoMetadata()
    if (activeSession !== sessionId) return
    await video.play()
    if (activeSession !== sessionId) return

    stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`
    stage.classList.add('is-active')
    resizeCanvas()
    setStatus('Loading hand tracker...')

    const tracker = await initializeHandTracker()
    if (activeSession !== sessionId) {
      tracker.close()
      return
    }

    handLandmarker = tracker
    lastVideoTime = -1
    frameCount = 0
    fpsStartTime = performance.now()
    setStatus('Show your hand')
    animationFrameId = requestAnimationFrame(() => trackingLoop(activeSession))
  } catch (error) {
    if (activeSession !== sessionId) return
    console.error('Camera/tracker startup failed:', error)
    stopCamera(error.message, true)
  }
}

function stopCamera(message = 'Camera off', isError = false) {
  sessionId += 1
  cancelMetadataWait?.()
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  animationFrameId = null
  try {
    handLandmarker?.close()
  } catch (error) {
    console.error('Could not close Hand Landmarker cleanly:', error)
  }
  handLandmarker = null
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  video.pause()
  video.srcObject = null
  stage.classList.remove('is-active')
  slash.reset()
  finger.x = 0
  finger.y = 0
  finger.detected = false
  lastVideoTime = -1
  frameCount = 0
  fpsValue.textContent = '0'
  updateTrackingDebug(performance.now())
  drawTracking(performance.now())
  startButton.disabled = false
  stopButton.disabled = true
  setStatus(message, isError)
}

new ResizeObserver(resizeCanvas).observe(stage)
startButton.addEventListener('click', startCamera)
stopButton.addEventListener('click', () => stopCamera())
