import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { cameraPointToDisplay } from './geometry.js'
import { createFingerProcessor } from './tracking.js'
import { createHandMotionProcessor, estimateFingerFromHand, handAnchorFromLandmarks } from './hand.js'
import {
  createSlashTracker, HAND_PREDICTION_MIN_DIRECTION_COSINE,
  HAND_SLASH_START_SPEED, PREDICTION_MAX_MS, TRAIL_FADE_MS,
} from './slash.js'
import { createTargetSystem, HIT_EFFECT_MS, GOLDEN_HIT_EFFECT_MS, MAX_ACTIVE_TARGETS } from './targets.js'
import { createGameSession, difficultyAt, formatTime } from './game.js'
import { createAudioSystem, soundCueForEvent } from './audio.js'
import { calloutPhaseAt, comboPresentation, displayedResultScore, resultSummary, RESULT_COUNTUP_MS,
  bugImpactStrength, BUG_WASH_MS } from './presentation.js'
import { REQUIRED_ASSETS, ORDINARY_TARGETS, TARGET_BY_ID } from './catalog.js'
import { containedImageRect, sliceClipPolygon } from './rendering.js'
import { createCameraSession, FINISHED_CAMERA_RELEASE_MS } from './camera.js'
import { createDeveloperUi } from './developer-ui.js'
import { createFullscreenController } from './fullscreen.js'
import { resetPlayerTracking } from './player-state.js'
import { createReplayFlow } from './replay.js'
import { createResetConfirmation, resetGameVisible } from './reset-game.js'
import { createLeaderboard } from './leaderboard.js'
import { createPlayerSession } from './player-session.js'
import { createFinishedIdle } from './finished-idle.js'
import { activeReadyAmbientCount, populateReadyAmbient } from './ready-ambient.js'
import { createPerformanceMonitor } from './performance-monitor.js'
import { WEB_RUSH_CONFIG, spawnProfileFor, groupSizeForRoll } from './web-rush.js'
import './style.css'

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_URL = `${import.meta.env.BASE_URL}models/hand_landmarker.task`
const DEBUG_UPDATE_MS = 250
const FIRST_SPAWN_DELAY_MS = 750
const FLOATING_TEXT_MS = 800
const PARTICLE_MS = 450
const GOLDEN_PARTICLE_MS = 520
const MAX_GAMEPLAY_PARTICLES = 160
const GOLDEN_LIVE_MOTES = 6
const NUMBER_FORMAT = new Intl.NumberFormat()

const stage = document.querySelector('#camera-stage')
const readyAmbient = document.querySelector('#ready-ambient')
const video = document.querySelector('#camera-video')
const canvas = document.querySelector('#tracking-canvas')
const context = canvas.getContext('2d')
const cameraOnButton = document.querySelector('#start-camera')
const cameraOffButton = document.querySelector('#stop-camera')
const startRoundButton = document.querySelector('#start-round')
const resetRoundButton = document.querySelector('#reset-round')
const resetGameButton = document.querySelector('#reset-game')
const clearLeaderboardButton = document.querySelector('#clear-leaderboard')
const spawnButton = document.querySelector('#spawn-target')
const webRushButton = document.querySelector('#trigger-web-rush')
const targetTypeSelect = document.querySelector('#target-type')
const debugPanel = document.querySelector('#debug-panel')
const cameraError = document.querySelector('#camera-error')
const cameraErrorText = document.querySelector('#camera-error-text')
const cameraRetryButton = document.querySelector('#camera-retry')
const roundMessage = document.querySelector('#round-message')
const app = document.querySelector('.app')
const stateCallout = document.querySelector('#state-callout')
const comboIndicator = document.querySelector('#combo-indicator')
const timerStat = document.querySelector('#timer-stat')
const finalScoreValue = document.querySelector('#final-score')
const finalSlicedValue = document.querySelector('#final-sliced')
const finalComboValue = document.querySelector('#final-combo')
const newHighScoreMessage = document.querySelector('#new-high-score')
const personalBestMessage = document.querySelector('#personal-best')
const resultPlayer = document.querySelector('#result-player')
const leaderboardList = document.querySelector('#leaderboard-list')
const leaderboardEmpty = document.querySelector('#leaderboard-empty')
const playAgainButton = document.querySelector('#play-again')
const newPlayerButton = document.querySelector('#new-player')
const finishedIdleCountdown = document.querySelector('#finished-idle-countdown')
const soundButton = document.querySelector('#sound-toggle')
const readyBrand = document.querySelector('#ready-brand')
const playerEntry = document.querySelector('#player-entry')
const playerEntryStart = document.querySelector('#player-entry-start')
const playerNameInput = document.querySelector('#player-name')
const playerNameError = document.querySelector('#player-name-error')
const readyPlayer = document.querySelector('#ready-player')
const readyPlayerName = document.querySelector('#ready-player-name')
const changePlayerButton = document.querySelector('#change-player')
const readyWordmark = document.querySelector('#ready-wordmark')
const hudWordmark = document.querySelector('#hud-wordmark')
const resultWordmark = document.querySelector('#result-wordmark')
const status = document.querySelector('#status')
const timerValue = document.querySelector('#timer')
const scoreValue = document.querySelector('#score')
const fpsValue = document.querySelector('#fps-value')
const detectMsValue = document.querySelector('#detect-ms')
const renderFpsValue = document.querySelector('#render-fps')
const frameMsValue = document.querySelector('#frame-ms')
const workMsValue = document.querySelector('#work-ms')
const worstFrameMsValue = document.querySelector('#worst-frame-ms')
const slowFramesValue = document.querySelector('#slow-frames')
const gameplayParticlesValue = document.querySelector('#gameplay-particles')
const sliceFragmentsValue = document.querySelector('#slice-fragments')
const slashSegmentsValue = document.querySelector('#slash-segments')
const readyParticlesValue = document.querySelector('#ready-particles')
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
const leaderboard = createLeaderboard()
const playerSession = createPlayerSession(leaderboard)
const audio = createAudioSystem()
const frameMonitor = createPerformanceMonitor()
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
const assets = { ready: false, error: null, images: new Map() }
const developerUi = createDeveloperUi(debugPanel)
const fullscreen = createFullscreenController({
  document,
  hint: document.querySelector('#fullscreen-hint'),
  getPhase: () => game.state.phase,
})
const finishedIdle = createFinishedIdle({
  onCountdown: (seconds) => {
    finishedIdleCountdown.hidden = seconds === null
    if (seconds !== null) setText(finishedIdleCountdown, `NEXT PLAYER IN ${seconds}`)
  },
  onExpire: () => enterNewPlayer(),
})
const camera = createCameraSession({
  video,
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  onUnexpectedEnd: () => handleCameraLoss(),
})
const resetConfirmation = createResetConfirmation({
  isPlaying: () => resetGameVisible(game.state.phase),
  onConfirm: () => releaseCamera(),
  onChange: (armed) => {
    setText(resetGameButton, armed ? 'RESET?' : 'RESET GAME')
    resetGameButton.classList.toggle('armed', armed)
    resetGameButton.setAttribute('aria-label', armed ? 'Confirm reset game' : 'Reset game')
  },
})
const clearLeaderboardConfirmation = createResetConfirmation({
  isPlaying: () => developerUi.state.visible,
  onConfirm: () => { leaderboard.clear(); renderLeaderboard() },
  onChange: (armed) => {
    setText(clearLeaderboardButton, armed ? 'CLEAR ALL?' : 'CLEAR LEADERBOARD')
    clearLeaderboardButton.classList.toggle('armed', armed)
  },
})

