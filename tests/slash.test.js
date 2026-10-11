import test from 'node:test'
import assert from 'node:assert/strict'
import { createSlashTracker, TRACKING_LOSS_GRACE_MS, PREDICTION_MAX_MS } from '../src/slash.js'
import { createHandMotionProcessor, estimateFingerFromHand } from '../src/hand.js'
import { createFingerProcessor } from '../src/tracking.js'
import { createTargetSystem } from '../src/targets.js'

function hybridSample(slash, hand, anchorX, fingerX, now) {
  const result = hand.sample({ x: anchorX, y: 100 }, { x: fingerX, y: 100 }, now, 1000)
  slash.observeMotion(result.motion)
  slash.detected(result.point, now, 1000, result.motion)
  return result
}

test('a deliberate swipe survives a short plausible detection gap', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  assert.equal(slash.state.slashActive, true)

  slash.missing(70)
  assert.equal(slash.state.tracking, 'GRACE')
  assert.equal(slash.state.slashActive, true)

  assert.equal(slash.detected({ x: 160, y: 100 }, 100, 1000).bridged, true)
  assert.equal(slash.state.segments.length, 2)
  assert.deepEqual(slash.state.segments[1].from, { x: 120, y: 100 })
  assert.deepEqual(slash.state.segments[1].to, { x: 160, y: 100 })
  assert.equal(slash.state.segments[1].bridged, true)
})

test('long loss clears slash history and reacquisition starts fresh', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  slash.missing(70)
  slash.tick(40 + TRACKING_LOSS_GRACE_MS + 1)
  assert.equal(slash.state.tracking, 'LOST')
  assert.equal(slash.state.slashActive, false)
  assert.equal(slash.state.segments.length, 0)

  assert.equal(slash.detected({ x: 900, y: 100 }, 230, 1000).segment, null)
  assert.equal(slash.state.lastSpeed, 0)
  assert.equal(slash.state.segments.length, 0)
})

test('an implausible jump is never bridged', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  slash.missing(70)

  assert.equal(slash.detected({ x: 600, y: 100 }, 100, 1000).bridged, false)
  assert.equal(slash.state.slashActive, false)
  assert.equal(slash.state.segments.length, 0)
  assert.equal(slash.state.lastSpeed, 0)
})

test('moderate movement can start a slash while slow movement cannot', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 105, y: 100 }, 40, 1000)
  assert.equal(slash.state.slashActive, false)

  slash.detected({ x: 120, y: 100 }, 80, 1000)
  assert.equal(slash.state.slashActive, true)
  assert.equal(slash.state.segments.length, 1)
})

test('stable fast slash predicts only a short decaying path during loss', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  slash.detected({ x: 140, y: 100 }, 80, 1000)
  assert.equal(slash.state.slashArmed, true)
  assert.equal(slash.state.directionStability, 1)
  const first = slash.missing(100)
  const second = slash.missing(120)
  assert.equal(first.predicted, true)
  assert.equal(second.predicted, true)
  assert.ok(second.to.x > first.to.x)
  assert.ok(second.to.x - first.to.x < first.to.x - first.from.x)
  assert.equal(slash.missing(205).predicted, true)
  assert.equal(slash.state.tracking, 'GRACE')
  slash.tick(211)
  assert.equal(slash.state.tracking, 'LOST')
  assert.equal(slash.state.predictionActive, true)
  slash.tick(80 + PREDICTION_MAX_MS + 1)
  assert.equal(slash.state.slashActive, false)
})

test('slow, stationary, and chaotic motion never arm prediction', () => {
  const slow = createSlashTracker()
  slow.detected({ x: 100, y: 100 }, 0, 1000)
  slow.detected({ x: 105, y: 100 }, 40, 1000)
  slow.detected({ x: 110, y: 100 }, 80, 1000)
  assert.equal(slow.state.slashArmed, false)
  assert.equal(slow.missing(100), null)

  const stationary = createSlashTracker()
  for (let time = 0; time <= 80; time += 40) stationary.detected({ x: 100, y: 100 }, time, 1000)
  assert.equal(stationary.missing(100), null)

  const chaotic = createSlashTracker()
  chaotic.detected({ x: 100, y: 100 }, 0, 1000)
  chaotic.detected({ x: 125, y: 100 }, 40, 1000)
  chaotic.detected({ x: 100, y: 100 }, 80, 1000)
  assert.equal(chaotic.state.slashArmed, false)
  assert.ok(chaotic.state.directionStability < 0)
  assert.equal(chaotic.missing(100), null)
})

