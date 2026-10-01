// MediaPipe Hand Landmarker: wrist, index/middle/ring/pinky MCP joints.
// Fingertips are intentionally excluded from the motion anchor.
export const HAND_ANCHOR_INDICES = [0, 5, 9, 13, 17]
const HAND_ANCHOR_WEIGHTS = [0.12, 0.22, 0.22, 0.22, 0.22]
export const HAND_SAMPLE_GAP_MS = 70
export const FINGER_OFFSET_MAX_AGE_MS = 120
const HAND_SMOOTH_ALPHA = 0.65
const FINGER_OFFSET_ALPHA = 0.28
const REFERENCE_FRAME_MS = 33
const ESTIMATE_MIN_HAND_SPEED = 0.28 // Screen diagonals per second.
const MAX_PLAUSIBLE_HAND_SPEED = 2.6

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

export function handAnchorFromLandmarks(landmarks) {
  if (!landmarks) return null
  let x = 0
  let y = 0
  for (let index = 0; index < HAND_ANCHOR_INDICES.length; index += 1) {
    const point = landmarks[HAND_ANCHOR_INDICES[index]]
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
    x += point.x * HAND_ANCHOR_WEIGHTS[index]
    y += point.y * HAND_ANCHOR_WEIGHTS[index]
  }
  return { x, y }
}

export function estimateFingerFromHand(anchor, offset) {
  return anchor && offset ? { x: anchor.x + offset.x, y: anchor.y + offset.y } : null
}

export function createHandMotionProcessor() {
  const state = {
    rawHandAnchor: null,
    smoothedHandAnchor: null,
    rawFinger: null,
    smoothedFingerOffset: null,
    offsetAt: null,
    estimatedFinger: null,
    fingerSource: 'NONE',
    handSpeed: 0,
    directionStability: 0,
    reliableStreak: 0,
    velocity: null,
    previousVelocity: null,
    lastAt: null,
    wasMissing: false,
  }

  function sample(anchor, finger, now, diagonal) {
    state.rawFinger = finger ? { ...finger } : null
    state.estimatedFinger = null
    if (!anchor) {
      state.rawHandAnchor = null
      state.smoothedHandAnchor = null
      state.handSpeed = 0
      state.directionStability = 0
      state.reliableStreak = 0
      state.velocity = null
      state.previousVelocity = null
      state.lastAt = null
      state.fingerSource = finger ? 'RAW' : 'NONE'
      return { point: finger, motion: null }
    }

    const previous = state.smoothedHandAnchor
    const elapsed = state.lastAt === null ? Infinity : now - state.lastAt
    const incomingSpeed = state.rawHandAnchor && elapsed > 0
      ? distance(anchor, state.rawHandAnchor) * 1000 / (diagonal * elapsed)
      : 0
    const implausibleJump = incomingSpeed > MAX_PLAUSIBLE_HAND_SPEED
    const continuous = previous && !state.wasMissing && !implausibleJump
      && elapsed > 0 && elapsed <= HAND_SAMPLE_GAP_MS
    if (implausibleJump) {
      state.smoothedFingerOffset = null
      state.offsetAt = null
    }
    const alpha = continuous
      ? 1 - (1 - HAND_SMOOTH_ALPHA) ** (elapsed / REFERENCE_FRAME_MS)
      : 1
    state.rawHandAnchor = { ...anchor }
    state.smoothedHandAnchor = previous && continuous
      ? {
          x: previous.x + alpha * (anchor.x - previous.x),
          y: previous.y + alpha * (anchor.y - previous.y),
        }
      : { ...anchor }
    state.lastAt = now
    state.wasMissing = false

    if (continuous) {
      state.previousVelocity = state.velocity
      state.velocity = {
        x: (state.smoothedHandAnchor.x - previous.x) / elapsed,
        y: (state.smoothedHandAnchor.y - previous.y) / elapsed,
      }
      state.handSpeed = Math.hypot(state.velocity.x, state.velocity.y) * 1000 / diagonal
      state.reliableStreak += 1
      const prior = state.previousVelocity
      const lengths = prior && Math.hypot(prior.x, prior.y) * Math.hypot(state.velocity.x, state.velocity.y)
      state.directionStability = lengths
        ? (prior.x * state.velocity.x + prior.y * state.velocity.y) / lengths
        : 0
    } else {
      state.velocity = null
      state.previousVelocity = null
      state.handSpeed = 0
      state.directionStability = 0
      state.reliableStreak = 1
    }

    const offsetFresh = state.offsetAt !== null && now - state.offsetAt <= FINGER_OFFSET_MAX_AGE_MS
    const candidateOffset = finger && {
      x: finger.x - state.smoothedHandAnchor.x,
      y: finger.y - state.smoothedHandAnchor.y,
    }
    const offsetJump = candidateOffset && offsetFresh && state.smoothedFingerOffset
      && distance(candidateOffset, state.smoothedFingerOffset) > Math.max(30, diagonal * 0.035)
    const fingerUnreliable = Boolean(offsetJump && state.handSpeed >= ESTIMATE_MIN_HAND_SPEED)

    if (candidateOffset && !fingerUnreliable) {
      const blend = offsetFresh && continuous
        ? 1 - (1 - FINGER_OFFSET_ALPHA) ** (elapsed / REFERENCE_FRAME_MS) : 1
      state.smoothedFingerOffset = state.smoothedFingerOffset && offsetFresh
        ? {
            x: state.smoothedFingerOffset.x + blend * (candidateOffset.x - state.smoothedFingerOffset.x),
            y: state.smoothedFingerOffset.y + blend * (candidateOffset.y - state.smoothedFingerOffset.y),
          }
        : candidateOffset
      state.offsetAt = now
    }

    const canEstimate = state.smoothedFingerOffset && state.offsetAt !== null
      && now - state.offsetAt <= FINGER_OFFSET_MAX_AGE_MS
      && state.handSpeed >= ESTIMATE_MIN_HAND_SPEED
    const useEstimate = canEstimate && (!finger || fingerUnreliable)
    state.estimatedFinger = useEstimate
      ? estimateFingerFromHand(state.smoothedHandAnchor, state.smoothedFingerOffset)
      : null
    state.fingerSource = useEstimate ? 'ESTIMATED' : finger ? 'RAW' : 'NONE'
    return {
      point: state.estimatedFinger ?? finger,
      motion: {
        at: now,
        anchor: { ...state.smoothedHandAnchor },
        velocity: state.velocity && { ...state.velocity },
        previousVelocity: state.previousVelocity && { ...state.previousVelocity },
        speed: state.handSpeed,
        directionStability: state.directionStability,
        reliableStreak: state.reliableStreak,
        offset: state.smoothedFingerOffset && { ...state.smoothedFingerOffset },
        offsetFresh: state.offsetAt !== null && now - state.offsetAt <= FINGER_OFFSET_MAX_AGE_MS,
        fingerSource: state.fingerSource,
      },
    }
  }

  function markMissing() {
    state.wasMissing = true
    state.rawFinger = null
    state.fingerSource = 'NONE'
    state.handSpeed = 0
    state.directionStability = 0
  }

  function reset() {
    state.rawHandAnchor = null
    state.smoothedHandAnchor = null
    state.rawFinger = null
    state.smoothedFingerOffset = null
    state.offsetAt = null
    state.estimatedFinger = null
    state.fingerSource = 'NONE'
    state.handSpeed = 0
    state.directionStability = 0
    state.reliableStreak = 0
    state.velocity = null
    state.previousVelocity = null
    state.lastAt = null
    state.wasMissing = false
  }

  return { state, sample, markMissing, reset }
}
