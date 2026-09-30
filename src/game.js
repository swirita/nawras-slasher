export const GAME_DURATION_MS = 90000
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
