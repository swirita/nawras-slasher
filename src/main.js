import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { cameraPointToDisplay } from './geometry.js'
import { createFingerProcessor } from './tracking.js'
import { createSlashTracker, TRACKING_LOSS_GRACE_MS, TRAIL_FADE_MS } from './slash.js'
import { createTargetSystem, HIT_EFFECT_MS, MAX_ACTIVE_TARGETS } from './targets.js'
import { createGameClock, difficultyAt, formatTime } from './game.js'
import './style.css'

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_URL = `${import.meta.env.BASE_URL}models/hand_landmarker.task`
const DEBUG_UPDATE_MS = 250
const FIRST_SPAWN_DELAY_MS = 750

const stage = document.querySelector('#camera-stage')
const video = document.querySelector('#camera-video')
const canvas = document.querySelector('#tracking-canvas')
const context = canvas.getContext('2d')
const cameraOnButton = document.querySelector('#start-camera')
const cameraOffButton = document.querySelector('#stop-camera')
const startRoundButton = document.querySelector('#start-round')
const resetRoundButton = document.querySelector('#reset-round')
const spawnButton = document.querySelector('#spawn-target')
const debugToggle = document.querySelector('#debug-toggle')
const debugPanel = document.querySelector('#debug-panel')
const roundMessage = document.querySelector('#round-message')
const status = document.querySelector('#status')
const timerValue = document.querySelector('#timer')
const hitCountValue = document.querySelector('#hit-count')
const fpsValue = document.querySelector('#fps-value')
const detectMsValue = document.querySelector('#detect-ms')
const cameraResolutionValue = document.querySelector('#camera-resolution')
const rawSpeedValue = document.querySelector('#raw-speed')
const trackingStateValue = document.querySelector('#tracking-state')
const missingDurationValue = document.querySelector('#missing-duration')
const predictionStateValue = document.querySelector('#prediction-state')
const rejectedCountValue = document.querySelector('#rejected-count')
const activeTargetsValue = document.querySelector('#active-targets')
const lastHitValue = document.querySelector('#last-hit')
const bridgeIndicator = document.querySelector('#bridge-indicator')

const finger = createFingerProcessor()
const slash = createSlashTracker()
const targets = createTargetSystem()
const game = createGameClock()

let stream = null
let handLandmarker = null
let animationFrameId = null
let sessionId = 0
let lastVideoTime = -1
let lastFrameTime = null
let nextSpawnAt = 0
let detectionCount = 0
let detectionWindowStart = 0
let averageDetectMs = 0
let lastDebugAt = 0
let displayWidth = 0
let displayHeight = 0
let cancelMetadataWait = null
let fingerDetected = false
let hadVisual = false

function setText(element, value) {
  const next = String(value)
  if (element.textContent !== next) element.textContent = next
}

function setStatus(message, isError = false) {
  if (game.state.phase === 'ended' && !isError) message = 'Round complete'
  setText(status, message)
  status.classList.toggle('error', isError)
}

function updateHud() {
  setText(timerValue, formatTime(game.state.remainingMs))
  setText(hitCountValue, targets.state.hits)
}

function updateDebug(now, force = false) {
  if (debugPanel.hidden || (!force && now - lastDebugAt < DEBUG_UPDATE_MS)) return
  lastDebugAt = now
  setText(detectMsValue, averageDetectMs.toFixed(1))
  setText(cameraResolutionValue, video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : '—')
  setText(rawSpeedValue, `${finger.state.rawSpeed.toFixed(2)} diag/s`)
  setText(trackingStateValue, slash.state.tracking)
  setText(missingDurationValue, slash.state.missingForMs)
  setText(predictionStateValue, slash.state.predictedPoint ? `${Math.round(slash.state.predictedMs)} ms` : 'OFF')
  setText(rejectedCountValue, finger.state.rejected)
  setText(activeTargetsValue, targets.activeCount())
  setText(lastHitValue, targets.state.lastHit
    ? `#${targets.state.lastHit.targetId} (${targets.state.lastHit.segmentType})`
    : '—')
  bridgeIndicator.hidden = slash.state.tracking !== 'DETECTED' || now >= slash.state.bridgedUntil
}

