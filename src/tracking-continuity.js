// Presentation may hold a hand briefly; interaction has a stricter age limit.
export const INTERACTION_MAX_AGE_MS = 120
export const RESULT_MAX_AGE_MS = 150
export const CURSOR_GRACE_MS = 200

export function createTrackingContinuity() {
  const state = {
    lastResultAt: null, receivedAt: null, lastGoodAt: null, pointer: null,
    resultAgeMs: 0, goodAgeMs: Infinity, hasHand: false,
    cursorVisible: false, cursorOpacity: 0, canCollide: false,
    noHandResults: 0, invalidResults: 0, detectionLosses: 0,
    reacquisitions: 0, staleResults: 0, reason: 'NO_RESULT', needsReset: true,
    acceptedUpdates: 0, heldSamples: 0, rejectedSamples: 0, estimatedUpdates: 0,
    displayOnlyResults: 0, collisionsRejectedAge: 0,
  }

  function observe(point, at, receivedAt, landmarksPresent = Boolean(point)) {
    const age = Math.max(0, receivedAt - at)
    if (age > RESULT_MAX_AGE_MS || (state.lastResultAt !== null && at <= state.lastResultAt)) {
      state.staleResults++
      state.needsReset = true
      state.reason = 'STALE_RESULT'
      return { accepted: false, reset: false }
    }
    state.lastResultAt = at
    state.receivedAt = receivedAt
    state.resultAgeMs = age
    if (!point) {
      if (landmarksPresent) state.invalidResults++
      else state.noHandResults++
      if (state.hasHand) state.detectionLosses++
      state.hasHand = false
      state.needsReset = true
      state.reason = landmarksPresent ? 'INVALID_LANDMARKS' : 'NO_HAND_RESULT'
      return { accepted: true, reset: false }
    }
    const reset = state.needsReset || (state.lastGoodAt !== null && at - state.lastGoodAt > 130)
    if (reset && state.lastGoodAt !== null) state.reacquisitions++
    state.hasHand = true
    if (age > INTERACTION_MAX_AGE_MS) state.displayOnlyResults++
    state.lastGoodAt = at
    state.needsReset = false
    state.reason = age > INTERACTION_MAX_AGE_MS ? 'DISPLAY_ONLY_RESULT' : 'DETECTED'
    return { accepted: true, reset }
  }

  function setPointer(point) {
    if (point) state.pointer = { x: point.x, y: point.y }
  }

  function tick(now) {
    state.goodAgeMs = state.lastGoodAt === null ? Infinity : Math.max(0, now - state.lastGoodAt)
    state.cursorVisible = Boolean(state.pointer && state.goodAgeMs <= CURSOR_GRACE_MS)
    state.cursorOpacity = state.cursorVisible
      ? state.hasHand ? 1 : Math.min(1, (CURSOR_GRACE_MS - state.goodAgeMs) / (CURSOR_GRACE_MS - INTERACTION_MAX_AGE_MS)) : 0
    state.canCollide = state.lastGoodAt !== null && state.goodAgeMs <= INTERACTION_MAX_AGE_MS
    return state
  }

  // Motion stays on the capture timeline. The watchdog measures silence since
  // delivery, rather than incorrectly counting inference time as detection loss.
  function clock(now) {
    return state.lastResultAt === null ? now : state.lastResultAt + Math.max(0, now - state.receivedAt)
  }

  function reset() {
    state.lastResultAt = state.receivedAt = state.lastGoodAt = state.pointer = null
    state.resultAgeMs = 0
    state.goodAgeMs = Infinity
    state.hasHand = state.cursorVisible = state.canCollide = false
    state.cursorOpacity = 0
    state.noHandResults = state.invalidResults = state.detectionLosses = 0
    state.reacquisitions = state.staleResults = 0
    state.acceptedUpdates = state.heldSamples = state.rejectedSamples = state.estimatedUpdates = 0
    state.displayOnlyResults = state.collisionsRejectedAge = 0
    state.reason = 'NO_RESULT'
    state.needsReset = true
  }

  return { state, observe, setPointer, tick, clock, reset }
}
