export const RESET_CONFIRM_MS = 2000
export const resetGameVisible = (phase) => phase === 'PLAYING'

// Presentation-only confirmation. The caller owns the actual round/camera cleanup.
export function createResetConfirmation({
  isPlaying,
  onConfirm,
  onChange = () => {},
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  timeoutMs = RESET_CONFIRM_MS,
}) {
  const state = { armed: false, expiresAt: 0 }
  let timer = null

  function clear() {
    if (timer !== null) clearTimer(timer)
    timer = null
    state.armed = false
    state.expiresAt = 0
    onChange(false)
  }

  function click() {
    if (!isPlaying()) {
      clear()
      return false
    }
    const clickedAt = now()
    if (state.armed && clickedAt < state.expiresAt) {
      clear()
      onConfirm()
      return true
    }
    clear()
    state.armed = true
    state.expiresAt = clickedAt + timeoutMs
    onChange(true)
    timer = setTimer(clear, timeoutMs)
    return false
  }

  return { state, click, clear }
}