let handLandmarker = null
let animationFrameId = null
let cameraStartPromise = null
let retryContext = 'initial'
let mouseIdleTimer = null
let sessionId = 0
let lastVideoTime = -1
let lastFrameTime = null
let nextSpawnAt = 0
let detectionCount = 0
let detectionWindowStart = 0
let inferenceFps = 0
let lastInferenceAt = 0
let averageDetectMs = 0
let lastDebugAt = 0
let displayWidth = 0
let displayHeight = 0
let displayDiagonal = 0
let displayPixelRatio = 0
let cancelMetadataWait = null
let fingerDetected = false
let hadVisual = false
let showRawPath = false
const rawTrail = []
const anchorTrail = []
let rawFingerSpeed = 0
const floatingTexts = []
const particles = []
const reusableParticles = []
let calloutUntil = 0
let bugImpactAt = null
let resultShownAt = null
let beginningRound = false
let roundRequestId = 0
let playerEntryStarting = false
let lastHudSecond = null
let lastHudScore = null

function setText(element, value) {
  const next = String(value)
  if (element.textContent !== next) element.textContent = next
}

function setClass(element, name, enabled) {
  if (element.classList.contains(name) !== enabled) element.classList.toggle(name, enabled)
}

function syncPlayerUi() {
  const player = playerSession.state.currentPlayer
  app.classList.toggle('needs-player', !player)
  playerEntry.hidden = Boolean(player)
  readyPlayer.hidden = !player
  if (player) setText(readyPlayerName, player.name)
  playerEntryStart.disabled = playerEntryStarting
  changePlayerButton.disabled = playerEntryStarting
}

function renderLeaderboard() {
  const top = leaderboard.top()
  const rows = top.map((entry, index) => {
    const row = document.createElement('li')
    row.classList.toggle('current-player', entry.id === playerSession.state.currentPlayer?.id)
    const place = document.createElement('span')
    place.className = 'leaderboard-place'
    setText(place, index + 1)
    const name = document.createElement('span')
    name.className = 'leaderboard-name'
    setText(name, entry.name)
    const score = document.createElement('strong')
    score.className = 'leaderboard-score'
    setText(score, NUMBER_FORMAT.format(entry.bestScore))
    row.append(place, name, score)
    return row
  })
  leaderboardList.replaceChildren(...rows)
  leaderboardEmpty.hidden = top.length > 0
}

function renderPersonalResult(result) {
  const player = playerSession.state.currentPlayer
  setText(resultPlayer, player ? `PLAYER: ${player.name}` : '')
  const rankLabel = result?.rank && result.rank > 5 ? ` · YOUR RANK #${result.rank}` : ''
  setText(personalBestMessage, result
    ? `PERSONAL BEST: ${NUMBER_FORMAT.format(result.bestScore)}${rankLabel}` : '')
  setText(newHighScoreMessage, result?.status === 'first' ? '✦ FIRST SCORE! ✦'
    : result?.status === 'improved' ? '✦ NEW PERSONAL BEST! ✦' : '')
  renderLeaderboard()
}

function setStatus(message, isError = false) {
  if (assets.error && !isError) {
    message = 'A game image could not load. Refresh to try again.'
    isError = true
  }
  if (status.textContent === message && status.hidden === !message
    && status.classList.contains('error') === isError) return
  setText(status, message)
  status.hidden = !message
  status.classList.toggle('error', isError)
}

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth && image.naturalHeight) resolve(image)
      else {
        console.error(`Game image has no dimensions: ${url}`)
        reject(new Error(`Image has no dimensions: ${url}`))
      }
    }
    image.onerror = (event) => {
      console.error(`NawrasEdu image failed to load: ${url}`, event)
      reject(new Error(`Could not load ${url}`))
    }
    image.src = url
  })
}

function refreshRoundStart() {
  startRoundButton.disabled = !camera.state.active || !handLandmarker || !assets.ready
    || game.state.phase !== 'READY' || !playerSession.state.currentPlayer
  syncPhaseUi()
  if (camera.state.active && handLandmarker && game.state.phase === 'READY') {
    setStatus(assets.ready ? 'Ready — press Start' : 'Loading game images…')
  }
}

function updateSoundButton() {
  const on = audio.state.enabled && !audio.state.failed
  setText(soundButton, on ? 'SOUND ON' : 'SOUND OFF')
  soundButton.setAttribute('aria-pressed', String(on))
}

