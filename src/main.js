import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { cameraPointToDisplay } from './geometry.js'
import { createFingerProcessor } from './tracking.js'
import { createHandMotionProcessor, estimateFingerFromHand, handAnchorFromLandmarks } from './hand.js'
import {
  createSlashTracker, HAND_PREDICTION_MIN_DIRECTION_COSINE,
  HAND_SLASH_START_SPEED, PREDICTION_MAX_MS, TRAIL_FADE_MS,
} from './slash.js'
import { createTargetSystem, HIT_EFFECT_MS, MAX_ACTIVE_TARGETS } from './targets.js'
import { createGameSession, difficultyAt, formatTime } from './game.js'
import './style.css'

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_URL = `${import.meta.env.BASE_URL}models/hand_landmarker.task`
const WORDMARK_URL = `${import.meta.env.BASE_URL}assets/nawras-name.png`
const TARGET_ICON_URL = `${import.meta.env.BASE_URL}assets/nawras-small.png`
const DEBUG_UPDATE_MS = 250
const FIRST_SPAWN_DELAY_MS = 750
const FLOATING_TEXT_MS = 800
const PARTICLE_MS = 450
const NUMBER_FORMAT = new Intl.NumberFormat()

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
const app = document.querySelector('.app')
const stateCallout = document.querySelector('#state-callout')
const comboIndicator = document.querySelector('#combo-indicator')
const timerStat = document.querySelector('#timer-stat')
const finalScoreValue = document.querySelector('#final-score')
const finalSlicedValue = document.querySelector('#final-sliced')
const finalComboValue = document.querySelector('#final-combo')
const highScoreValue = document.querySelector('#high-score')
const newHighScoreMessage = document.querySelector('#new-high-score')
const playAgainButton = document.querySelector('#play-again')
const readyBrand = document.querySelector('#ready-brand')
const readyWordmark = document.querySelector('#ready-wordmark')
const resultWordmark = document.querySelector('#result-wordmark')
const status = document.querySelector('#status')
const timerValue = document.querySelector('#timer')
const scoreValue = document.querySelector('#score')
const fpsValue = document.querySelector('#fps-value')
const detectMsValue = document.querySelector('#detect-ms')
const cameraResolutionValue = document.querySelector('#camera-resolution')
const rawSpeedValue = document.querySelector('#raw-speed')
const handSpeedValue = document.querySelector('#hand-speed')
const handDirectionStabilityValue = document.querySelector('#hand-direction-stability')
const fingerSourceValue = document.querySelector('#finger-source')
const trackingStateValue = document.querySelector('#tracking-state')
const slashArmedValue = document.querySelector('#slash-armed')
const missingDurationValue = document.querySelector('#missing-duration')
const predictionStateValue = document.querySelector('#prediction-state')
const predictionAgeValue = document.querySelector('#prediction-age')
const directionStabilityValue = document.querySelector('#direction-stability')
const rejectedCountValue = document.querySelector('#rejected-count')
const activeTargetsValue = document.querySelector('#active-targets')
const hitRadiusValue = document.querySelector('#hit-radius')
const collisionModeValue = document.querySelector('#collision-mode')
const lastHitValue = document.querySelector('#last-hit')
const bridgeIndicator = document.querySelector('#bridge-indicator')
const rawPathToggle = document.querySelector('#raw-path-toggle')
const motionSourceToggle = document.querySelector('#motion-source-toggle')

const finger = createFingerProcessor()
const hand = createHandMotionProcessor()
const slash = createSlashTracker()
const targets = createTargetSystem()
const game = createGameSession()
const assets = { ready: false, error: null, targetIcon: null }

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
let showRawPath = false
const rawTrail = []
const anchorTrail = []
let rawFingerSpeed = 0
const floatingTexts = []
const particles = []
let calloutUntil = 0

function setText(element, value) {
  const next = String(value)
  if (element.textContent !== next) element.textContent = next
}