function resizeCanvas() {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * pixelRatio)
  canvas.height = Math.round(height * pixelRatio)
  // Game positions and collision radii stay in CSS pixels; only backing pixels scale.
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

  if (displayWidth && displayHeight && (width !== displayWidth || height !== displayHeight)) {
    finger.reset()
    slash.reset()
    targets.clearTargets()
    fingerDetected = false
  }
  displayWidth = width
  displayHeight = height
  drawScene(performance.now())
}

function drawTarget(target, now) {
  const effect = target.sliced ? Math.min(1, (now - target.slicedAt) / HIT_EFFECT_MS) : 0
  const radius = target.radius * (1 + effect * 0.5)
  context.save()
  context.globalAlpha = target.sliced ? 1 - effect : 1
  context.beginPath()
  context.arc(target.x, target.y, radius, 0, Math.PI * 2)
  context.fillStyle = target.sliced ? '#fff4c7' : target.color
  context.fill()
  context.lineWidth = 4
  context.strokeStyle = '#102136'
  context.stroke()
  if (target.sliced) {
    context.beginPath()
    context.moveTo(target.x - radius * 0.65, target.y + radius * 0.65)
    context.lineTo(target.x + radius * 0.65, target.y - radius * 0.65)
    context.lineWidth = 5
    context.stroke()
  } else {
    context.beginPath()
    context.arc(target.x, target.y, 4, 0, Math.PI * 2)
    context.fillStyle = '#102136'
    context.fill()
  }
  context.restore()
}

function drawScene(now) {
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
  for (const target of targets.state.targets) drawTarget(target, now)

  for (const segment of slash.state.trail) {
    const opacity = Math.max(0, 1 - (now - segment.at) / TRAIL_FADE_MS)
    context.beginPath()
    context.moveTo(segment.from.x, segment.from.y)
    context.lineTo(segment.to.x, segment.to.y)
    context.lineWidth = segment.predicted ? 8 : 10
    context.lineCap = 'round'
    context.strokeStyle = segment.predicted
      ? `rgba(255, 207, 141, ${opacity * 0.7})`
      : segment.bridged
        ? `rgba(255, 225, 160, ${opacity})`
        : `rgba(135, 220, 206, ${opacity})`
    context.stroke()
  }

  const ghost = slash.state.tracking === 'GRACE'
  const cursor = ghost ? slash.state.predictedPoint ?? finger.state.smooth : finger.state.smooth
  if (!cursor || (!fingerDetected && !ghost)) return
  const opacity = ghost && slash.state.lastReliableAt !== null
    ? Math.max(0, 1 - (now - slash.state.lastReliableAt) / TRACKING_LOSS_GRACE_MS)
    : 1
  if (opacity <= 0) return
  context.globalAlpha = opacity
  context.beginPath()
  context.arc(cursor.x, cursor.y, 13, 0, Math.PI * 2)
  context.fillStyle = '#8de7d8'
  context.fill()
  context.lineWidth = 3
  context.strokeStyle = '#102136'
  context.stroke()
  context.globalAlpha = 1
}

function applySlashSegment(segment, now) {
  if (segment && game.state.phase === 'running' && targets.hitWithSegment(segment, now).length) updateHud()
}