async function preloadAssets() {
  try {
    const loaded = await Promise.all(REQUIRED_ASSETS.map(async ({ id, asset }) => [
      id, await preloadImage(`${import.meta.env.BASE_URL}${asset}`),
    ]))
    assets.images = new Map(loaded)
    // Tint the transparent artwork once; hit frames reuse this small cached canvas.
    const bugImage = assets.images.get('bug')
    const bugImpactImage = document.createElement('canvas')
    bugImpactImage.width = bugImage.naturalWidth
    bugImpactImage.height = bugImage.naturalHeight
    const impactContext = bugImpactImage.getContext('2d')
    impactContext.drawImage(bugImage, 0, 0)
    impactContext.globalCompositeOperation = 'source-in'
    impactContext.fillStyle = '#f02030'
    impactContext.fillRect(0, 0, bugImpactImage.width, bugImpactImage.height)
    assets.images.set('bug-impact', bugImpactImage)
    assets.ready = true
    readyWordmark.src = assets.images.get('wordmark').src
    hudWordmark.src = assets.images.get('wordmark').src
    resultWordmark.src = assets.images.get('wordmark').src
    readyWordmark.hidden = false
    hudWordmark.hidden = false
    resultWordmark.hidden = false
    refreshRoundStart()
  } catch (error) {
    assets.error = error
    console.error('Game asset preload failed:', error)
    setStatus(`A game image could not load: ${error.message}. Refresh to try again.`, true)
  }
}

function updateHud() {
  const displayedSecond = Math.ceil(game.state.remainingMs / 1000)
  if (displayedSecond !== lastHudSecond) {
    setText(timerValue, formatTime(game.state.remainingMs))
    lastHudSecond = displayedSecond
  }
  if (game.state.score !== lastHudScore) {
    setText(scoreValue, NUMBER_FORMAT.format(game.state.score))
    lastHudScore = game.state.score
  }
  const finalTime = game.state.phase === 'PLAYING' && game.state.remainingMs <= 15000
  setClass(timerStat, 'final-time', finalTime)
  setClass(app, 'finale', finalTime)
  setClass(app, 'web-rush', game.state.phase === 'PLAYING' && game.state.webRushActive)
  const rushDisabled = game.state.phase !== 'PLAYING' || game.state.webRushTriggered
    || game.state.remainingMs <= 15000
  if (webRushButton.disabled !== rushDisabled) webRushButton.disabled = rushDisabled
  const showCombo = game.state.phase === 'PLAYING' && (game.state.combo > 1 || game.state.combo === 0)
  if (comboIndicator.hidden !== !showCombo) comboIndicator.hidden = !showCombo
  if (showCombo) {
    const next = comboPresentation(game.state.combo)
    if (comboIndicator.textContent !== next) {
      setText(comboIndicator, next)
      comboIndicator.classList.remove('bump')
      void comboIndicator.offsetWidth
      comboIndicator.classList.add('bump')
    }
    const level = String(game.state.scoreMultiplier)
    if (comboIndicator.dataset.level !== level) comboIndicator.dataset.level = level
  }
}

function clearMouseIdle() {
  if (mouseIdleTimer !== null) clearTimeout(mouseIdleTimer)
  mouseIdleTimer = null
  app.classList.remove('cursor-idle')
}

function armMouseIdle() {
  clearMouseIdle()
  if (game.state.phase !== 'PLAYING') return
  mouseIdleTimer = setTimeout(() => {
    mouseIdleTimer = null
    if (game.state.phase === 'PLAYING') app.classList.add('cursor-idle')
  }, 1700)
}

function syncPhaseUi() {
  if (game.state.phase !== 'FINISHED') finishedIdle.stop()
  app.dataset.phase = game.state.phase
  fullscreen.sync()
  if (game.state.phase === 'PLAYING') armMouseIdle()
  else { clearMouseIdle(); bugImpactAt = null }
  syncPlayerUi()
  resetGameButton.hidden = !resetGameVisible(game.state.phase)
  if (!resetGameVisible(game.state.phase) && resetConfirmation.state.armed) resetConfirmation.clear()
  readyBrand.hidden = game.state.phase !== 'READY'
  roundMessage.hidden = game.state.phase !== 'FINISHED'
  startRoundButton.hidden = game.state.phase !== 'READY' || !camera.state.active || !handLandmarker
    || !playerSession.state.currentPlayer
  resetRoundButton.hidden = game.state.phase === 'READY' || game.state.phase === 'FINISHED'
  spawnButton.disabled = game.state.phase !== 'PLAYING' || !camera.state.active
  updateHud()
}

function showCallout(text, now, duration = 750, kind = '') {
  setText(stateCallout, text)
  stateCallout.dataset.kind = kind
  stateCallout.hidden = false
  stateCallout.classList.remove('pop', 'exiting')
  void stateCallout.offsetWidth
  stateCallout.classList.add('pop')
  calloutUntil = now + duration
}

function processGameEvents(now) {
  for (const event of game.drainEvents()) {
    const cue = soundCueForEvent(event)
    if (cue) audio.cue(cue.name, cue.detail)
    switch (event.type) {
      case 'countdown-tick':
        showCallout(String(event.number), now, 1050, `countdown-${event.number}`)
        break
      case 'round-start':
        nextSpawnAt = now + FIRST_SPAWN_DELAY_MS
        showCallout('START!', now, 820, 'go')
        syncPhaseUi()
        setStatus('Show your hand and slash the targets')
        break
      case 'target-sliced':
        floatingTexts.push({ ...event, at: now })
        createParticles(event, now)
        updateHud()
        break
      case 'bug-hit':
        floatingTexts.push({ ...event, at: now })
        createParticles(event, now)
        bugImpactAt = now
        updateHud()
        break
      case 'combo-increase':
        updateHud()
        break
      case 'combo-expired':
        updateHud()
        break
      case 'web-rush-start':
        nextSpawnAt = now
        showCallout('WEB RUSH!', now, WEB_RUSH_CONFIG.announcementMs, 'web-rush')
        updateHud()
        break
      case 'web-rush-end':
        nextSpawnAt = now + difficultyAt(game.state.elapsedMs).spawnIntervalMs
        updateHud()
        break
      case 'final-15':
        showCallout('FINAL 15', now, 950, 'finale')
        updateHud()
        break
      case 'final-ten-tick':
        timerStat.dataset.urgency = event.second <= 3 ? 'high' : 'rising'
        timerStat.classList.remove('tick-pulse')
        void timerStat.offsetWidth
        timerStat.classList.add('tick-pulse')
        break
      case 'new-high-score':
        break
      case 'round-finished':
        renderPersonalResult(playerSession.recordFinishedRound(game.state.score))
        targets.clearTargets()
        slash.reset()
        stateCallout.hidden = true
        stateCallout.classList.remove('exiting')
        resultShownAt = now
        roundMessage.classList.remove('settled')
        timerStat.classList.remove('tick-pulse')
        setText(finalScoreValue, '0')
        const summary = resultSummary(game.state)
        setText(finalSlicedValue, NUMBER_FORMAT.format(summary.sliced))
        setText(finalComboValue, String(summary.bestCombo))
        newHighScoreMessage.hidden = true
        syncPhaseUi()
        finishedIdle.start()
        setStatus('')
        stage.classList.add('camera-fading')
        camera.scheduleRelease(() => releaseCamera({ keepScreen: true, keepLoop: true }),
          FINISHED_CAMERA_RELEASE_MS)
        break
    }
  }
}