function setStatus(message, isError = false) {
  if (assets.error && !isError) {
    message = 'NawrasEdu images could not load. Refresh to try again.'
    isError = true
  }
  if (game.state.phase === 'FINISHED' && !isError) message = 'Round complete'
  setText(status, message)
  status.classList.toggle('error', isError)
}

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth && image.naturalHeight) resolve(image)
      else reject(new Error(`Image has no dimensions: ${url}`))
    }
    image.onerror = (event) => {
      console.error(`NawrasEdu image failed to load: ${url}`, event)
      reject(new Error(`Could not load ${url}`))
    }
    image.src = url
  })
}

function refreshRoundStart() {
  startRoundButton.disabled = !handLandmarker || !assets.ready || game.state.phase !== 'READY'
  if (handLandmarker && game.state.phase === 'READY') {
    setStatus(assets.ready ? 'Ready — press Start' : 'Loading NawrasEdu images…')
  }
}

async function preloadAssets() {
  try {
    const [wordmark, targetIcon] = await Promise.all([
      preloadImage(WORDMARK_URL), preloadImage(TARGET_ICON_URL),
    ])
    assets.targetIcon = targetIcon
    assets.ready = true
    readyWordmark.src = wordmark.src
    resultWordmark.src = wordmark.src
    readyWordmark.hidden = false
    resultWordmark.hidden = false
    refreshRoundStart()
  } catch (error) {
    assets.error = error
    console.error('NawrasEdu asset preload failed:', error)
    setStatus('NawrasEdu images could not load. Refresh to try again.', true)
  }
}

function updateHud() {
  setText(timerValue, formatTime(game.state.remainingMs))
  setText(scoreValue, NUMBER_FORMAT.format(game.state.score))
  timerStat.classList.toggle('final-time', game.state.phase === 'PLAYING'
    && game.state.remainingMs <= 15000)
  const showCombo = game.state.phase === 'PLAYING' && game.state.combo > 1
  comboIndicator.hidden = !showCombo
  if (showCombo) {
    setText(comboIndicator, `x${game.state.combo} COMBO${game.state.combo === 5 ? '!' : ''}`)
    comboIndicator.dataset.level = String(game.state.combo)
  }
}

function syncPhaseUi() {
  app.dataset.phase = game.state.phase
  readyBrand.hidden = game.state.phase !== 'READY'
  roundMessage.hidden = game.state.phase !== 'FINISHED'
  startRoundButton.hidden = game.state.phase !== 'READY'
  resetRoundButton.hidden = game.state.phase === 'FINISHED'
  spawnButton.disabled = game.state.phase !== 'PLAYING'
  updateHud()
}

function showCallout(text, now, duration = 750) {
  setText(stateCallout, text)
  stateCallout.hidden = false
  stateCallout.classList.remove('pop')
  void stateCallout.offsetWidth
  stateCallout.classList.add('pop')
  calloutUntil = now + duration
}

function processGameEvents(now) {
  for (const event of game.drainEvents()) {
    // All future audio cues can be attached here by event.type.
    switch (event.type) {
      case 'countdown-tick':
        showCallout(String(event.number), now, 1050)
        break
      case 'round-start':
        nextSpawnAt = now + FIRST_SPAWN_DELAY_MS
        showCallout('SLASH!', now, 750)
        syncPhaseUi()
        setStatus('Show your hand and slash the targets')
        break
      case 'target-sliced':
        floatingTexts.push({ ...event, at: now })
        createParticles(event, now)
        updateHud()
        break
      case 'combo-increase':
      case 'combo-expired':
        updateHud()
        break
      case 'final-15':
        showCallout('FINAL 15!', now, 1050)
        break
      case 'new-high-score':
        break
      case 'round-finished':
        targets.clearTargets()
        slash.reset()
        floatingTexts.length = 0
        particles.length = 0
        stateCallout.hidden = true
        setText(finalScoreValue, NUMBER_FORMAT.format(game.state.score))
        setText(finalSlicedValue, NUMBER_FORMAT.format(game.state.targetsSliced))
        setText(finalComboValue, `x${game.state.bestCombo}`)
        setText(highScoreValue, NUMBER_FORMAT.format(game.state.highScore))
        newHighScoreMessage.hidden = !game.state.newHighScore
        syncPhaseUi()
        setStatus('Round complete')
        break
    }
  }
}