function processResult(result, now) {
  const tip = result.landmarks[0]?.[8]
  const point = tip && cameraPointToDisplay(
    tip.x, tip.y, video.videoWidth, video.videoHeight, canvas.clientWidth, canvas.clientHeight,
  )
  fingerDetected = Boolean(point)

  if (point) {
    const diagonal = Math.hypot(canvas.clientWidth, canvas.clientHeight)
    for (const sample of finger.sample(point, now, diagonal)) {
      const { segment } = slash.detected(sample.point, sample.at, diagonal)
      applySlashSegment(segment, now)
    }
    setStatus('Hand detected')
  } else {
    finger.state.pending = null
    applySlashSegment(slash.missing(now), now)
    setStatus(slash.state.tracking === 'GRACE' ? 'Tracking briefly lost…' : 'Show your hand')
  }
}

function spawnWave(now) {
  const difficulty = difficultyAt(game.state.elapsedMs)
  if (targets.activeCount() >= difficulty.activeLimit) return
  const roll = Math.random()
  const groupSize = roll < difficulty.tripleProbability
    ? 3
    : roll < difficulty.tripleProbability + difficulty.pairProbability ? 2 : 1
  for (let index = 0; index < groupSize; index += 1) {
    targets.spawn(canvas.clientWidth, canvas.clientHeight, now, {
      activeLimit: difficulty.activeLimit,
      speedScale: difficulty.launchSpeedScale,
      lanePosition: groupSize === 1 ? null : index / (groupSize - 1),
    })
  }
}

function updateDetectionStats(now, detectDuration) {
  detectionCount += 1
  averageDetectMs = averageDetectMs ? averageDetectMs * 0.85 + detectDuration * 0.15 : detectDuration
  const elapsed = now - detectionWindowStart
  if (elapsed >= 1000) {
    setText(fpsValue, Math.round(detectionCount * 1000 / elapsed))
    detectionCount = 0
    detectionWindowStart = now
  }
}

function frame(activeSession) {
  if (activeSession !== sessionId || !handLandmarker) return
  try {
    const now = performance.now()
    const dtSeconds = lastFrameTime === null ? 0 : (now - lastFrameTime) / 1000
    lastFrameTime = now

    if (game.update(now)) {
      targets.clearTargets()
      slash.reset()
      roundMessage.hidden = false
      startRoundButton.disabled = true
      spawnButton.disabled = true
      setStatus('Round complete')
    }
    if (game.state.phase === 'running') {
      targets.update(dtSeconds, now, canvas.clientWidth, canvas.clientHeight)
      if (now >= nextSpawnAt) {
        spawnWave(now)
        nextSpawnAt = now + difficultyAt(game.state.elapsedMs).spawnIntervalMs
      }
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
      const detectionStart = performance.now()
      const result = handLandmarker.detectForVideo(video, detectionStart)
      lastVideoTime = video.currentTime
      processResult(result, detectionStart)
      updateDetectionStats(performance.now(), performance.now() - detectionStart)
    }

    const renderNow = performance.now()
    slash.tick(renderNow)
    if (slash.state.tracking === 'LOST') {
      if (!fingerDetected && finger.state.raw) finger.reset()
      fingerDetected = false
      if (game.state.phase !== 'ended') setStatus('Show your hand')
    }
    updateHud()
    updateDebug(renderNow)
    const hasVisual = fingerDetected || slash.state.tracking === 'GRACE'
      || slash.state.trail.length > 0 || targets.state.targets.length > 0
    if (hasVisual || hadVisual) drawScene(renderNow)
    hadVisual = hasVisual
  } catch (error) {
    console.error('Tracking/game loop failed:', error)
    stopCamera('Tracking stopped. Please try again.', true)
    return
  }
  if (activeSession === sessionId) animationFrameId = requestAnimationFrame(() => frame(activeSession))
}

async function initializeHandTracker() {
  let vision
  try {
    vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
  } catch (error) {
    console.error('MediaPipe WASM initialization failed:', error)
    throw new Error('Could not load the hand tracking runtime. Check your internet connection.')
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
    function onMetadata() { cleanup(); resolve() }
    function onError() { cleanup(); reject(new Error('Camera video could not load.')) }
    cancelMetadataWait = () => { cleanup(); reject(new Error('Camera startup was cancelled.')) }
    video.addEventListener('loadedmetadata', onMetadata)
    video.addEventListener('error', onError)
  })
}