function createParticles(event, now) {
  const count = event.kind === 'golden' ? 18 : 6
  for (let index = 0; index < count; index += 1) {
    if (particles.length >= MAX_GAMEPLAY_PARTICLES) break
    const angle = (index + Math.random() * 0.5) * Math.PI * 2 / count
    const speed = 70 + Math.random() * 80
    const particle = reusableParticles.pop() ?? {}
    particle.x = event.x
    particle.y = event.y
    particle.vx = Math.cos(angle) * speed
    particle.vy = Math.sin(angle) * speed - 25
    particle.at = now
    particle.golden = event.kind === 'golden'
    particle.bug = event.kind === 'bug'
    particles.push(particle)
  }
}

function updateResultCountup(now) {
  if (game.state.phase !== 'FINISHED' || resultShownAt === null) return
  setText(finalScoreValue, NUMBER_FORMAT.format(
    displayedResultScore(game.state.score, now - resultShownAt)))
  if (now - resultShownAt >= RESULT_COUNTUP_MS && !roundMessage.classList.contains('settled')) {
    roundMessage.classList.add('settled')
    newHighScoreMessage.hidden = playerSession.state.lastCompleted?.status === 'unchanged'
      || !playerSession.state.lastCompleted
  }
}

function drawEffects(now) {
  for (const particle of particles) {
    const age = (now - particle.at) / 1000
    const fade = Math.max(0, 1 - (now - particle.at)
      / (particle.golden ? GOLDEN_PARTICLE_MS : PARTICLE_MS))
    context.beginPath()
    const x = particle.x + particle.vx * age
    const y = particle.y + particle.vy * age + 90 * age * age
    if (particle.bug) context.rect(x - 2, y - 1, 4, 2)
    else context.arc(x, y, particle.golden ? 3.5 : 2.8, 0, Math.PI * 2)
    context.fillStyle = particle.golden
      ? `rgba(240, 174, 45, ${fade})` : particle.bug
        ? `rgba(179, 67, 49, ${fade})` : `rgba(40, 166, 207, ${fade})`
    context.fill()
  }
  for (const feedback of floatingTexts) {
    const age = (now - feedback.at) / FLOATING_TEXT_MS
    context.save()
    context.globalAlpha = Math.max(0, 1 - age)
    context.font = `800 ${feedback.kind === 'golden' ? 30 : 26}px system-ui`
    context.textAlign = 'center'
    context.lineWidth = 4
    context.strokeStyle = feedback.kind === 'bug' ? '#582b2a' : '#10263b'
    context.fillStyle = feedback.kind === 'golden' ? '#ffe188' : feedback.kind === 'bug' ? '#ffc0b1' : '#fff'
    const y = feedback.y - 30 - age * 34
    const pointsLabel = feedback.kind === 'bug' ? `−${Math.abs(feedback.points)}` : `+${feedback.points}`
    context.strokeText(pointsLabel, feedback.x, y)
    context.fillText(pointsLabel, feedback.x, y)
    if (feedback.combo > 1) {
      context.font = '700 17px system-ui'
      context.strokeText(`×${feedback.scoreMultiplier}`, feedback.x, y + 21)
      context.fillText(`×${feedback.scoreMultiplier}`, feedback.x, y + 21)
    }
    context.restore()
  }
}

function updateEffects(now) {
  while (floatingTexts.length && now - floatingTexts[0].at >= FLOATING_TEXT_MS) floatingTexts.shift()
  let write = 0
  for (const particle of particles) {
    if (now - particle.at < (particle.golden ? GOLDEN_PARTICLE_MS : PARTICLE_MS)) {
      particles[write++] = particle
    } else reusableParticles.push(particle)
  }
  particles.length = write
  if (!stateCallout.hidden) {
    const phase = calloutPhaseAt(now, calloutUntil, stateCallout.dataset.kind)
    if (phase === 'exiting') stateCallout.classList.add('exiting')
    else if (phase === 'hidden') {
      stateCallout.hidden = true
      stateCallout.classList.remove('exiting')
    }
  }
}

function updateDebug(now, force = false) {
  if (debugPanel.hidden || (!force && now - lastDebugAt < DEBUG_UPDATE_MS)) return
  lastDebugAt = now
  const frameStats = frameMonitor.snapshot()
  setText(renderFpsValue, Math.round(frameStats.renderedFps))
  setText(frameMsValue, frameStats.averageFrameMs.toFixed(1))
  setText(workMsValue, frameStats.averageWorkMs.toFixed(1))
  setText(worstFrameMsValue, frameStats.worstFrameMs.toFixed(1))
  setText(slowFramesValue, frameStats.slowFrames)
  setText(fpsValue, now - lastInferenceAt <= 1500 ? inferenceFps : 0)
  setText(detectMsValue, averageDetectMs.toFixed(1))
  setText(gameplayParticlesValue, particles.length)
  let fragmentCount = 0
  for (const target of targets.state.targets) if (target.sliced) fragmentCount += 2
  setText(sliceFragmentsValue, fragmentCount)
  setText(slashSegmentsValue, slash.state.segments.length)
  setText(readyParticlesValue, activeReadyAmbientCount(window.innerWidth,
    game.state.phase === 'READY' && !playerSession.state.currentPlayer
    && !document.hidden && !reducedMotionQuery.matches))
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
    ? `${targets.state.lastHit.catalogId === 'golden' ? 'Golden Nawras'
      : (TARGET_BY_ID.get(targets.state.lastHit.catalogId)?.label ?? 'Unknown')} `
      + `#${targets.state.lastHit.targetId} (${targets.state.lastHit.segmentType})`
    : '—')
  bridgeIndicator.hidden = slash.state.tracking !== 'DETECTED' || now >= slash.state.bridgedUntil
}

