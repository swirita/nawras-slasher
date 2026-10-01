export const FINISHED_IDLE_TIMEOUT_MS = 60_000
export const FINISHED_IDLE_COUNTDOWN_MS = 10_000

export function createFinishedIdle({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onCountdown = () => {},
  onExpire = () => {},
  timeoutMs = FINISHED_IDLE_TIMEOUT_MS,
  countdownMs = FINISHED_IDLE_COUNTDOWN_MS,
} = {}) {
  const state = { active: false, lastActivityAt: null, countdown: null }
  let timer = null

  function cancelCheck() {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  function showCountdown(seconds) {
    if (state.countdown === seconds) return
    state.countdown = seconds
    onCountdown(seconds)
  }

  function stop() {
    cancelCheck()
    state.active = false
    state.lastActivityAt = null
    showCountdown(null)
  }

  function check() {
    if (!state.active) return
    cancelCheck()
    const remaining = timeoutMs - (now() - state.lastActivityAt)
    if (remaining <= 0) {
      stop()
      onExpire()
      return
    }
    const seconds = remaining <= countdownMs ? Math.ceil(remaining / 1000) : null
    showCountdown(seconds)
    const nextCheckIn = seconds === null
      ? remaining - countdownMs
      : remaining - (seconds - 1) * 1000
    timer = setTimer(check, Math.max(1, Math.ceil(nextCheckIn)))
  }

  function start() {
    if (state.active) return
    state.active = true
    state.lastActivityAt = now()
    check()
  }

  // Pointer moves only update a timestamp. The existing scheduled check adapts to it.
  function activity() {
    if (!state.active) return
    state.lastActivityAt = now()
    showCountdown(null)
  }

  return { state, start, stop, activity, check }
}