function createParticles(event, now) {
  const count = event.kind === 'golden' ? 10 : 6
  for (let index = 0; index < count; index += 1) {
    const angle = (index + Math.random() * 0.5) * Math.PI * 2 / count
    const speed = 70 + Math.random() * 80
    particles.push({ x: event.x, y: event.y, vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 25, at: now, golden: event.kind === 'golden' })
  }
}

function drawEffects(now) {
  for (const particle of particles) {
    const age = (now - particle.at) / 1000
    const fade = Math.max(0, 1 - (now - particle.at) / PARTICLE_MS)
    context.beginPath()
    context.arc(particle.x + particle.vx * age,
      particle.y + particle.vy * age + 90 * age * age, particle.golden ? 3.5 : 2.8, 0, Math.PI * 2)
    context.fillStyle = particle.golden
      ? `rgba(240, 174, 45, ${fade})` : `rgba(40, 166, 207, ${fade})`
    context.fill()
  }
  for (const feedback of floatingTexts) {
    const age = (now - feedback.at) / FLOATING_TEXT_MS
    context.save()
    context.globalAlpha = Math.max(0, 1 - age)
    context.font = `800 ${feedback.kind === 'golden' ? 30 : 26}px system-ui`
    context.textAlign = 'center'
    context.lineWidth = 4
    context.strokeStyle = '#10263b'
    context.fillStyle = feedback.kind === 'golden' ? '#ffe188' : '#fff'
    const y = feedback.y - 30 - age * 34
    context.strokeText(`+${feedback.points}`, feedback.x, y)
    context.fillText(`+${feedback.points}`, feedback.x, y)
    if (feedback.combo > 1) {
      context.font = '700 17px system-ui'
      context.strokeText(`x${feedback.combo}`, feedback.x, y + 21)
      context.fillText(`x${feedback.combo}`, feedback.x, y + 21)
    }
    context.restore()
  }
}

function updateEffects(now) {
  while (floatingTexts.length && now - floatingTexts[0].at >= FLOATING_TEXT_MS) floatingTexts.shift()
  while (particles.length && now - particles[0].at >= PARTICLE_MS) particles.shift()
  if (!stateCallout.hidden && now >= calloutUntil) stateCallout.hidden = true
}

function updateDebug(now, force = false) {
  if (debugPanel.hidden || (!force && now - lastDebugAt < DEBUG_UPDATE_MS)) return
  lastDebugAt = now
  setText(detectMsValue, averageDetectMs.toFixed(1))
  setText(cameraResolutionValue, video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : '—')
  setText(rawSpeedValue, `${rawFingerSpeed.toFixed(2)} diag/s`)
  setText(handSpeedValue, `${hand.state.handSpeed.toFixed(2)} diag/s`)
  setText(handDirectionStabilityValue, hand.state.reliableStreak >= 3
    ? hand.state.directionStability.toFixed(2) : '—')
  setText(fingerSourceValue, slash.state.motionSource === 'FINGER ONLY'
    ? hand.state.rawFinger ? 'RAW' : 'NONE' : hand.state.fingerSource)
  setText(trackingStateValue, slash.state.tracking)
  setText(slashArmedValue, slash.state.slashArmed ? 'YES' : 'NO')
  setText(missingDurationValue, slash.state.missingForMs)
  setText(predictionStateValue, slash.state.predictionActive ? 'ON' : 'OFF')
  setText(predictionAgeValue, `${Math.round(slash.state.predictedMs)} ms`)
  setText(directionStabilityValue, slash.state.reliableStreak >= 3
    ? slash.state.directionStability.toFixed(2) : '—')
  setText(rejectedCountValue, finger.state.rejected)
  setText(activeTargetsValue, targets.activeCount())
  setText(hitRadiusValue, targets.state.lastCollision
    ? `${targets.state.lastCollision.radius} px` : '—')
  setText(collisionModeValue, targets.state.lastCollision?.mode ?? '—')
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
    hand.reset()
    slash.reset()
    targets.clearTargets()
    fingerDetected = false
    rawTrail.length = 0
    anchorTrail.length = 0
    rawFingerSpeed = 0
  }
  displayWidth = width
  displayHeight = height
  drawScene(performance.now())
}

