export const SLOW_SMOOTH_ALPHA = 0.27
export const FAST_SMOOTH_ALPHA = 0.82
const SLOW_SPEED = 0.1 // Screen diagonals/second.
const FAST_SPEED = 0.9
const REFERENCE_FRAME_MS = 33
export const TURN_CONFIRM_MAX_MS = 70
const MAX_PLAUSIBLE_SPEED = 2.6

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp01 = (value) => Math.max(0, Math.min(1, value))

export function createFingerProcessor() {
  const state = { raw: null, smooth: null, path: null, rawSpeed: 0, rejected: 0,
    held: 0, accepted: 0, estimated: 0, pending: null }
  const history = []
  const pathHistory = []

  function accept(point, now, diagonal) {
    state.accepted++
    const previous = history.at(-1)
    const dt = previous ? Math.max(1, now - previous.at) : REFERENCE_FRAME_MS
    const speed = previous ? (distance(point, previous.point) / diagonal) / (dt / 1000) : 0
    const mix = clamp01((speed - SLOW_SPEED) / (FAST_SPEED - SLOW_SPEED))
    const baseAlpha = SLOW_SMOOTH_ALPHA + (FAST_SMOOTH_ALPHA - SLOW_SMOOTH_ALPHA) * mix
    const alpha = 1 - (1 - baseAlpha) ** (dt / REFERENCE_FRAME_MS)

    state.raw = { ...point }
    state.smooth = previous
      ? {
          x: state.smooth.x + alpha * (point.x - state.smooth.x),
          y: state.smooth.y + alpha * (point.y - state.smooth.y),
        }
      : { ...point }
    state.rawSpeed = speed

    history.push({ point: { ...point }, at: now })
    if (history.length > 3) history.shift()

    // A causal 3-point weighted average suppresses frame-to-frame waviness.
    // The same x/y weights preserve the direction of straight and diagonal swipes.
    const newest = history.at(-1).point
    const middle = history.at(-2)?.point ?? newest
    const oldest = history.at(-3)?.point ?? middle
    const weighted = {
      x: 0.62 * newest.x + 0.28 * middle.x + 0.1 * oldest.x,
      y: 0.62 * newest.y + 0.28 * middle.y + 0.1 * oldest.y,
    }
    pathHistory.push({ ...weighted, at: now })
    if (pathHistory.length > 5) pathHistory.shift()
    state.path = speed >= 0.35 ? fittedSlashPoint(pathHistory, weighted) : weighted
    return { point: { ...state.path }, at: now }
  }

  function suspicious(point, now, diagonal) {
    const last = history.at(-1)
    const before = history.at(-2)
    if (!last) return false
    const dt = now - last.at
    if (dt <= 0 || dt > 150) return false
    const incomingSpeed = (distance(point, last.point) / diagonal) / (dt / 1000)
    if (incomingSpeed > MAX_PLAUSIBLE_SPEED) return true
    if (!before || incomingSpeed < 0.45) return false

    const previousDt = last.at - before.at
    if (previousDt <= 0) return false
    const vx = (last.point.x - before.point.x) / previousDt
    const vy = (last.point.y - before.point.y) / previousDt
    const recentSpeed = Math.hypot(vx, vy) * 1000 / diagonal
    if (recentSpeed < 0.2) return false

    const expectedX = last.point.x + vx * dt
    const expectedY = last.point.y + vy * dt
    const errorX = point.x - expectedX
    const errorY = point.y - expectedY
    const error = Math.hypot(errorX, errorY)
    const lateralError = Math.abs(errorX * vy - errorY * vx) / Math.hypot(vx, vy)
    return error > Math.max(28, diagonal * 0.013)
      && lateralError > Math.max(18, diagonal * 0.008)
  }

  function sample(point, now, diagonal) {
    const accepted = []
    if (state.pending) {
      const pending = state.pending
      state.pending = null
      const last = history.at(-1)
      const dt = now - pending.at
      const incomingDt = pending.at - last.at
      const incoming = distance(pending.point, last.point) * 1000 / (diagonal * incomingDt)
      const onward = distance(point, pending.point) * 1000 / (diagonal * dt)
      const forward = (pending.point.x - last.point.x) * (point.x - pending.point.x)
        + (pending.point.y - last.point.y) * (point.y - pending.point.y) >= 0
      // Confirm motion, not proximity to a frozen point. Returning to the old
      // trajectory rejects an isolated spike; a continuing turn resolves in one frame.
      if (dt > 0 && dt <= TURN_CONFIRM_MAX_MS && onward <= MAX_PLAUSIBLE_SPEED
        && forward && suspicious(point, now, diagonal)) {
        if (incoming <= MAX_PLAUSIBLE_SPEED) {
          pathHistory.length = 0 // Do not fit a new turn to the old straight line.
          accepted.push(accept(pending.point, pending.at, diagonal))
          accepted.push(accept(point, now, diagonal))
        } else {
          // Consistent relocation: seed at the new position without a hit bridge.
          state.rejected++
          history.length = pathHistory.length = 0
          accepted.push({ ...accept(point, now, diagonal), reseed: true })
        }
        return accepted
      }
      state.rejected++
      if (suspicious(point, now, diagonal)
        && distance(point, last.point) * 1000 / (diagonal * (now - last.at)) <= MAX_PLAUSIBLE_SPEED) {
        // An unconfirmed direction change gets a new seed, not another hold.
        history.length = pathHistory.length = 0
        return [{ ...accept(point, now, diagonal), reseed: true }]
      }
    }

    if (suspicious(point, now, diagonal)) {
      state.pending = { point: { ...point }, at: now }
      state.held++
    } else {
      accepted.push(accept(point, now, diagonal))
    }
    return accepted
  }

  function sampleEstimated(point, now, diagonal) {
    // A point supported by the palm trajectory and a recent finger offset is
    // already checked for a fingertip outlier; keep the slash moving through it.
    if (state.pending) state.rejected += 1
    state.pending = null
    state.estimated++
    return [accept(point, now, diagonal)]
  }

  function reset() {
    history.length = 0
    pathHistory.length = 0
    state.raw = null
    state.smooth = null
    state.path = null
    state.rawSpeed = 0
    state.rejected = 0
    state.held = state.accepted = state.estimated = 0
    state.pending = null
  }

  return { state, sample, sampleEstimated, reset }
}

