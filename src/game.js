export const GAME_DURATION_MS = 90000
export const COUNTDOWN_MS = 3000
export const COMBO_WINDOW_MS = 2000
export const MAX_COMBO = 5
export const NORMAL_POINTS = 10
export const GOLDEN_POINTS = 25
export const FINAL_WARNING_MS = 15000
export const INITIAL_SPAWN_INTERVAL_MS = 4300
export const FINAL_SPAWN_INTERVAL_MS = 1500
export const INITIAL_LAUNCH_SPEED_SCALE = 0.82
export const FINAL_LAUNCH_SPEED_SCALE = 1.1

const clamp01 = (value) => Math.max(0, Math.min(1, value))
const lerp = (from, to, progress) => from + (to - from) * progress

export function difficultyAt(elapsedMs) {
  const progress = clamp01(elapsedMs / GAME_DURATION_MS)
  return {
    progress,
    spawnIntervalMs: lerp(INITIAL_SPAWN_INTERVAL_MS, FINAL_SPAWN_INTERVAL_MS, progress),
    launchSpeedScale: lerp(INITIAL_LAUNCH_SPEED_SCALE, FINAL_LAUNCH_SPEED_SCALE, progress),
    pairProbability: 0.56 * progress ** 1.4,
    tripleProbability: 0.1 * progress ** 2.2,
    activeLimit: Math.min(5, 1 + Math.floor(progress * 5)),
  }
}

export function createGameClock() {
  const state = { phase: 'ready', elapsedMs: 0, remainingMs: GAME_DURATION_MS, startedAt: null }

  function start(now) {
    if (state.phase !== 'ready') return false
    state.startedAt = now
    state.phase = 'running'
    return true
  }

  function update(now) {
    if (state.phase !== 'running') return false
    state.elapsedMs = Math.min(GAME_DURATION_MS, Math.max(0, now - state.startedAt))
    state.remainingMs = GAME_DURATION_MS - state.elapsedMs
    if (state.remainingMs === 0) {
      state.phase = 'ended'
      return true
    }
    return false
  }

  function reset() {
    state.phase = 'ready'
    state.elapsedMs = 0
    state.remainingMs = GAME_DURATION_MS
    state.startedAt = null
  }

  return { state, start, update, reset }
}

export function formatTime(ms) {
  const seconds = Math.ceil(ms / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

// Round rules and events are independent of webcam, canvas, and audio. A future
// sound layer can consume the same events that currently drive visual feedback.
export function createGameSession() {
  const state = {
    phase: 'READY', elapsedMs: 0, remainingMs: GAME_DURATION_MS,
    countdownStartedAt: null, countdownNumber: null, startedAt: null,
    score: 0, targetsSliced: 0, combo: 1, bestCombo: 1,
    lastHitAt: null, highScore: 0, newHighScore: false,
  }
  const events = []
  const scoredIds = new Set()
  let finalWarningSent = false

  function startCountdown(now) {
    if (state.phase !== 'READY') return false
    state.phase = 'COUNTDOWN'
    state.countdownStartedAt = now
    state.countdownNumber = 3
    events.push({ type: 'countdown-tick', number: 3 })
    return true
  }

  function update(now) {
    if (state.phase === 'COUNTDOWN') {
      const age = Math.max(0, now - state.countdownStartedAt)
      if (age >= COUNTDOWN_MS) {
        state.phase = 'PLAYING'
        state.countdownNumber = null
        state.startedAt = now
        events.push({ type: 'round-start' })
      } else {
        const number = 3 - Math.floor(age / 1000)
        if (number !== state.countdownNumber) {
          state.countdownNumber = number
          events.push({ type: 'countdown-tick', number })
        }
      }
      return false
    }
    if (state.phase !== 'PLAYING') return false
    state.elapsedMs = Math.min(GAME_DURATION_MS, Math.max(0, now - state.startedAt))
    state.remainingMs = GAME_DURATION_MS - state.elapsedMs
    if (state.combo > 1 && now - state.lastHitAt >= COMBO_WINDOW_MS) {
      state.combo = 1
      events.push({ type: 'combo-expired' })
    }
    if (!finalWarningSent && state.remainingMs > 0 && state.remainingMs <= FINAL_WARNING_MS) {
      finalWarningSent = true
      events.push({ type: 'final-15' })
    }
    if (state.remainingMs === 0) {
      state.phase = 'FINISHED'
      state.combo = 1
      state.newHighScore = state.score > state.highScore
      if (state.newHighScore) {
        state.highScore = state.score
        events.push({ type: 'new-high-score' })
      }
      events.push({ type: 'round-finished' })
      return true
    }
    return false
  }

  function scoreTarget(target, now) {
    if (state.phase !== 'PLAYING' || !target || scoredIds.has(target.id)) return null
    scoredIds.add(target.id)
    state.combo = state.lastHitAt !== null && now - state.lastHitAt < COMBO_WINDOW_MS
      ? Math.min(MAX_COMBO, state.combo + 1) : 1
    state.lastHitAt = now
    state.bestCombo = Math.max(state.bestCombo, state.combo)
    const basePoints = target.kind === 'golden' ? GOLDEN_POINTS : NORMAL_POINTS
    const points = basePoints * state.combo
    state.score += points
    state.targetsSliced += 1
    const award = { type: 'target-sliced', targetId: target.id, kind: target.kind,
      x: target.x, y: target.y, points, combo: state.combo }
    events.push(award)
    if (state.combo > 1) events.push({ type: 'combo-increase', combo: state.combo })
    return award
  }

  function reset() {
    state.phase = 'READY'
    state.elapsedMs = 0
    state.remainingMs = GAME_DURATION_MS
    state.countdownStartedAt = null
    state.countdownNumber = null
    state.startedAt = null
    state.score = 0
    state.targetsSliced = 0
    state.combo = 1
    state.bestCombo = 1
    state.lastHitAt = null
    state.newHighScore = false
    finalWarningSent = false
    scoredIds.clear()
    events.length = 0
  }

  function drainEvents() { return events.splice(0) }
  function canSpawn() { return state.phase === 'PLAYING' }

  return { state, startCountdown, update, scoreTarget, reset, drainEvents, canSpawn }
}