function cameraErrorMessage(error) {
  switch (error.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was denied. Allow camera access and try again.'
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
  if (cameraOnButton.disabled) return
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Camera access requires HTTPS or localhost in a supported browser.', true)
    return
  }
  const activeSession = ++sessionId
  cameraOnButton.disabled = true
  cameraOffButton.hidden = false
  setStatus('Requesting camera…')

  try {
    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
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
    stage.classList.add('is-active')
    resizeCanvas()
    setStatus('Loading hand tracker…')

    const tracker = await initializeHandTracker()
    if (activeSession !== sessionId) { tracker.close(); return }
    handLandmarker = tracker
    lastVideoTime = -1
    lastFrameTime = null
    detectionWindowStart = performance.now()
    detectionCount = 0
    startRoundButton.disabled = false
    resetRoundButton.disabled = false
    spawnButton.disabled = true
    cameraOnButton.hidden = true
    setStatus('Ready — press Start')
    updateDebug(performance.now(), true)
    animationFrameId = requestAnimationFrame(() => frame(activeSession))
  } catch (error) {
    if (activeSession !== sessionId) return
    console.error('Camera/tracker startup failed:', error)
    stopCamera(error.message, true)
  }
}

function resetRound() {
  game.reset()
  targets.reset()
  slash.reset()
  finger.reset()
  fingerDetected = false
  nextSpawnAt = 0
  roundMessage.hidden = true
  startRoundButton.disabled = !handLandmarker
  spawnButton.disabled = true
  updateHud()
  updateDebug(performance.now(), true)
  if (handLandmarker) setStatus('Ready — press Start')
  drawScene(performance.now())
}

function stopCamera(message = 'Camera off', isError = false) {
  sessionId += 1
  cancelMetadataWait?.()
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  animationFrameId = null
  try { handLandmarker?.close() } catch (error) { console.error('Could not close Hand Landmarker:', error) }
  handLandmarker = null
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  video.pause()
  video.srcObject = null
  stage.classList.remove('is-active')
  resetRound()
  lastVideoTime = -1
  lastFrameTime = null
  hadVisual = false
  setText(fpsValue, 0)
  averageDetectMs = 0
  cameraOnButton.hidden = false
  cameraOnButton.disabled = false
  cameraOffButton.hidden = true
  startRoundButton.disabled = true
  resetRoundButton.disabled = true
  spawnButton.disabled = true
  setStatus(message, isError)
}

new ResizeObserver(resizeCanvas).observe(stage)
cameraOnButton.addEventListener('click', startCamera)
cameraOffButton.addEventListener('click', () => stopCamera())
startRoundButton.addEventListener('click', () => {
  if (!handLandmarker || !game.start(performance.now())) return
  targets.reset()
  slash.reset()
  finger.reset()
  fingerDetected = false
  nextSpawnAt = performance.now() + FIRST_SPAWN_DELAY_MS
  startRoundButton.disabled = true
  spawnButton.disabled = false
  roundMessage.hidden = true
  setStatus('Show your hand and slash the targets')
  updateHud()
})
resetRoundButton.addEventListener('click', resetRound)
spawnButton.addEventListener('click', () => {
  if (!handLandmarker || game.state.phase !== 'running') return
  targets.spawn(canvas.clientWidth, canvas.clientHeight, performance.now(), {
    predictable: true,
    activeLimit: MAX_ACTIVE_TARGETS,
    speedScale: difficultyAt(game.state.elapsedMs).launchSpeedScale,
  })
  updateDebug(performance.now(), true)
})
debugToggle.addEventListener('click', () => {
  debugPanel.hidden = !debugPanel.hidden
  debugToggle.setAttribute('aria-expanded', String(!debugPanel.hidden))
  updateDebug(performance.now(), true)
})