function drawTarget(target, now) {
  if (!assets.targetIcon) return
  const effect = target.sliced ? Math.min(1, (now - target.slicedAt) / HIT_EFFECT_MS) : 0
  const radius = target.radius
  context.save()
  context.globalAlpha = target.sliced ? 1 - effect : 1
  if (target.kind === 'golden') {
    context.save()
    context.shadowColor = '#e6a527'
    context.shadowBlur = 20 + Math.sin(now / 180) * 5
    context.strokeStyle = 'rgba(255, 209, 83, 0.95)'
    context.lineWidth = 3
    context.beginPath()
    context.arc(target.x, target.y, radius * 1.48 + Math.sin(now / 210) * 2, 0, Math.PI * 2)
    context.stroke()
    context.restore()
    for (let index = 0; index < 4; index += 1) {
      const angle = now / 950 + index * Math.PI / 2
      const distance = radius * 1.64
      const x = target.x + Math.cos(angle) * distance
      const y = target.y + Math.sin(angle) * distance
      context.beginPath()
      context.arc(x, y, 2.5, 0, Math.PI * 2)
      context.fillStyle = '#f8d066'
      context.fill()
    }
  }
  if (target.sliced) {
    // Two clipped copies preserve the official image while the halves separate.
    for (const side of [-1, 1]) {
      context.save()
      const direction = target.hitDirection ?? { x: 1, y: 0 }
      context.translate(side * direction.x * effect * radius * 0.48,
        side * direction.y * effect * radius * 0.48 + effect * radius * 0.18)
      context.translate(target.x, target.y)
      context.rotate(side * effect * 0.14)
      context.translate(-target.x, -target.y)
      const tangent = target.hitTangent ?? { x: 0, y: 1 }
      const normal = target.hitDirection ?? { x: 1, y: 0 }
      const span = radius * 3
      context.beginPath()
      context.moveTo(target.x - tangent.x * span, target.y - tangent.y * span)
      context.lineTo(target.x + tangent.x * span, target.y + tangent.y * span)
      context.lineTo(target.x + tangent.x * span + side * normal.x * span,
        target.y + tangent.y * span + side * normal.y * span)
      context.lineTo(target.x - tangent.x * span + side * normal.x * span,
        target.y - tangent.y * span + side * normal.y * span)
      context.closePath()
      context.clip()
      context.drawImage(assets.targetIcon, target.x - radius, target.y - radius,
        radius * 2, radius * 2)
      context.restore()
    }
    context.beginPath()
    context.arc(target.x, target.y, radius * (0.8 + effect * 0.4), 0, Math.PI * 2)
    context.lineWidth = 4 * (1 - effect)
    context.strokeStyle = target.kind === 'golden' ? '#ffe28a' : '#e7faff'
    context.stroke()
  } else {
    context.drawImage(assets.targetIcon, target.x - radius, target.y - radius,
      radius * 2, radius * 2)
  }
  context.restore()
}