test('armed prediction survives an immediate LOST label but expires at its horizon', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  slash.detected({ x: 140, y: 100 }, 80, 1000)
  assert.equal(slash.state.slashArmed, true)
  const segment = slash.missing(80 + TRACKING_LOSS_GRACE_MS + 5)
  assert.equal(slash.state.tracking, 'LOST')
  assert.equal(segment.predicted, true)
  assert.equal(slash.state.predictionActive, true)
  assert.equal(slash.missing(80 + PREDICTION_MAX_MS + 1), null)
  assert.equal(slash.state.predictionActive, false)
  assert.equal(slash.state.slashActive, false)
})

test('a rejected tracking sample disarms a previously fast slash', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  slash.detected({ x: 140, y: 100 }, 80, 1000)
  slash.disarm()
  assert.equal(slash.state.slashArmed, false)
  assert.equal(slash.missing(100), null)
})

test('prediction reconnects only to a consistent reacquired point', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  slash.detected({ x: 140, y: 100 }, 80, 1000)
  slash.missing(100)
  slash.missing(120)
  const reconnect = slash.detected({ x: 163, y: 100 }, 140, 1000)
  assert.equal(reconnect.bridged, true)
  assert.equal(reconnect.segment.from.x, 140, 'confirmed geometry starts at the last detection')

  slash.reset()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  slash.detected({ x: 140, y: 100 }, 80, 1000)
  slash.missing(100)
  slash.missing(120)
  const rejected = slash.detected({ x: 150, y: 180 }, 140, 1000)
  assert.equal(rejected.segment, null)
  assert.equal(slash.state.slashActive, false)
  assert.equal(slash.state.trail.some((segment) => segment.predicted), false)
})

test('consistent reacquisition after the grace label becomes LOST reconnects safely', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  slash.detected({ x: 140, y: 100 }, 80, 1000)
  slash.missing(215) // 135 ms since the last point: LOST label, still inside prediction.
  assert.equal(slash.state.tracking, 'LOST')
  const result = slash.detected({ x: 180, y: 100 }, 220, 1000)
  assert.equal(result.bridged, true)
  assert.equal(result.segment.from.x, 140)
  assert.equal(result.segment.to.x, 180)
})

test('hybrid mode arms from a stable hand despite a noisy fingertip and predicts on immediate loss', () => {
  const slash = createSlashTracker()
  const hand = createHandMotionProcessor()
  hybridSample(slash, hand, 100, 140, 0)
  hybridSample(slash, hand, 120, 160, 33)
  const noisy = hybridSample(slash, hand, 140, 300, 66)
  assert.equal(noisy.motion.fingerSource, 'ESTIMATED')
  assert.equal(slash.state.slashArmed, true)
  assert.ok(slash.state.handSpeed >= 0.38)
  assert.ok(slash.state.handDirectionStability >= 0.86)
  hand.markMissing()
  const predicted = slash.missing(86)
  assert.equal(predicted.predicted, true)
  assert.ok(predicted.to.x > predicted.from.x)
  const targets = createTargetSystem()
  const target = targets.spawn(1000, 600, 86, { predictable: true })
  target.x = (predicted.from.x + predicted.to.x) / 2
  target.y = predicted.to.y
  target.radius = 8
  assert.equal(targets.hitWithSegment(predicted, 86).length, 0, 'prediction is visual only')
  assert.equal(slash.state.segments.some(segment => segment.predicted), false)
  assert.equal(slash.missing(66 + PREDICTION_MAX_MS + 1), null)
  assert.equal(slash.state.slashActive, false)
})

