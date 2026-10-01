import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createResetConfirmation, RESET_CONFIRM_MS, resetGameVisible } from '../src/reset-game.js'
import { createCameraSession } from '../src/camera.js'
import { createGameSession, COUNTDOWN_MS, GAME_DURATION_MS } from '../src/game.js'
import { createTargetSystem } from '../src/targets.js'
import { createFingerProcessor } from '../src/tracking.js'
import { createHandMotionProcessor } from '../src/hand.js'
import { createSlashTracker } from '../src/slash.js'
import { resetPlayerTracking } from '../src/player-state.js'
import { createAudioSystem } from '../src/audio.js'

const startPlaying = (game, at = 0) => {
  game.startCountdown(at)
  game.update(at + COUNTDOWN_MS)
  game.drainEvents()
  return at + COUNTDOWN_MS
}

test('RESET GAME is available only during PLAYING, with a hidden default button', () => {
  assert.equal(resetGameVisible('READY'), false)
  assert.equal(resetGameVisible('COUNTDOWN'), false)
  assert.equal(resetGameVisible('PLAYING'), true)
  assert.equal(resetGameVisible('FINISHED'), false)
  assert.equal(resetGameVisible('INTERRUPTED'), false)
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(html, /id="reset-game"[^>]*hidden>RESET GAME<\/button>/)
  assert.match(main, /resetGameButton\.hidden = !resetGameVisible\(game\.state\.phase\)/)
  assert.match(main, /onConfirm: \(\) => releaseCamera\(\)/)
})

test('first click arms RESET? without cleanup; timeout restores label; second timely click confirms', () => {
  let time = 100
  let timer = null
  let phase = 'PLAYING'
  let confirmed = 0
  const labels = []
  const control = createResetConfirmation({
    isPlaying: () => resetGameVisible(phase),
    onConfirm: () => { confirmed += 1; phase = 'READY' },
    onChange: (armed) => labels.push(armed ? 'RESET?' : 'RESET GAME'),
    now: () => time,
    setTimer: (callback, ms) => { timer = { callback, ms }; return 1 },
    clearTimer: () => { timer = null },
  })
  assert.equal(RESET_CONFIRM_MS, 2000)
  assert.equal(control.click(), false)
  assert.equal(confirmed, 0)
  assert.equal(labels.at(-1), 'RESET?')
  assert.equal(timer.ms, RESET_CONFIRM_MS)
  time = 2100
  timer.callback()
  assert.equal(control.state.armed, false)
  assert.equal(labels.at(-1), 'RESET GAME')
  assert.equal(confirmed, 0)
  time = 2200
  assert.equal(control.click(), false)
  time = 4199
  assert.equal(control.click(), true)
  assert.equal(confirmed, 1)
  assert.equal(phase, 'READY')
  assert.equal(timer, null)
  assert.equal(labels.at(-1), 'RESET GAME')
  assert.equal(control.click(), false)
  assert.equal(confirmed, 1)
})

test('late second click starts a new confirmation; leaving PLAYING cancels it', () => {
  let time = 0
  let phase = 'PLAYING'
  let confirmed = 0
  let cancelled = 0
  const control = createResetConfirmation({
    isPlaying: () => resetGameVisible(phase), onConfirm: () => { confirmed += 1 },
    now: () => time, setTimer: () => 1, clearTimer: () => { cancelled += 1 },
  })
  control.click()
  time = 2000
  assert.equal(control.click(), false)
  assert.equal(confirmed, 0)
  assert.equal(control.state.expiresAt, 4000)
  phase = 'FINISHED'
  control.clear()
  assert.equal(control.state.armed, false)
  assert.equal(control.click(), false)
  assert.equal(confirmed, 0)
  assert.equal(cancelled, 2)
})