// Fit x(t) and y(t) over recent points. A straight swipe loses perpendicular
// landmark wobble while vertical and diagonal directions work identically.
function fittedSlashPoint(samples, fallback) {
  if (samples.length < 3) return fallback
  const origin = samples[0].at
  const count = samples.length
  const meanT = samples.reduce((sum, item) => sum + item.at - origin, 0) / count
  const meanX = samples.reduce((sum, item) => sum + item.x, 0) / count
  const meanY = samples.reduce((sum, item) => sum + item.y, 0) / count
  let varianceT = 0
  let covarianceX = 0
  let covarianceY = 0
  for (const item of samples) {
    const centeredT = item.at - origin - meanT
    varianceT += centeredT * centeredT
    covarianceX += centeredT * (item.x - meanX)
    covarianceY += centeredT * (item.y - meanY)
  }
  if (!varianceT) return fallback
  const vx = covarianceX / varianceT
  const vy = covarianceY / varianceT
  const span = Math.hypot(vx, vy) * (samples.at(-1).at - origin)
  if (span < 20) return fallback
  let errorSquared = 0
  for (const item of samples) {
    const dt = item.at - origin - meanT
    errorSquared += (item.x - meanX - vx * dt) ** 2 + (item.y - meanY - vy * dt) ** 2
  }
  // A sharp intentional turn should follow the actual points, not an old line.
  if (Math.sqrt(errorSquared / count) > span * 0.3) return fallback
  const endT = samples.at(-1).at - origin - meanT
  return { x: meanX + vx * endT, y: meanY + vy * endT }
}