test('a held fingertip sample can be replaced by the stable palm estimate', () => {
  const slash = createSlashTracker()
  const hand = createHandMotionProcessor()
  const finger = createFingerProcessor()
  for (const [index, anchorX, rawFinger] of [
    [0, 100, { x: 140, y: 100 }],
    [1, 120, { x: 160, y: 100 }],
    [2, 140, { x: 180, y: 130 }],
  ]) {
    const now = index * 33
    const observed = hand.sample({ x: anchorX, y: 100 }, rawFinger, now, 1000)
    slash.observeMotion(observed.motion)
    let samples = finger.sample(observed.point, now, 1000)
    if (!samples.length && observed.motion.offsetFresh && observed.motion.reliableStreak >= 3) {
      samples = finger.sampleEstimated(estimateFingerFromHand(
        observed.motion.anchor, observed.motion.offset), now, 1000)
    }
    for (const sample of samples) slash.detected(sample.point, sample.at, 1000, observed.motion)
  }
  assert.equal(finger.state.rejected, 1)
  assert.equal(finger.state.pending, null)
  assert.equal(slash.state.slashArmed, true)
  assert.ok(slash.state.lastReliablePoint.y < 120)
})

test('hybrid loss horizon uses the latest reliable hand sample when fingertip was held', () => {
  const slash = createSlashTracker()
  const hand = createHandMotionProcessor()
  hybridSample(slash, hand, 100, 140, 0)
  hybridSample(slash, hand, 120, 160, 33)
  const third = hand.sample({ x: 140, y: 100 }, { x: 180, y: 130 }, 66, 1000)
  slash.observeMotion(third.motion) // Fingertip processor holds this frame.
  assert.equal(slash.state.slashArmed, true)
  assert.equal(slash.missing(200).predicted, true) // 134 ms since hand, 167 ms since tip.
  assert.equal(slash.missing(217), null)
  assert.equal(slash.state.slashActive, false)
})

test('slow hand with fast finger movement does not arm hybrid prediction', () => {
  const slash = createSlashTracker()
  const hand = createHandMotionProcessor()
  hybridSample(slash, hand, 100, 140, 0)
  hybridSample(slash, hand, 102, 160, 33)
  hybridSample(slash, hand, 104, 180, 66)
  assert.equal(slash.state.slashArmed, false)
  assert.equal(slash.missing(86), null)
})

test('hand direction stability drops after a reversal and disarms prediction', () => {
  const slash = createSlashTracker()
  const hand = createHandMotionProcessor()
  hybridSample(slash, hand, 100, 140, 0)
  hybridSample(slash, hand, 120, 160, 33)
  hybridSample(slash, hand, 140, 180, 66)
  assert.equal(slash.state.slashArmed, true)
  hybridSample(slash, hand, 120, 160, 99)
  assert.ok(hand.state.directionStability < 0)
  assert.equal(slash.state.slashArmed, false)
})

test('hybrid prediction rejects an inconsistent reacquired hand', () => {
  const slash = createSlashTracker()
  const hand = createHandMotionProcessor()
  hybridSample(slash, hand, 100, 140, 0)
  hybridSample(slash, hand, 120, 160, 33)
  hybridSample(slash, hand, 140, 180, 66)
  hand.markMissing()
  slash.missing(86)
  const reacquired = hand.sample({ x: 500, y: 100 }, { x: 540, y: 100 }, 120, 1000)
  slash.observeMotion(reacquired.motion)
  const result = slash.detected(reacquired.point, 120, 1000, reacquired.motion)
  assert.equal(result.segment, null)
  assert.equal(slash.state.slashActive, false)
  assert.equal(slash.state.lastSpeed, 0)
})

test('FINGER ONLY comparison uses fingertip motion and ignores the hand estimate', () => {
  const slash = createSlashTracker()
  const hand = createHandMotionProcessor()
  slash.setMotionSource('FINGER ONLY')
  for (const [index, x] of [100, 120, 140].entries()) {
    const observed = hand.sample({ x, y: 100 }, { x: 140, y: 100 }, index * 33, 1000)
    slash.observeMotion(observed.motion)
    slash.detected({ x: 140, y: 100 }, index * 33, 1000, observed.motion)
  }
  assert.equal(slash.state.slashArmed, false)
  assert.equal(slash.missing(86), null)

  slash.reset()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 33, 1000)
  slash.detected({ x: 140, y: 100 }, 66, 1000)
  assert.equal(slash.state.slashArmed, true)
  assert.equal(slash.missing(86).predicted, true)
})
