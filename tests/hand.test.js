import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createHandMotionProcessor, estimateFingerFromHand,
  handAnchorFromLandmarks, HAND_ANCHOR_INDICES,
} from '../src/hand.js'

test('palm anchor is the weighted wrist and four MCP joints, never a fingertip', () => {
  assert.deepEqual(HAND_ANCHOR_INDICES, [0, 5, 9, 13, 17])
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0, y: 0.5 }))
  for (const [index, x] of [[5, 0.1], [9, 0.2], [13, 0.3], [17, 0.4]]) landmarks[index].x = x
  landmarks[8].x = 100
  const anchor = handAnchorFromLandmarks(landmarks)
  assert.ok(Math.abs(anchor.x - 0.22) < 1e-10)
  assert.ok(Math.abs(anchor.y - 0.5) < 1e-10)
  landmarks[9].x = NaN
  assert.equal(handAnchorFromLandmarks(landmarks), null)
})

test('stable finger offset is fingertip minus hand anchor and supports an estimate', () => {
  const hand = createHandMotionProcessor()
  hand.sample({ x: 100, y: 100 }, { x: 140, y: 80 }, 0, 1000)
  hand.sample({ x: 101, y: 100 }, { x: 141, y: 80 }, 33, 1000)
  assert.ok(Math.abs(hand.state.smoothedFingerOffset.x - 40) < 1)
  assert.ok(Math.abs(hand.state.smoothedFingerOffset.y + 20) < 1)
  assert.deepEqual(estimateFingerFromHand({ x: 150, y: 100 }, { x: 40, y: -20 }),
    { x: 190, y: 80 })
})

test('fast stable hand motion replaces a wild fingertip sample with anchor plus offset', () => {
  const hand = createHandMotionProcessor()
  hand.sample({ x: 100, y: 100 }, { x: 140, y: 100 }, 0, 1000)
  hand.sample({ x: 120, y: 100 }, { x: 160, y: 100 }, 33, 1000)
  const result = hand.sample({ x: 140, y: 100 }, { x: 300, y: 155 }, 66, 1000)
  assert.equal(result.motion.reliableStreak, 3)
  assert.ok(result.motion.speed > 0.38)
  assert.ok(result.motion.directionStability > 0.99)
  assert.equal(hand.state.fingerSource, 'ESTIMATED')
  assert.ok(result.point.x < 210)
  assert.ok(Math.abs(result.point.y - 100) < 2)
  assert.deepEqual(result.point, estimateFingerFromHand(
    hand.state.smoothedHandAnchor, hand.state.smoothedFingerOffset))
})

test('complete loss does not turn reacquisition displacement into hand speed', () => {
  const hand = createHandMotionProcessor()
  hand.sample({ x: 100, y: 100 }, { x: 140, y: 100 }, 0, 1000)
  hand.sample({ x: 120, y: 100 }, { x: 160, y: 100 }, 33, 1000)
  hand.markMissing()
  const result = hand.sample({ x: 600, y: 100 }, { x: 640, y: 100 }, 66, 1000)
  assert.equal(result.motion.speed, 0)
  assert.equal(result.motion.reliableStreak, 1)
  assert.equal(result.motion.velocity, null)
  assert.equal(result.point.x, 640)
})