function drawScene(now) {
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
  for (const target of targets.state.targets) drawTarget(target, now)
  drawEffects(now)

  if (showRawPath && !debugPanel.hidden) {
    context.lineCap = 'round'
    for (let index = 1; index < rawTrail.length; index += 1) {
      const opacity = Math.max(0, 1 - (now - rawTrail[index].at) / 300)
      if (!opacity || rawTrail[index].at - rawTrail[index - 1].at > 100) continue
      context.lineWidth = 2
      context.strokeStyle = `rgba(46, 72, 94, ${opacity * 0.5})`
      context.beginPath()
      context.moveTo(rawTrail[index - 1].x, rawTrail[index - 1].y)
      context.lineTo(rawTrail[index].x, rawTrail[index].y)
      context.stroke()
    }
    context.lineWidth = 2
    context.lineCap = 'round'
    for (let index = 1; index < anchorTrail.length; index += 1) {
      const opacity = Math.max(0, 1 - (now - anchorTrail[index].at) / 300)
      if (!opacity || anchorTrail[index].at - anchorTrail[index - 1].at > 100) continue
      context.strokeStyle = `rgba(122, 49, 159, ${opacity * 0.55})`
      context.beginPath()
      context.moveTo(anchorTrail[index - 1].x, anchorTrail[index - 1].y)
      context.lineTo(anchorTrail[index].x, anchorTrail[index].y)
      context.stroke()
    }
  }

  for (const segment of slash.state.trail) {
    const opacity = Math.max(0, 1 - (now - segment.at) / TRAIL_FADE_MS)
    if (!opacity) continue
    context.beginPath()
    context.moveTo(segment.from.x, segment.from.y)
    context.lineTo(segment.to.x, segment.to.y)
    context.lineWidth = (segment.predicted ? 5 : 6) + 7 * opacity
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = segment.predicted
      ? `rgba(181, 91, 13, ${opacity * 0.8})`
      : segment.bridged
        ? `rgba(18, 117, 143, ${opacity})`
        : `rgba(9, 104, 156, ${opacity})`
    context.stroke()
    context.lineWidth = Math.max(1.5, context.lineWidth * 0.28)
    context.strokeStyle = segment.predicted
      ? `rgba(255, 228, 180, ${opacity})`
      : `rgba(231, 255, 255, ${opacity})`
    context.stroke()
  }

  if (showRawPath && !debugPanel.hidden) {
    const raw = rawTrail.at(-1)
    if (raw && now - raw.at < 300) {
      context.beginPath()
      context.arc(raw.x, raw.y, 5, 0, Math.PI * 2)
      context.fillStyle = '#f09835'
      context.fill()
    }
    const anchor = anchorTrail.at(-1)
    if (anchor && now - anchor.at < 300) {
      context.beginPath()
      context.arc(anchor.x, anchor.y, 7, 0, Math.PI * 2)
      context.fillStyle = '#a869cc'
      context.fill()
      context.lineWidth = 2
      context.strokeStyle = '#fff'
      context.stroke()
    }
  }

  const ghost = slash.state.predictionActive
  const cursor = ghost ? slash.state.predictedPoint ?? finger.state.smooth : finger.state.smooth
  if (!cursor || (!fingerDetected && !ghost)) return
  const opacity = ghost && slash.state.lastReliableAt !== null
    ? Math.max(0, 1 - (now - slash.state.lastReliableAt) / PREDICTION_MAX_MS)
    : 1
  if (opacity <= 0) return
  context.globalAlpha = opacity
  context.beginPath()
  context.arc(cursor.x, cursor.y, 15, 0, Math.PI * 2)
  context.fillStyle = '#00c8df'
  context.fill()
  context.lineWidth = 4
  context.strokeStyle = '#073c55'
  context.stroke()
  context.beginPath()
  context.arc(cursor.x, cursor.y, 4, 0, Math.PI * 2)
  context.fillStyle = '#fff'
  context.fill()
  context.globalAlpha = 1
}