test('abandoned attempt clears round, camera, targets and tracking but keeps session resources', async () => {
  const game = createGameSession()
  const completedStart = startPlaying(game)
  game.scoreTarget({ id: 1, kind: 'golden', catalogId: 'golden', x: 0, y: 0 }, completedStart + 1)
  game.update(completedStart + GAME_DURATION_MS)
  assert.equal(game.state.highScore, 50)
  game.reset()
  const attemptStart = startPlaying(game, 100000)
  game.scoreTarget({ id: 2, kind: 'golden', catalogId: 'golden', x: 0, y: 0 }, attemptStart + 1)
  game.scoreTarget({ id: 3, kind: 'golden', catalogId: 'golden', x: 0, y: 0 }, attemptStart + 2)
  game.triggerWebRush(attemptStart + 10)
  const targets = createTargetSystem()
  targets.spawn(500, 400, attemptStart, { predictable: true })
  const effects = [{ at: 1 }]
  const finger = createFingerProcessor()
  const hand = createHandMotionProcessor()
  const slash = createSlashTracker()
  finger.sample({ x: 100, y: 100 }, 0, 500)
  hand.sample({ x: 80, y: 80 }, { x: 100, y: 100 }, 0, 500)
  slash.detected({ x: 100, y: 100 }, 0, 500)
  const rawTrail = [{ x: 100, y: 100 }]
  const anchorTrail = [{ x: 80, y: 80 }]
  const audio = createAudioSystem()
  audio.setEnabled(false)
  const loadedTracker = { loaded: true }
  const stream = { tracks: [{ stops: 0, stop() { this.stops += 1 },
    addEventListener() {}, removeEventListener() {} }],
  getTracks() { return this.tracks }, getVideoTracks() { return this.tracks } }
  const video = { srcObject: null, paused: false, pause() { this.paused = true } }
  const camera = createCameraSession({ video, getUserMedia: async () => stream })
  await camera.acquire({ video: true }, async () => {})
  let time = attemptStart + 100
  const control = createResetConfirmation({ isPlaying: () => resetGameVisible(game.state.phase),
    onConfirm: () => {
      camera.release()
      game.reset()
      targets.reset()
      effects.length = 0
      resetPlayerTracking({ finger, hand, slash, rawTrail, anchorTrail })
    }, now: () => time, setTimer: () => 1, clearTimer: () => {} })
  control.click()
  assert.equal(game.state.phase, 'PLAYING')
  assert.equal(camera.state.active, true)
  time += 100
  control.click()
  assert.equal(game.state.phase, 'READY')
  assert.equal(game.state.score, 0)
  assert.equal(game.state.combo, 1)
  assert.equal(game.state.remainingMs, GAME_DURATION_MS)
  assert.equal(game.state.highScore, 50)
  assert.equal(game.state.webRushActive, false)
  assert.equal(game.state.webRushTriggered, false)
  assert.equal(game.drainEvents().length, 0)
  assert.equal(targets.activeCount(), 0)
  assert.deepEqual(effects, [])
  assert.equal(camera.state.active, false)
  assert.equal(camera.state.stream, null)
  assert.equal(video.srcObject, null)
  assert.equal(video.paused, true)
  assert.equal(stream.tracks[0].stops, 1)
  assert.equal(finger.state.raw, null)
  assert.equal(hand.state.velocity, null)
  assert.equal(slash.state.segments.length, 0)
  assert.deepEqual(rawTrail, [])
  assert.deepEqual(anchorTrail, [])
  assert.equal(audio.state.enabled, false)
  assert.equal(loadedTracker.loaded, true)
  await camera.acquire({ video: true }, async () => {})
  startPlaying(game, 200000)
  assert.equal(game.state.score, 0)
  assert.equal(game.state.combo, 1)
  assert.equal(game.state.remainingMs, GAME_DURATION_MS)
  assert.equal(game.state.webRushTriggered, false)
  assert.equal(targets.activeCount(), 0)
  assert.equal(finger.state.raw, null)
  assert.equal(game.state.phase, 'PLAYING')
  camera.release()
})

test('reset after FINAL 15 clears its round events and starts a new full timer', () => {
  const game = createGameSession()
  const start = startPlaying(game)
  game.update(start + 75000)
  assert.equal(game.state.remainingMs, 15000)
  assert.equal(game.drainEvents().some(({ type }) => type === 'final-15'), true)
  game.reset()
  assert.equal(game.state.remainingMs, GAME_DURATION_MS)
  assert.equal(game.state.webRushActive, false)
  assert.equal(game.state.webRushTriggered, false)
  assert.deepEqual(game.drainEvents(), [])
  startPlaying(game, 100000)
  assert.equal(game.state.remainingMs, GAME_DURATION_MS)
})
