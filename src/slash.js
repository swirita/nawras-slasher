export const TRACKING_LOSS_GRACE_MS = 130

const SLASH_START_SPEED = 0.35 // Camera diagonals per second: a deliberate swipe.
const MAX_PLAUSIBLE_SPEED = 2.6 // Reject jumps that likely changed hands/locations.
const SLOW_END_MS = 120
export const TRAIL_FADE_MS = 240
const BRIDGED_LABEL_MS = 350
const MAX_SEGMENTS = 256

export function createSlashTracker() {
  const state = {
    tracking: 'LOST',
    missingForMs: 0,
    missingSince: null,
    lastReliablePoint: null,
    lastReliableAt: null,
    lastSpeed: 0,
    slashActive: false,
    // Active slash geometry for later target collision checks.
    segments: [],
    // Recent geometry kept briefly for visual fading only.
    trail: [],
    bridgedUntil: 0,
    slowSince: null,
  }

  function endSlash() {
    state.slashActive = false
    state.segments = []
    state.slowSince = null
  }

  function loseHistory() {
    endSlash()
    state.lastReliablePoint = null
    state.lastReliableAt = null
    state.lastSpeed = 0
    state.bridgedUntil = 0
    state.tracking = 'LOST'
  }

  function addSegment(from, to, now, bridged) {
    const segment = { from: { ...from }, to: { ...to }, at: now, bridged }
    state.segments.push(segment)
    if (state.segments.length > MAX_SEGMENTS) state.segments.shift()
    state.trail.push(segment)
  }

  function detected(point, now, diagonal) {
    const previous = state.lastReliablePoint
    const elapsed = state.lastReliableAt === null ? Infinity : now - state.lastReliableAt
    const hadGap = state.missingSince !== null
    let bridged = false

    if (previous && elapsed > 0 && elapsed <= TRACKING_LOSS_GRACE_MS) {
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y)
      const speed = (distance / diagonal) / (elapsed / 1000)
      const plausible = speed <= MAX_PLAUSIBLE_SPEED

      if (hadGap) {
        // Bridge only a short, plausible jump with evidence of an ongoing swipe.
        if (plausible && (state.slashActive || state.lastSpeed >= SLASH_START_SPEED)) {
          state.slashActive = true
          state.slowSince = null
          addSegment(previous, point, now, true)
          state.bridgedUntil = now + BRIDGED_LABEL_MS
          bridged = true
        } else {
          endSlash()
          state.bridgedUntil = 0
        }
      } else if (plausible) {
        if (speed >= SLASH_START_SPEED) {
          state.slashActive = true
          state.slowSince = null
        } else if (state.slashActive) {
          state.slowSince ??= now
          if (now - state.slowSince >= SLOW_END_MS) endSlash()
        }
        if (state.slashActive) addSegment(previous, point, now, false)
      } else {
        endSlash()
        state.bridgedUntil = 0
      }

      state.lastSpeed = plausible && (!hadGap || bridged) ? speed : 0
    } else {
      // A long gap or first detection starts a new movement history.
      endSlash()
      state.lastSpeed = 0
    }

    state.lastReliablePoint = { ...point }
    state.lastReliableAt = now
    state.missingSince = null
    state.missingForMs = 0
    state.tracking = 'DETECTED'
    return bridged
  }

  function missing(now) {
    state.missingSince ??= now
    state.missingForMs = Math.max(0, Math.round(now - state.missingSince))
    if (state.lastReliableAt !== null && now - state.lastReliableAt <= TRACKING_LOSS_GRACE_MS) {
      state.tracking = 'GRACE'
    } else {
      loseHistory()
    }
  }

  function tick(now) {
    state.trail = state.trail.filter((segment) => now - segment.at < TRAIL_FADE_MS)
    if (state.tracking === 'GRACE') missing(now)
    if (state.tracking === 'DETECTED' && now - state.lastReliableAt > TRACKING_LOSS_GRACE_MS) {
      state.missingSince = state.lastReliableAt
      missing(now)
    }
  }

  function reset() {
    loseHistory()
    state.missingSince = null
    state.missingForMs = 0
    state.trail = []
    state.bridgedUntil = 0
  }

  return { state, detected, missing, tick, reset }
}