function resizeCanvas() {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  if (width === displayWidth && height === displayHeight && pixelRatio === displayPixelRatio) return
  canvas.width = Math.round(width * pixelRatio)
  canvas.height = Math.round(height * pixelRatio)
  // Game positions and collision radii stay in CSS pixels; only backing pixels scale.
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

  if (displayWidth && displayHeight && (width !== displayWidth || height !== displayHeight)) {
    finger.reset()
    hand.reset()
    slash.reset()
    // Live targets keep their CSS-pixel positions and physics across viewport changes.
    fingerDetected = false
    rawTrail.length = 0
    anchorTrail.length = 0
    rawFingerSpeed = 0
  }
  displayWidth = width
  displayHeight = height
  displayDiagonal = Math.hypot(width, height)
  displayPixelRatio = pixelRatio
  drawScene(performance.now())
}

function drawTarget(target, now) {
  const image = assets.images.get(target.catalogId)
  if (!image) return
  const imageRect = containedImageRect(image.naturalWidth, image.naturalHeight,
    target.radius, target.visualScale)
  if (!imageRect) return
  const hitDuration = target.kind === 'golden' ? GOLDEN_HIT_EFFECT_MS : HIT_EFFECT_MS
  const effect = target.sliced ? Math.min(1, (now - target.slicedAt) / hitDuration) : 0
  const radius = target.radius
  const bugFlash = target.kind === 'bug' && target.sliced
    ? bugImpactStrength(now, target.slicedAt) : 0
  context.save()
  context.globalAlpha = target.sliced ? 1 - effect : 1
  if (target.kind === 'bug' && (!target.sliced || bugFlash > 0)) {
    const wave = target.sliced || reducedMotionQuery.matches
      ? 0 : Math.sin(now * Math.PI * 2 / 1050)
    const auraRadius = radius * 1.18 * (1 + wave * 0.04) * (1 + bugFlash * 0.03)
    const strength = target.sliced ? bugFlash : 1
    const glow = context.createRadialGradient(target.x, target.y, radius * 0.15,
      target.x, target.y, auraRadius)
    glow.addColorStop(0, `rgba(230, 35, 45, ${(0.07 + bugFlash * 0.40) * strength})`)
    glow.addColorStop(0.58, `rgba(230, 35, 45, ${(0.09 + bugFlash * 0.48) * strength})`)
    glow.addColorStop(0.82, `rgba(230, 35, 45, ${(0.18 + wave * 0.025 + bugFlash * 0.42) * strength})`)
    glow.addColorStop(1, 'rgba(230, 35, 45, 0)')
    context.beginPath()
    context.arc(target.x, target.y, auraRadius, 0, Math.PI * 2)
    context.fillStyle = glow
    context.fill()
    context.beginPath()
    context.arc(target.x, target.y, auraRadius * 0.92, 0, Math.PI * 2)
    context.lineWidth = 1.8 + bugFlash * 1.6
    context.strokeStyle = `rgba(230, 35, 45, ${(0.68 + wave * 0.05 + bugFlash * 0.25) * strength})`
    context.stroke()
  }
  if (target.kind === 'golden') {
    const age = Math.max(0, now - target.createdAt)
    const pulse = 1 + Math.sin(now * Math.PI * 2 / 850) * 0.075
    const entrance = Math.min(1, age / 300)
    const shimmerPeriod = 800 + target.effectSeed * 320
    const shimmerAge = age % shimmerPeriod
    const shimmerStrength = shimmerAge < 240 ? Math.sin(Math.PI * shimmerAge / 240) : 0
    const auraRadius = radius * (2.35 + (1 - entrance) * 0.32) * pulse
    const aura = context.createRadialGradient(target.x, target.y, radius * 0.42,
      target.x, target.y, auraRadius)
    aura.addColorStop(0, `rgba(255, 249, 209, ${0.48 + shimmerStrength * 0.27})`)
    aura.addColorStop(0.28, `rgba(255, 210, 88, ${0.40 + shimmerStrength * 0.2})`)
    aura.addColorStop(0.68, 'rgba(191, 116, 20, 0.19)')
    aura.addColorStop(1, 'rgba(148, 81, 14, 0)')
    context.fillStyle = aura
    context.beginPath()
    context.arc(target.x, target.y, auraRadius, 0, Math.PI * 2)
    context.fill()
    if (target.sliced) {
      const flash = context.createRadialGradient(target.x, target.y, 0,
        target.x, target.y, radius * 1.45)
      flash.addColorStop(0, `rgba(255, 254, 226, ${0.72 * (1 - effect)})`)
      flash.addColorStop(0.5, `rgba(255, 216, 99, ${0.33 * (1 - effect)})`)
      flash.addColorStop(1, 'rgba(255, 196, 53, 0)')
      context.fillStyle = flash
      context.beginPath()
      context.arc(target.x, target.y, radius * 1.45, 0, Math.PI * 2)
      context.fill()
    }

    const rotation = now / 1700
    const ringRadius = radius * (1.47 + Math.sin(now / 420) * 0.035)
    context.lineCap = 'round'
    for (let index = 0; index < 5; index += 1) {
      const start = rotation + index * Math.PI * 2 / 5
      context.beginPath()
      context.arc(target.x, target.y, ringRadius, start, start + 0.72)
      context.lineWidth = index % 2 ? 3 : 4
      context.strokeStyle = index % 2 ? 'rgba(255, 243, 190, 0.96)' : 'rgba(197, 112, 14, 0.94)'
      context.stroke()
    }
    for (let index = 0; index < 8; index += 1) {
      const angle = rotation * 0.65 + index * Math.PI / 4
      const inner = radius * 1.66
      const outer = inner + radius * (index % 2 ? 0.12 : 0.22)
      context.beginPath()
      context.moveTo(target.x + Math.cos(angle) * inner, target.y + Math.sin(angle) * inner)
      context.lineTo(target.x + Math.cos(angle) * outer, target.y + Math.sin(angle) * outer)
      context.lineWidth = 2
      context.strokeStyle = 'rgba(255, 215, 95, 0.62)'
      context.stroke()
    }
    // Six deterministic motes per live golden target; no particle array accumulates.
    if (!target.sliced) for (let index = 0; index < GOLDEN_LIVE_MOTES; index += 1) {
      const life = ((age / 650 + index / GOLDEN_LIVE_MOTES + target.effectSeed) % 1)
      const angle = index * Math.PI * 2 / GOLDEN_LIVE_MOTES + target.effectSeed * 4
      const distance = radius * (1.65 + life * 0.55)
      const x = target.x + Math.cos(angle) * distance - target.vx * life * 0.085
      const y = target.y + Math.sin(angle) * distance - target.vy * life * 0.085
      context.beginPath()
      context.arc(x, y, 1.4 + (1 - life) * 1.8, 0, Math.PI * 2)
      context.fillStyle = `rgba(255, 245, 193, ${(1 - life) * 0.84})`
      context.fill()
    }
    if (age < 300 || target.sliced) {
      context.beginPath()
      context.arc(target.x, target.y, radius * (1.04 + (target.sliced ? effect : entrance) * (target.sliced ? 1.35 : 1.05)),
        0, Math.PI * 2)
      context.lineWidth = target.sliced ? 8 * (1 - effect) : 4 * (1 - entrance)
      context.strokeStyle = target.sliced ? 'rgba(255, 248, 202, 0.98)' : 'rgba(255, 221, 126, 0.82)'
      context.stroke()
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
      context.rotate(target.rotation + side * effect * 0.14)
      context.translate(-target.x, -target.y)
      const [a, b, c, d] = sliceClipPolygon(target, side)
      context.beginPath()
      context.moveTo(a.x, a.y)
      context.lineTo(b.x, b.y)
      context.lineTo(c.x, c.y)
      context.lineTo(d.x, d.y)
      context.closePath()
      context.clip()
      context.drawImage(image, target.x + imageRect.x, target.y + imageRect.y,
        imageRect.width, imageRect.height)
      if (bugFlash > 0) {
        context.globalAlpha *= bugFlash
        context.drawImage(assets.images.get('bug-impact'), target.x + imageRect.x,
          target.y + imageRect.y, imageRect.width, imageRect.height)
      }
      context.restore()
    }
    context.beginPath()
    context.arc(target.x, target.y, radius * (0.8 + effect * 0.4), 0, Math.PI * 2)
    context.lineWidth = 4 * (1 - effect)
    context.strokeStyle = target.kind === 'golden' ? '#ffe28a' : target.kind === 'bug' ? '#c75a43' : '#e7faff'
    context.stroke()
  } else {
    context.save()
    context.translate(target.x, target.y)
    context.rotate(target.rotation)
    const entranceAge = Math.max(0, now - target.createdAt)
    const iconScale = target.kind === 'golden' && entranceAge < 300
      ? entranceAge < 160 ? 0.85 + entranceAge / 160 * 0.2 : 1.05 - (entranceAge - 160) / 140 * 0.05
      : 1
    context.drawImage(image, imageRect.x * iconScale, imageRect.y * iconScale,
      imageRect.width * iconScale, imageRect.height * iconScale)
    if (target.kind === 'golden') {
      const shimmerPeriod = 800 + target.effectSeed * 320
      const shimmerAge = entranceAge % shimmerPeriod
      if (shimmerAge < 240) {
        const sweep = -radius * 2 + shimmerAge / 240 * radius * 4
        context.beginPath()
        context.rect(-radius, -radius, radius * 2, radius * 2)
        context.clip()
        context.beginPath()
        context.moveTo(sweep - 10, -radius)
        context.lineTo(sweep + 10, -radius)
        context.lineTo(sweep + radius * 0.65 + 10, radius)
        context.lineTo(sweep + radius * 0.65 - 10, radius)
        context.closePath()
        context.fillStyle = 'rgba(255, 250, 210, 0.38)'
        context.fill()
      }
    }
    context.restore()
  }
  context.restore()
}

