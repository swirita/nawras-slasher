import test from 'node:test'
import assert from 'node:assert/strict'
import { createTargetSystem, MAX_ACTIVE_TARGETS, SLASH_HIT_RADIUS } from '../src/targets.js'
import { createSlashTracker } from '../src/slash.js'

test('slow movement cannot hit, and a sliced target cannot be hit twice', () => {
  const targets = createTargetSystem()
  const target = targets.spawn(500, 400, 0, { predictable: true })
  target.x = 250
  target.y = 200
  const segment = { from: { x: 200, y: 200 }, to: { x: 300, y: 200 }, bridged: false }

  assert.deepEqual(targets.hitWithSegment(segment, 10), [])
  assert.equal(target.sliced, false)

  segment.activeSlash = true
  assert.equal(targets.hitWithSegment(segment, 20).length, 1)
  assert.equal(target.sliced, true)
  assert.equal(targets.state.hits, 1)
  assert.deepEqual(targets.hitWithSegment(segment, 30), [])
  assert.equal(targets.state.hits, 1)
})

test('a slash-system-approved bridged segment can hit', () => {
  const targets = createTargetSystem()
  const target = targets.spawn(500, 400, 0, { predictable: true })
  target.x = 140
  target.y = 100

  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  slash.missing(70)
  const { segment } = slash.detected({ x: 160, y: 100 }, 100, 1000)

  assert.equal(segment.bridged, true)
  assert.equal(targets.hitWithSegment(segment, 100).length, 1)
  assert.equal(targets.state.lastHit.segmentType, 'BRIDGED')
})

test('slash collision has a limited capsule thickness', () => {
  const targets = createTargetSystem()
  const target = targets.spawn(500, 400, 0, { predictable: true })
  target.x = 250
  target.y = 200
  const near = { from: { x: 150, y: 200 + target.radius + SLASH_HIT_RADIUS - 1 },
    to: { x: 350, y: 200 + target.radius + SLASH_HIT_RADIUS - 1 }, activeSlash: true }
  assert.equal(targets.hitWithSegment(near, 10).length, 1)

  targets.reset()
  const farTarget = targets.spawn(500, 400, 0, { predictable: true })
  farTarget.x = 250
  farTarget.y = 200
  const far = { from: { x: 150, y: 200 + farTarget.radius + SLASH_HIT_RADIUS + 1 },
    to: { x: 350, y: 200 + farTarget.radius + SLASH_HIT_RADIUS + 1 }, activeSlash: true }
  assert.equal(targets.hitWithSegment(far, 10).length, 0)
})

test('target count respects both early difficulty and absolute limits', () => {
  const targets = createTargetSystem()
  assert.ok(targets.spawn(500, 400, 0, { activeLimit: 1 }))
  assert.equal(targets.spawn(500, 400, 1, { activeLimit: 1 }), null)
  for (let i = 0; i < MAX_ACTIVE_TARGETS + 2; i += 1) targets.spawn(500, 400, i + 2)
  assert.equal(targets.activeCount(), MAX_ACTIVE_TARGETS)
})

test('a strictly approved predicted segment can hit a target', () => {
  const targets = createTargetSystem()
  const target = targets.spawn(500, 400, 0, { predictable: true })
  target.x = 148
  target.y = 100
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  slash.detected({ x: 140, y: 100 }, 80, 1000)
  const prediction = slash.missing(100)
  assert.equal(prediction.predicted, true)
  assert.equal(targets.hitWithSegment(prediction, 100).length, 1)
  assert.equal(targets.state.lastHit.segmentType, 'PREDICTED')
})
