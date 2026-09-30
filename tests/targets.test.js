import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTargetSystem, collisionProfileForSegment, MAX_ACTIVE_TARGETS,
  NORMAL_SLASH_HIT_RADIUS, FAST_SLASH_HIT_RADIUS, PREDICTED_SLASH_HIT_RADIUS,
  GOLDEN_TARGET_CHANCE,
} from '../src/targets.js'
import { createSlashTracker } from '../src/slash.js'

test('slow movement cannot hit, and a sliced target cannot be hit twice', () => {
  const targets = createTargetSystem()
  const target = targets.spawn(500, 400, 0, { predictable: true })
  target.x = 250
  target.y = 200
  const segment = {
    from: { x: 200, y: 200 }, to: { x: 300, y: 200 },
    bridged: false, collisionMode: 'FAST', predicted: true,
  }

  assert.deepEqual(targets.hitWithSegment(segment, 10), [])
  assert.equal(target.sliced, false)
  assert.equal(targets.state.lastCollision, null)

  segment.activeSlash = true
  segment.predicted = false
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
  const near = { from: { x: 150, y: 200 + target.radius + NORMAL_SLASH_HIT_RADIUS - 1 },
    to: { x: 350, y: 200 + target.radius + NORMAL_SLASH_HIT_RADIUS - 1 }, activeSlash: true }
  assert.equal(targets.hitWithSegment(near, 10).length, 1)

  targets.reset()
  const farTarget = targets.spawn(500, 400, 0, { predictable: true })
  farTarget.x = 250
  farTarget.y = 200
  const far = { from: { x: 150, y: 200 + farTarget.radius + NORMAL_SLASH_HIT_RADIUS + 1 },
    to: { x: 350, y: 200 + farTarget.radius + NORMAL_SLASH_HIT_RADIUS + 1 }, activeSlash: true }
  assert.equal(targets.hitWithSegment(far, 10).length, 0)
})

test('normal, fast armed, and predicted segments use 24/40/50 invisible pixels', () => {
  assert.equal(NORMAL_SLASH_HIT_RADIUS, 24)
  assert.equal(FAST_SLASH_HIT_RADIUS, 40)
  assert.equal(PREDICTED_SLASH_HIT_RADIUS, 50)
  const lineAt = (y, options = {}) => ({
    from: { x: 150, y }, to: { x: 350, y }, activeSlash: true, ...options,
  })
  const targets = createTargetSystem()
  const target = targets.spawn(500, 400, 0, { predictable: true })
  target.x = 250
  target.y = 200

  const nearNormal = lineAt(200 + target.radius + NORMAL_SLASH_HIT_RADIUS)
  assert.deepEqual(collisionProfileForSegment(nearNormal), { mode: 'NORMAL', radius: 24 })
  assert.equal(targets.hitWithSegment(nearNormal, 10).length, 1)

  targets.reset()
  const fastTarget = targets.spawn(500, 400, 0, { predictable: true })
  fastTarget.x = 250
  fastTarget.y = 200
  const nearFast = lineAt(200 + fastTarget.radius + FAST_SLASH_HIT_RADIUS - 1)
  assert.equal(targets.hitWithSegment(nearFast, 10).length, 0)
  nearFast.collisionMode = 'FAST'
  assert.deepEqual(collisionProfileForSegment(nearFast), { mode: 'FAST', radius: 40 })
  assert.equal(targets.hitWithSegment(nearFast, 20).length, 1)
  assert.equal(targets.state.lastCollision.radius, 40)

  targets.reset()
  const predictedTarget = targets.spawn(500, 400, 0, { predictable: true })
  predictedTarget.x = 250
  predictedTarget.y = 200
  const nearPredicted = lineAt(200 + predictedTarget.radius + PREDICTED_SLASH_HIT_RADIUS - 1,
    { collisionMode: 'FAST' })
  assert.equal(targets.hitWithSegment(nearPredicted, 10).length, 0)
  nearPredicted.predicted = true
  assert.deepEqual(collisionProfileForSegment(nearPredicted), { mode: 'PREDICTED', radius: 50 })
  assert.equal(targets.hitWithSegment(nearPredicted, 20).length, 1)
  assert.equal(targets.state.lastCollision.mode, 'PREDICTED')
})

test('an armed slash segment is tagged FAST without changing its geometry', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  const { segment } = slash.detected({ x: 140, y: 100 }, 80, 1000)
  assert.equal(slash.state.slashArmed, true)
  assert.equal(segment.collisionMode, 'FAST')
  assert.deepEqual(segment.from, { x: 120, y: 100 })
  assert.deepEqual(segment.to, { x: 140, y: 100 })
})

test('target count respects both early difficulty and absolute limits', () => {
  const targets = createTargetSystem()
  assert.ok(targets.spawn(500, 400, 0, { activeLimit: 1 }))
  assert.equal(targets.spawn(500, 400, 1, { activeLimit: 1 }), null)
  for (let i = 0; i < MAX_ACTIVE_TARGETS + 2; i += 1) targets.spawn(500, 400, i + 2)
  assert.equal(targets.activeCount(), MAX_ACTIVE_TARGETS)
})

test('normal and golden targets share collision behavior; golden is a visual variant', () => {
  const targets = createTargetSystem(() => 0)
  const normal = targets.spawn(500, 400, 0, { predictable: true })
  const golden = targets.spawn(500, 400, 0, { kind: 'golden' })
  assert.equal(normal.kind, 'normal')
  assert.equal(golden.kind, 'golden')
  assert.equal(normal.radius, golden.radius)
  assert.equal(GOLDEN_TARGET_CHANCE, 0.1)
  golden.x = 250
  golden.y = 200
  normal.x = 100
  normal.y = 100
  const segment = { from: { x: 210, y: 200 }, to: { x: 290, y: 200 }, activeSlash: true }
  assert.deepEqual(targets.hitWithSegment(segment, 10), [golden])
  assert.deepEqual(targets.hitWithSegment(segment, 20), [])
  assert.equal(targets.state.hits, 1)
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
  assert.equal(prediction.collisionMode, 'PREDICTED')
  assert.equal(targets.hitWithSegment(prediction, 100).length, 1)
  assert.equal(targets.state.lastHit.segmentType, 'PREDICTED')
})