function drawScene(now) {
  context.clearRect(0, 0, displayWidth, displayHeight)
  for (const target of targets.state.targets) drawTarget(target, now)
  drawEffects(now)
  if (!reducedMotionQuery.matches && game.state.phase === 'PLAYING') {
    const wash = bugImpactStrength(now, bugImpactAt, BUG_WASH_MS)
    if (wash > 0) {
      context.fillStyle = `rgba(220, 25, 40, ${0.045 * wash})`
      context.fillRect(0, 0, displayWidth, displayHeight)
    }
  }

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
      displayWidth, displayHeight)
    : null
  const anchorNormalized = handAnchorFromLandmarks(landmarks)
  const anchor = anchorNormalized && cameraPointToDisplay(
    anchorNormalized.x, anchorNormalized.y, video.videoWidth, video.videoHeight,
    displayWidth, displayHeight,
  )
  const diagonal = displayDiagonal
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
  const profile = spawnProfileFor(difficultyAt(game.state.elapsedMs),
    game.state.webRushActive, MAX_ACTIVE_TARGETS)
  if (targets.activeCount() >= profile.activeLimit) return
  const groupSize = groupSizeForRoll(Math.random(), profile)
  const waveIds = []
  for (let index = 0; index < groupSize; index += 1) {
    const target = targets.spawn(displayWidth, displayHeight, now, {
      activeLimit: profile.activeLimit,
      speedScale: profile.launchSpeedScale,
      elapsedMs: game.state.elapsedMs,
      selectionMode: game.state.webRushActive ? 'web-rush' : 'normal',
      lanePosition: groupSize === 1 ? null : index / (groupSize - 1),
      excludedIds: waveIds,
    })
    if (target && target.kind !== 'golden') waveIds.push(target.catalogId)
  }
}

function updateDetectionStats(now, detectDuration) {
  detectionCount += 1
  lastInferenceAt = now
  averageDetectMs = averageDetectMs ? averageDetectMs * 0.85 + detectDuration * 0.15 : detectDuration
  const elapsed = now - detectionWindowStart
  if (elapsed >= 1000) {
    inferenceFps = Math.round(detectionCount * 1000 / elapsed)
    detectionCount = 0
    detectionWindowStart = now
  }
}

