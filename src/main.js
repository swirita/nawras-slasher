import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
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

// x and y are CSS pixels within the mirrored camera stage.
const finger = { x: 0, y: 0, detected: false }

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

  if (finger.detected && displayWidth && displayHeight) {
    finger.x *= width / displayWidth
    finger.y *= height / displayHeight
    drawFinger()
  }
  displayWidth = width
  displayHeight = height
}

function drawFinger() {
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
  if (!finger.detected) return

  context.beginPath()
  context.arc(finger.x, finger.y, 13, 0, Math.PI * 2)
  context.fillStyle = '#87dcce'
  context.fill()
  context.lineWidth = 3
  context.strokeStyle = '#102136'
  context.stroke()
}

function processResult(result) {
  const tip = result.landmarks[0]?.[8]
  finger.detected = Boolean(tip)

  if (tip) {
    // The video is CSS-mirrored. The canvas is not, so mirror x once here.
    // This keeps the drawn cursor and reusable display coordinates aligned.
    finger.x = (1 - tip.x) * canvas.clientWidth
    finger.y = tip.y * canvas.clientHeight
    setStatus('Hand detected')
  } else {
    setStatus('Show your hand')
  }

  drawFinger()
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
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
      const now = performance.now()
      const result = handLandmarker.detectForVideo(video, now)
      lastVideoTime = video.currentTime
      processResult(result)
      updateFps(now)
    }
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
  finger.x = 0
  finger.y = 0
  finger.detected = false
  lastVideoTime = -1
  frameCount = 0
  fpsValue.textContent = '0'
  drawFinger()
  startButton.disabled = false
  stopButton.disabled = true
  setStatus(message, isError)
}

new ResizeObserver(resizeCanvas).observe(stage)
startButton.addEventListener('click', startCamera)
stopButton.addEventListener('click', () => stopCamera())