function applySlashSegment(segment, now) {
  if (!segment || game.state.phase !== 'PLAYING') return
  const hits = targets.hitWithSegment(segment, now)
  if (!hits.length) return
  const dx = segment.to.x - segment.from.x
  const dy = segment.to.y - segment.from.y
  const length = Math.hypot(dx, dy) || 1
  for (const target of hits) {
    target.hitDirection = { x: -dy / length, y: dx / length }
    target.hitTangent = { x: dx / length, y: dy / length }
    game.scoreTarget(target, now)
  }
  processGameEvents(now)
}

function processResult(result, now) {
  const landmarks = result.landmarks[0]
  const tip = landmarks?.[8]
  const rawPoint = tip && Number.isFinite(tip.x) && Number.isFinite(tip.y)
    ? cameraPointToDisplay(tip.x, tip.y, video.videoWidth, video.videoHeight,
      canvas.clientWidth, canvas.clientHeight)
    : null
  const anchorNormalized = handAnchorFromLandmarks(landmarks)
  const anchor = anchorNormalized && cameraPointToDisplay(
    anchorNormalized.x, anchorNormalized.y, video.videoWidth, video.videoHeight,
    canvas.clientWidth, canvas.clientHeight,
  )
  const diagonal = Math.hypot(canvas.clientWidth, canvas.clientHeight)
  const handSample = landmarks ? hand.sample(anchor, rawPoint, now, diagonal) : null
  if (landmarks && slash.state.motionSource === 'HYBRID') slash.observeMotion(handSample.motion)
  const point = slash.state.motionSource === 'HYBRID' ? handSample?.point : rawPoint
  fingerDetected = Boolean(point)

  if (rawPoint) {
    const previous = rawTrail.at(-1)
    const elapsed = previous ? now - previous.at : 0
    rawFingerSpeed = previous && elapsed > 0 && elapsed <= 150
      ? Math.hypot(rawPoint.x - previous.x, rawPoint.y - previous.y) * 1000 / (diagonal * elapsed)
      : 0
    rawTrail.push({ ...rawPoint, at: now })
    while (rawTrail.length > 16 || (rawTrail.length && now - rawTrail[0].at > 300)) rawTrail.shift()
  } else rawFingerSpeed = 0
  if (anchor) {
    anchorTrail.push({ ...hand.state.smoothedHandAnchor, at: now })
    while (anchorTrail.length > 16 || (anchorTrail.length && now - anchorTrail[0].at > 300)) anchorTrail.shift()
  }

  if (point) {
    let samples = slash.state.motionSource === 'HYBRID' && handSample.fingerSource === 'ESTIMATED'
      ? finger.sampleEstimated(point, now, diagonal)
      : finger.sample(point, now, diagonal)
    if (!samples.length && slash.state.motionSource === 'HYBRID'
      && handSample.motion?.offsetFresh && handSample.motion.reliableStreak >= 3
      && handSample.motion.speed >= HAND_SLASH_START_SPEED
      && handSample.motion.directionStability >= HAND_PREDICTION_MIN_DIRECTION_COSINE) {
      const estimate = estimateFingerFromHand(handSample.motion.anchor, handSample.motion.offset)
      samples = finger.sampleEstimated(estimate, now, diagonal)
      hand.state.fingerSource = 'ESTIMATED'
      handSample.motion.fingerSource = 'ESTIMATED'
    }
    for (const sample of samples) {
      const motion = slash.state.motionSource === 'HYBRID' ? handSample.motion : undefined
      const { segment } = slash.detected(sample.point, sample.at, diagonal, motion)
      applySlashSegment(segment, now)
    }
    if (finger.state.pending && (slash.state.motionSource === 'FINGER ONLY'
      || !handSample.motion?.offsetFresh)) slash.disarm()
    setStatus('Hand detected')
  } else {
    finger.state.pending = null
    if (!landmarks) hand.markMissing()
    applySlashSegment(slash.missing(now), now)
    setStatus(slash.state.predictionActive ? 'Predicting slash…'
      : slash.state.tracking === 'GRACE' ? 'Tracking briefly lost…' : 'Show your hand')
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

    game.update(now)
    processGameEvents(now)
    if (game.canSpawn()) {
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
    while (rawTrail.length && renderNow - rawTrail[0].at > 300) rawTrail.shift()
    while (anchorTrail.length && renderNow - anchorTrail[0].at > 300) anchorTrail.shift()
    applySlashSegment(slash.tick(renderNow), renderNow)
    if (slash.state.tracking !== 'DETECTED') {
      fingerDetected = false
      if (game.state.phase !== 'FINISHED') setStatus(slash.state.predictionActive
        ? 'Predicting slash…'
        : slash.state.tracking === 'GRACE' ? 'Tracking briefly lost…' : 'Show your hand')
    }
    if (slash.state.tracking === 'LOST' && !slash.state.predictionActive) {
      if (!fingerDetected && finger.state.raw) finger.reset()
      if (!fingerDetected && hand.state.rawHandAnchor) hand.reset()
    }
    updateHud()
    updateDebug(renderNow)
    updateEffects(renderNow)
    const hasVisual = fingerDetected || slash.state.predictionActive
      || slash.state.trail.length > 0 || targets.state.targets.length > 0
      || floatingTexts.length > 0 || particles.length > 0
      || (showRawPath && !debugPanel.hidden && (rawTrail.length > 0 || anchorTrail.length > 0))
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
    resetRoundButton.disabled = false
    spawnButton.disabled = true
    cameraOnButton.hidden = true
    refreshRoundStart()
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
  floatingTexts.length = 0
  particles.length = 0
  stateCallout.hidden = true
  calloutUntil = 0
  slash.reset()
  finger.reset()
  hand.reset()
  fingerDetected = false
  rawTrail.length = 0
  anchorTrail.length = 0
  rawFingerSpeed = 0
  nextSpawnAt = 0
  syncPhaseUi()
  refreshRoundStart()
  updateHud()
  updateDebug(performance.now(), true)
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
preloadAssets()
cameraOnButton.addEventListener('click', startCamera)
cameraOffButton.addEventListener('click', () => stopCamera())
function beginRound() {
  if (!handLandmarker || !assets.ready || !game.startCountdown(performance.now())) return
  targets.reset()
  slash.reset()
  finger.reset()
  hand.reset()
  fingerDetected = false
  rawTrail.length = 0
  anchorTrail.length = 0
  rawFingerSpeed = 0
  startRoundButton.disabled = true
  syncPhaseUi()
  processGameEvents(performance.now())
  setStatus('Get ready')
}
startRoundButton.addEventListener('click', beginRound)
resetRoundButton.addEventListener('click', resetRound)
playAgainButton.addEventListener('click', () => {
  if (!handLandmarker || !assets.ready) return
  resetRound()
  beginRound()
})
spawnButton.addEventListener('click', () => {
  if (!handLandmarker || !game.canSpawn()) return
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
rawPathToggle.addEventListener('click', () => {
  showRawPath = !showRawPath
  rawPathToggle.setAttribute('aria-pressed', String(showRawPath))
  setText(rawPathToggle, `Tracking overlay: ${showRawPath ? 'SHOW' : 'HIDE'}`)
})
motionSourceToggle.addEventListener('click', () => {
  slash.setMotionSource(slash.state.motionSource === 'HYBRID' ? 'FINGER ONLY' : 'HYBRID')
  finger.reset()
  hand.reset()
  rawTrail.length = 0
  anchorTrail.length = 0
  rawFingerSpeed = 0
  fingerDetected = false
  setText(motionSourceToggle, `Motion source: ${slash.state.motionSource}`)
  updateDebug(performance.now(), true)
  drawScene(performance.now())
})
