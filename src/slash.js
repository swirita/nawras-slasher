export const TRACKING_LOSS_GRACE_MS = 130
export const PREDICTION_MAX_MS = 120

const SLASH_START_SPEED = 0.35 // Camera diagonals per second: a deliberate swipe.
const MAX_PLAUSIBLE_SPEED = 2.6 // Reject jumps that likely changed hands/locations.
const SLOW_END_MS = 120
export const TRAIL_FADE_MS = 240
const BRIDGED_LABEL_MS = 350
const MAX_SEGMENTS = 256
const PREDICTION_MIN_SPEED = 0.43
const PREDICTION_MIN_DIRECTION_COSINE = 0.87

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
    velocity: null,
    previousVelocity: null,
    predictionVelocity: null,
    predictedPoint: null,
    predictedMs: 0,
    diagonal: 1,
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
    state.velocity = null
    state.previousVelocity = null
    state.predictionVelocity = null
    state.predictedPoint = null
    state.predictedMs = 0
    state.bridgedUntil = 0
    state.tracking = 'LOST'
  }

  function addSegment(from, to, now, bridged, predicted = false) {
    const segment = { from: { ...from }, to: { ...to }, at: now, bridged, predicted, activeSlash: true }
    state.segments.push(segment)
    if (state.segments.length > MAX_SEGMENTS) state.segments.shift()
    state.trail.push(segment)
    return segment
  }

  function detected(point, now, diagonal) {
    const previous = state.lastReliablePoint
    const elapsed = state.lastReliableAt === null ? Infinity : now - state.lastReliableAt
    const hadGap = state.missingSince !== null
    let bridged = false
    let newSegment = null

    if (previous && elapsed > 0 && elapsed <= TRACKING_LOSS_GRACE_MS) {
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y)
      const speed = (distance / diagonal) / (elapsed / 1000)
      const plausible = speed <= MAX_PLAUSIBLE_SPEED

      if (hadGap) {
        const predictedDistance = state.predictedPoint
          ? Math.hypot(point.x - state.predictedPoint.x, point.y - state.predictedPoint.y)
          : Infinity
        const predictionConsistent = state.predictedPoint
          && predictedDistance <= Math.max(35, diagonal * 0.055)
        // A predicted path must agree with reacquisition; otherwise discard it.
        if (predictionConsistent && plausible) {
          newSegment = addSegment(state.predictedPoint, point, now, true)
          state.bridgedUntil = now + BRIDGED_LABEL_MS
          bridged = true
        } else if (!state.predictedPoint && plausible && (state.slashActive || state.lastSpeed >= SLASH_START_SPEED)) {
          state.slashActive = true
          state.slowSince = null
          newSegment = addSegment(previous, point, now, true)
          state.bridgedUntil = now + BRIDGED_LABEL_MS
          bridged = true
        } else {
          endSlash()
          state.trail = state.trail.filter((segment) => !segment.predicted)
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
        if (state.slashActive) newSegment = addSegment(previous, point, now, false)
      } else {
        endSlash()
        state.bridgedUntil = 0
      }

      state.lastSpeed = plausible && (!hadGap || bridged) ? speed : 0
      if (!hadGap && plausible) {
        state.previousVelocity = state.velocity
        state.velocity = { x: (point.x - previous.x) / elapsed, y: (point.y - previous.y) / elapsed }
      } else {
        state.previousVelocity = null
        state.velocity = null
      }
    } else {
      // A long gap or first detection starts a new movement history.
      endSlash()
      state.lastSpeed = 0
      state.previousVelocity = null
      state.velocity = null
    }

    state.lastReliablePoint = { ...point }
    state.lastReliableAt = now
    state.missingSince = null
    state.missingForMs = 0
    state.predictionVelocity = null
    state.predictedPoint = null
    state.predictedMs = 0
    state.diagonal = diagonal
    state.tracking = 'DETECTED'
    return { bridged, segment: newSegment }
  }

  function missing(now, allowPrediction = true) {
    state.missingSince ??= now
    state.missingForMs = Math.max(0, Math.round(now - state.missingSince))
    if (state.lastReliableAt !== null && now - state.lastReliableAt <= TRACKING_LOSS_GRACE_MS) {
      state.tracking = 'GRACE'
    } else {
      loseHistory()
      return null
    }

    const elapsed = now - state.lastReliableAt
    if (!allowPrediction || elapsed > PREDICTION_MAX_MS || !state.slashActive) return null

    if (!state.predictionVelocity) {
      const current = state.velocity
      const previous = state.previousVelocity
      if (!current || !previous || state.lastSpeed < PREDICTION_MIN_SPEED) return null
      const currentLength = Math.hypot(current.x, current.y)
      const previousLength = Math.hypot(previous.x, previous.y)
      if (!currentLength || !previousLength) return null
      const cosine = (current.x * previous.x + current.y * previous.y) / (currentLength * previousLength)
      if (cosine < PREDICTION_MIN_DIRECTION_COSINE) return null
      state.predictionVelocity = {
        x: current.x * 0.7 + previous.x * 0.3,
        y: current.y * 0.7 + previous.y * 0.3,
      }
    }

    // Integrate a linearly decaying velocity, then stop at the short horizon.
    const duration = Math.min(elapsed, PREDICTION_MAX_MS)
    const travel = duration * (1 - duration / (2 * PREDICTION_MAX_MS))
    const next = {
      x: state.lastReliablePoint.x + state.predictionVelocity.x * travel,
      y: state.lastReliablePoint.y + state.predictionVelocity.y * travel,
    }
    const from = state.predictedPoint ?? state.lastReliablePoint
    state.predictedMs = duration
    if (Math.hypot(next.x - from.x, next.y - from.y) < 1) return null
    state.predictedPoint = next
    return addSegment(from, next, now, false, true)
  }

  function tick(now) {
    while (state.trail.length && now - state.trail[0].at >= TRAIL_FADE_MS) state.trail.shift()
    if (state.tracking === 'GRACE') missing(now, false)
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
