export const TRACKING_LOSS_GRACE_MS = 130
export const PREDICTION_MAX_MS = 150

const SLASH_START_SPEED = 0.35 // Camera diagonals per second: a deliberate swipe.
const MAX_PLAUSIBLE_SPEED = 2.6 // Reject jumps that likely changed hands/locations.
const SLOW_END_MS = 120
export const TRAIL_FADE_MS = 240
const BRIDGED_LABEL_MS = 350
const MAX_SEGMENTS = 256
const PREDICTION_MIN_SPEED = 0.43
const PREDICTION_MIN_DIRECTION_COSINE = 0.9
const MAX_RELIABLE_SAMPLE_GAP_MS = 70
export const HAND_SLASH_START_SPEED = 0.35
const HAND_PREDICTION_MIN_SPEED = 0.38
export const HAND_PREDICTION_MIN_DIRECTION_COSINE = 0.86

export function createSlashTracker() {
  const state = {
    motionSource: 'HYBRID',
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
    predictionActive: false,
    slashArmed: false,
    directionStability: 0,
    reliableStreak: 0,
    handAnchor: null,
    lastHandAt: null,
    handVelocity: null,
    handPreviousVelocity: null,
    handPredictionOffset: null,
    handSpeed: 0,
    handDirectionStability: 0,
    handReliableStreak: 0,
    handOffsetFresh: false,
    diagonal: 1,
  }

  function endSlash() {
    state.slashActive = false
    state.slashArmed = false
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
    state.predictionActive = false
    state.directionStability = 0
    state.reliableStreak = 0
    state.handAnchor = null
    state.lastHandAt = null
    state.handVelocity = null
    state.handPreviousVelocity = null
    state.handPredictionOffset = null
    state.handSpeed = 0
    state.handDirectionStability = 0
    state.handReliableStreak = 0
    state.handOffsetFresh = false
    state.bridgedUntil = 0
    state.tracking = 'LOST'
  }

  function addSegment(from, to, now, bridged, predicted = false) {
    const segment = {
      from: { ...from }, to: { ...to }, at: now, bridged, predicted,
      activeSlash: true, collisionMode: predicted ? 'PREDICTED' : 'NORMAL',
    }
    state.segments.push(segment)
    if (state.segments.length > MAX_SEGMENTS) state.segments.shift()
    state.trail.push(segment)
    return segment
  }

  function handMotionIsArmed() {
    return state.handReliableStreak >= 3
      && state.handSpeed >= HAND_PREDICTION_MIN_SPEED
      && state.handDirectionStability >= HAND_PREDICTION_MIN_DIRECTION_COSINE
      && state.handOffsetFresh
      && Boolean(state.handVelocity && state.handPreviousVelocity && state.handPredictionOffset)
  }

  // Called once per detected hand frame, even if fingertip filtering holds a sample.
  function observeMotion(motion) {
    if (state.motionSource !== 'HYBRID') return
    if (!motion?.anchor) {
      state.handAnchor = null
      state.handVelocity = null
      state.handPreviousVelocity = null
      state.handOffsetFresh = false
      state.slashArmed = false
      return
    }
    state.handAnchor = { ...motion.anchor }
    state.lastHandAt = motion.at
    state.handVelocity = motion.velocity && { ...motion.velocity }
    state.handPreviousVelocity = motion.previousVelocity && { ...motion.previousVelocity }
    state.handSpeed = motion.speed
    state.handDirectionStability = motion.directionStability
    state.handReliableStreak = motion.reliableStreak
    state.handOffsetFresh = motion.offsetFresh
    if (motion.reliableStreak >= 2 && motion.speed >= HAND_SLASH_START_SPEED) {
      state.slashActive = true
      state.slowSince = null
    }
    state.directionStability = motion.directionStability
    state.slashArmed = state.slashActive && handMotionIsArmed()
  }

  function cleanWithHandDirection(point, motion) {
    if (state.motionSource !== 'HYBRID' || !motion?.offsetFresh
      || motion.reliableStreak < 3 || motion.speed < HAND_SLASH_START_SPEED
      || motion.directionStability < HAND_PREDICTION_MIN_DIRECTION_COSINE
      || !motion.velocity || !motion.offset) return point
    const length = Math.hypot(motion.velocity.x, motion.velocity.y)
    if (!length) return point
    const ux = motion.velocity.x / length
    const uy = motion.velocity.y / length
    const baseX = motion.anchor.x + motion.offset.x
    const baseY = motion.anchor.y + motion.offset.y
    const errorX = point.x - baseX
    const errorY = point.y - baseY
    const along = errorX * ux + errorY * uy
    const lateral = errorX * -uy + errorY * ux
    // Keep some fingertip detail, but strongly suppress cross-track wobble.
    return {
      x: baseX + along * 0.45 * ux - lateral * 0.15 * uy,
      y: baseY + along * 0.45 * uy + lateral * 0.15 * ux,
    }
  }

  function detected(inputPoint, now, diagonal, motion) {
    const handAssist = state.motionSource === 'HYBRID' && Boolean(motion?.anchor)
    const point = handAssist ? cleanWithHandDirection(inputPoint, motion) : inputPoint
    const previous = state.lastReliablePoint
    const elapsed = state.lastReliableAt === null ? Infinity : now - state.lastReliableAt
    const hadGap = state.missingSince !== null
    let bridged = false
    let newSegment = null

    const reconnectWindow = state.predictedPoint ? PREDICTION_MAX_MS : TRACKING_LOSS_GRACE_MS
    if (previous && elapsed > 0 && elapsed <= reconnectWindow) {
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
        if (speed >= SLASH_START_SPEED || (handAssist && state.handSpeed >= HAND_SLASH_START_SPEED)) {
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
      if (!hadGap && plausible && elapsed <= MAX_RELIABLE_SAMPLE_GAP_MS) {
        state.previousVelocity = state.velocity
        state.velocity = { x: (point.x - previous.x) / elapsed, y: (point.y - previous.y) / elapsed }
        state.reliableStreak += 1
        const current = state.velocity
        const prior = state.previousVelocity
        const lengths = prior && Math.hypot(current.x, current.y) * Math.hypot(prior.x, prior.y)
        state.directionStability = lengths
          ? (current.x * prior.x + current.y * prior.y) / lengths
          : 0
        if (handAssist) {
          state.directionStability = state.handDirectionStability
          state.slashArmed = state.slashActive && handMotionIsArmed()
        } else {
          state.slashArmed = Boolean(state.slashActive
            && state.reliableStreak >= 3
            && state.lastSpeed >= PREDICTION_MIN_SPEED
            && state.directionStability >= PREDICTION_MIN_DIRECTION_COSINE)
        }
      } else {
        state.previousVelocity = null
        state.velocity = null
        state.reliableStreak = 1
        state.directionStability = 0
        state.slashArmed = false
      }
    } else {
      // A long gap or first detection starts a new movement history.
      endSlash()
      state.lastSpeed = 0
      state.previousVelocity = null
      state.velocity = null
      state.reliableStreak = 1
      state.directionStability = 0
      state.slashArmed = false
    }

    if (handAssist && !hadGap && state.slashActive) {
      // Use the recent stable fingertip-to-palm offset for complete-hand loss.
      state.handPredictionOffset = motion.offsetFresh && motion.offset
        ? { ...motion.offset } : null
      state.directionStability = state.handDirectionStability
      state.slashArmed = handMotionIsArmed()
    } else if (state.motionSource === 'HYBRID' && motion === null) {
      // Palm landmarks are unavailable: allow pointing, but do not arm prediction.
      state.slashArmed = false
    }

    state.lastReliablePoint = { ...point }
    state.lastReliableAt = now
    state.missingSince = null
    state.missingForMs = 0
    state.predictionVelocity = null
    state.predictedPoint = null
    state.predictedMs = 0
    state.predictionActive = false
    state.diagonal = diagonal
    state.tracking = 'DETECTED'
    if (newSegment) newSegment.collisionMode = state.slashArmed ? 'FAST' : 'NORMAL'
    return { bridged, segment: newSegment }
  }

  function missing(now, allowPrediction = true) {
    state.missingSince ??= now
    state.missingForMs = Math.max(0, Math.round(now - state.missingSince))
    const lastMotionAt = state.motionSource === 'HYBRID' && state.slashArmed && state.lastHandAt !== null
      ? state.lastHandAt : state.lastReliableAt
    const elapsed = lastMotionAt === null ? Infinity : now - lastMotionAt
    if (elapsed > (state.slashArmed ? PREDICTION_MAX_MS : TRACKING_LOSS_GRACE_MS)) {
      loseHistory()
      return null
    }
    // The MediaPipe/tracking label can already be LOST; armed motion has its own short horizon.
    state.tracking = elapsed <= TRACKING_LOSS_GRACE_MS ? 'GRACE' : 'LOST'

    if (!allowPrediction || elapsed > PREDICTION_MAX_MS || !state.slashArmed) return null

    if (!state.predictionVelocity) {
      const useHand = state.motionSource === 'HYBRID' && state.handAnchor && state.handPredictionOffset
      const current = useHand ? state.handVelocity : state.velocity
      const previous = useHand ? state.handPreviousVelocity : state.previousVelocity
      if (!current || !previous) return null
      state.predictionVelocity = {
        x: current.x * 0.7 + previous.x * 0.3,
        y: current.y * 0.7 + previous.y * 0.3,
      }
    }

    // Integrate a linearly decaying velocity, then stop at the short horizon.
    const duration = Math.min(elapsed, PREDICTION_MAX_MS)
    const travel = duration * (1 - duration / (2 * PREDICTION_MAX_MS))
    const useHand = state.motionSource === 'HYBRID' && state.handAnchor && state.handPredictionOffset
    const base = useHand
      ? { x: state.handAnchor.x + state.handPredictionOffset.x,
          y: state.handAnchor.y + state.handPredictionOffset.y }
      : state.lastReliablePoint
    if (!state.predictedPoint && Math.hypot(
      base.x - state.lastReliablePoint.x, base.y - state.lastReliablePoint.y,
    ) > Math.max(35, state.diagonal * 0.055)) {
      state.slashArmed = false
      return null
    }
    const next = { x: base.x + state.predictionVelocity.x * travel,
      y: base.y + state.predictionVelocity.y * travel }
    const from = state.predictedPoint ?? state.lastReliablePoint
    state.predictedMs = duration
    state.predictionActive = true
    if (Math.hypot(next.x - from.x, next.y - from.y) < 1) return null
    state.predictedPoint = next
    return addSegment(from, next, now, false, true)
  }

  function tick(now) {
    while (state.trail.length && now - state.trail[0].at >= TRAIL_FADE_MS) state.trail.shift()
    if (state.missingSince !== null) return missing(now)
    const lastMotionAt = state.motionSource === 'HYBRID' && state.slashArmed && state.lastHandAt !== null
      ? state.lastHandAt : state.lastReliableAt
    if (state.tracking === 'DETECTED' && now - lastMotionAt > MAX_RELIABLE_SAMPLE_GAP_MS) {
      state.missingSince = lastMotionAt
      return missing(now)
    }
    return null
  }

  function disarm() {
    state.slashArmed = false
    state.reliableStreak = 0
    state.directionStability = 0
    state.previousVelocity = null
  }

  function reset() {
    loseHistory()
    state.missingSince = null
    state.missingForMs = 0
    state.trail = []
    state.bridgedUntil = 0
  }

  function setMotionSource(source) {
    if (source !== 'HYBRID' && source !== 'FINGER ONLY') throw new Error('Invalid motion source')
    reset()
    state.motionSource = source
  }

  return { state, detected, missing, tick, disarm, observeMotion, setMotionSource, reset }
}