function frame(activeSession) {
  if (activeSession !== sessionId || !handLandmarker) return
  try {
    const now = performance.now()
    frameMonitor.startFrame(now)
    const dtSeconds = lastFrameTime === null ? 0 : (now - lastFrameTime) / 1000
    lastFrameTime = now

    game.update(now)
    processGameEvents(now)
    if (game.canSpawn()) {
      targets.update(dtSeconds, now, displayWidth, displayHeight)
      if (now >= nextSpawnAt) {
        spawnWave(now)
        nextSpawnAt = now + spawnProfileFor(difficultyAt(game.state.elapsedMs),
          game.state.webRushActive, MAX_ACTIVE_TARGETS).spawnIntervalMs
      }
    }

    if (camera.state.active && game.state.phase !== 'FINISHED'
      && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && video.currentTime !== lastVideoTime) {
      const detectionStart = performance.now()
      const result = handLandmarker.detectForVideo(video, detectionStart)
      lastVideoTime = video.currentTime
      processResult(result, detectionStart)
      const detectionEnd = performance.now()
      updateDetectionStats(detectionEnd, detectionEnd - detectionStart)
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
    updateResultCountup(renderNow)
    updateEffects(renderNow)
    const hasVisual = fingerDetected || slash.state.predictionActive
      || slash.state.trail.length > 0 || targets.state.targets.length > 0
      || floatingTexts.length > 0 || particles.length > 0
      || (showRawPath && !debugPanel.hidden && (rawTrail.length > 0 || anchorTrail.length > 0))
    if (hasVisual || hadVisual) drawScene(renderNow)
    hadVisual = hasVisual
    frameMonitor.finishFrame(performance.now() - now)
    updateDebug(performance.now())
  } catch (error) {
    console.error('Tracking/game loop failed:', error)
    handleCameraLoss(error)
    return
  }
  const finishAnimationPending = game.state.phase === 'FINISHED' && resultShownAt !== null
    && performance.now() - resultShownAt < RESULT_COUNTUP_MS + 60
  if (activeSession === sessionId && (camera.state.active || finishAnimationPending)) {
    animationFrameId = requestAnimationFrame(() => frame(activeSession))
  } else animationFrameId = null
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
      return 'CAMERA ACCESS IS NEEDED TO PLAY'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'NO CAMERA FOUND'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'CAMERA UNAVAILABLE'
    default:
      return 'CAMERA UNAVAILABLE'
  }
}

function showCameraError(message, context) {
  retryContext = context
  setText(cameraErrorText, message)
  cameraError.hidden = false
  cameraRetryButton.disabled = false
  setStatus('')
}

function clearTrackingState() {
  resetPlayerTracking({ finger, hand, slash, rawTrail, anchorTrail })
  fingerDetected = false
  rawFingerSpeed = 0
  lastVideoTime = -1
  lastFrameTime = null
  detectionCount = 0
  detectionWindowStart = 0
  inferenceFps = 0
  lastInferenceAt = 0
  averageDetectMs = 0
  hadVisual = false
  frameMonitor.reset()
}

function releaseCamera({ keepScreen = false, keepLoop = false } = {}) {
  if (!keepLoop) {
    sessionId += 1
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  cancelMetadataWait?.()
  camera.release()
  stage.classList.remove('is-active', 'camera-fading')
  clearTrackingState()
  cameraOnButton.hidden = keepScreen
  cameraOnButton.disabled = false
  cameraOffButton.hidden = true
  startRoundButton.disabled = true
  resetRoundButton.disabled = true
  spawnButton.disabled = true
  if (keepScreen) {
    syncPhaseUi()
    setStatus('')
  } else {
    resetRound()
    setStatus('')
  }
}

function handleCameraLoss(error = null) {
  if (error) console.error('Camera/tracking stream stopped:', error)
  if (game.state.phase === 'FINISHED') {
    releaseCamera({ keepScreen: true, keepLoop: true })
    return
  }
  const interrupted = game.abort()
  releaseCamera({ keepScreen: interrupted })
  showCameraError('CAMERA UNAVAILABLE', interrupted ? 'replay' : 'initial')
}

function startCamera() {
  if (!playerSession.state.currentPlayer) return Promise.resolve(false)
  if (cameraStartPromise) return cameraStartPromise
  if (camera.state.active) return Promise.resolve(true)
  void audio.unlock().then(updateSoundButton)
  if (!navigator.mediaDevices?.getUserMedia) {
    console.error('getUserMedia is unavailable; camera access needs HTTPS or localhost and browser support.')
    showCameraError('CAMERA ACCESS IS NEEDED TO PLAY', retryContext)
    return Promise.resolve(false)
  }
  const activeSession = ++sessionId
  cameraOnButton.disabled = true
  cameraRetryButton.disabled = true
  setStatus('Starting camera…')

  cameraStartPromise = (async () => {
    try {
      const acquired = await camera.acquire({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      }, async () => {
        await waitForVideoMetadata()
        await video.play()
        if (!video.videoWidth || !video.videoHeight) throw new Error('Camera video has no dimensions')
      })
      if (!acquired || activeSession !== sessionId) return false
      stage.classList.add('is-active')
      stage.classList.remove('camera-fading')
      resizeCanvas()
      if (!handLandmarker) {
        setStatus('Loading hand tracker…')
        const tracker = await initializeHandTracker()
        if (activeSession !== sessionId) { tracker.close(); return false }
        handLandmarker = tracker
      }
      lastVideoTime = -1
      lastFrameTime = null
      detectionWindowStart = performance.now()
      detectionCount = 0
      resetRoundButton.disabled = false
      spawnButton.disabled = true
      cameraOffButton.hidden = false
      cameraOnButton.hidden = true
      refreshRoundStart()
      cameraError.hidden = true
      updateDebug(performance.now(), true)
      if (animationFrameId === null) animationFrameId = requestAnimationFrame(() => frame(activeSession))
      return true
    } catch (error) {
      if (activeSession !== sessionId) return false
      console.error('Camera/tracker startup failed:', error)
      const context = game.state.phase === 'FINISHED' || game.state.phase === 'INTERRUPTED'
        ? 'replay' : 'initial'
      releaseCamera({ keepScreen: context === 'replay' })
      showCameraError(cameraErrorMessage(error), context)
      return false
    } finally {
      cameraStartPromise = null
    }
  })()
  return cameraStartPromise
}

function resetRound() {
  roundRequestId += 1
  game.reset()
  playerSession.clearRoundResult()
  resultShownAt = null
  roundMessage.classList.remove('settled')
  timerStat.classList.remove('tick-pulse')
  delete timerStat.dataset.urgency
  targets.reset()
  floatingTexts.length = 0
  reusableParticles.push(...particles)
  particles.length = 0
  stateCallout.hidden = true
  stateCallout.classList.remove('exiting')
  calloutUntil = 0
  clearTrackingState()
  nextSpawnAt = 0
  syncPhaseUi()
  refreshRoundStart()
  updateHud()
  updateDebug(performance.now(), true)
  drawScene(performance.now())
}

new ResizeObserver(resizeCanvas).observe(stage)
populateReadyAmbient(readyAmbient)
syncPhaseUi()
updateSoundButton()
preloadAssets()
cameraOnButton.addEventListener('click', () => { retryContext = 'initial'; void startCamera() })
cameraOffButton.addEventListener('click', () => releaseCamera())
playerNameInput.addEventListener('input', () => { playerNameError.hidden = true })
playerEntry.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (playerEntryStarting || game.state.phase !== 'READY') return
  const player = playerSession.selectPlayer(playerNameInput.value)
  if (!player) {
    playerNameError.hidden = false
    playerNameInput.focus()
    return
  }
  playerNameInput.value = player.name
  playerNameError.hidden = true
  playerEntryStarting = true
  syncPhaseUi()
  try {
    if (await startCamera()) await beginRound()
  } finally {
    playerEntryStarting = false
    syncPlayerUi()
  }
})
changePlayerButton.addEventListener('click', () => {
  if (game.state.phase !== 'READY' || playerEntryStarting) return
  playerSession.clearPlayer()
  releaseCamera()
  cameraError.hidden = true
  playerNameInput.value = ''
  playerNameError.hidden = true
  playerNameInput.focus()
})
async function beginRound() {
  if (beginningRound || !camera.state.active || !handLandmarker || !assets.ready
    || game.state.phase !== 'READY' || !playerSession.state.currentPlayer) return
  beginningRound = true
  const requestId = roundRequestId
  startRoundButton.disabled = true
  await audio.unlock()
  updateSoundButton()
  beginningRound = false
  if (requestId !== roundRequestId || !camera.state.active || !handLandmarker
    || !game.startCountdown(performance.now())) return
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
resetGameButton.addEventListener('click', () => resetConfirmation.click())
const replayFlow = createReplayFlow({
  canReplay: () => !cameraStartPromise && handLandmarker && assets.ready
    && playerSession.state.currentPlayer
    && ['FINISHED', 'INTERRUPTED'].includes(game.state.phase),
  prepareCamera: () => {
    retryContext = 'replay'
    cameraError.hidden = true
    if (game.state.phase === 'FINISHED') {
      setText(finalScoreValue, NUMBER_FORMAT.format(game.state.score))
      roundMessage.classList.add('settled')
      newHighScoreMessage.hidden = playerSession.state.lastCompleted?.status === 'unchanged'
        || !playerSession.state.lastCompleted
    }
    releaseCamera({ keepScreen: true })
    return startCamera()
  },
  resetRound,
  beginRound,
  onLoading: (loading) => {
    playAgainButton.disabled = loading
    newPlayerButton.disabled = loading
    setText(playAgainButton, loading ? 'STARTING CAMERA...' : 'PLAY AGAIN')
  },
  onFailure: (error) => {
    console.error('Replay startup failed:', error)
    showCameraError('CAMERA UNAVAILABLE', 'replay')
  },
})
playAgainButton.addEventListener('click', () => {
  if (game.state.phase === 'FINISHED') finishedIdle.stop()
  void replayFlow.replay().then((started) => {
    if (!started && game.state.phase === 'FINISHED') finishedIdle.start()
  })
})
function enterNewPlayer() {
  if (game.state.phase !== 'FINISHED' || replayFlow.state.pending) return
  finishedIdle.stop()
  playerSession.clearPlayer()
  cameraError.hidden = true
  releaseCamera()
  playerNameInput.value = ''
  playerNameError.hidden = true
  playerNameInput.focus()
}
newPlayerButton.addEventListener('click', enterNewPlayer)
window.addEventListener('pointerdown', () => finishedIdle.activity(), { passive: true })
document.addEventListener('visibilitychange', () => {
  app.classList.toggle('ambient-paused', document.hidden)
  if (!document.hidden) finishedIdle.check()
})
cameraRetryButton.addEventListener('click', async () => {
  if (cameraStartPromise || replayFlow.state.pending) return
  cameraRetryButton.disabled = true
  if (retryContext === 'replay') {
    await replayFlow.replay()
  } else {
    cameraError.hidden = true
    await startCamera()
  }
})
soundButton.addEventListener('click', () => {
  const on = audio.setEnabled(!audio.state.enabled)
  updateSoundButton()
  if (on) void audio.unlock().then(updateSoundButton)
})
clearLeaderboardButton.addEventListener('click', () => clearLeaderboardConfirmation.click())
spawnButton.addEventListener('click', () => {
  if (!handLandmarker || !game.canSpawn()) return
  targets.spawn(displayWidth, displayHeight, performance.now(), {
    predictable: true,
    ...(targetTypeSelect.value === 'golden' ? { kind: 'golden' }
      : targetTypeSelect.value === 'random' ? {} : { catalogId: targetTypeSelect.value }),
    activeLimit: MAX_ACTIVE_TARGETS,
    speedScale: difficultyAt(game.state.elapsedMs).launchSpeedScale,
  })
  updateDebug(performance.now(), true)
})
webRushButton.addEventListener('click', () => {
  const now = performance.now()
  if (game.triggerWebRush(now)) processGameEvents(now)
})
for (const target of ORDINARY_TARGETS) {
  const option = document.createElement('option')
  option.value = target.id
  option.textContent = target.label
  targetTypeSelect.append(option)
}
const goldenTestOption = document.createElement('option')
goldenTestOption.value = 'golden'
goldenTestOption.textContent = 'Golden Nawras'
targetTypeSelect.append(goldenTestOption)
document.addEventListener('keydown', (event) => {
  finishedIdle.activity()
  fullscreen.handleKeydown(event)
  if (developerUi.handleKeydown(event)) {
    if (!developerUi.state.visible) clearLeaderboardConfirmation.clear()
    updateDebug(performance.now(), true)
  }
})
document.addEventListener('pointermove', (event) => {
  finishedIdle.activity()
  if (event.pointerType === 'mouse' && game.state.phase === 'PLAYING') armMouseIdle()
})
app.addEventListener('dragstart', (event) => event.preventDefault())
for (const image of app.querySelectorAll('img')) image.draggable = false
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
