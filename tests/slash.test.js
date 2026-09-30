import test from 'node:test'
import assert from 'node:assert/strict'
import { createSlashTracker, TRACKING_LOSS_GRACE_MS } from '../src/slash.js'

test('a deliberate swipe survives a short plausible detection gap', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  assert.equal(slash.state.slashActive, true)

  slash.missing(70)
  assert.equal(slash.state.tracking, 'GRACE')
  assert.equal(slash.state.slashActive, true)

  assert.equal(slash.detected({ x: 160, y: 100 }, 100, 1000), true)
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

  assert.equal(slash.detected({ x: 900, y: 100 }, 230, 1000), false)
  assert.equal(slash.state.lastSpeed, 0)
  assert.equal(slash.state.segments.length, 0)
})

test('an implausible jump is never bridged', () => {
  const slash = createSlashTracker()
  slash.detected({ x: 100, y: 100 }, 0, 1000)
  slash.detected({ x: 120, y: 100 }, 40, 1000)
  slash.missing(70)

  assert.equal(slash.detected({ x: 600, y: 100 }, 100, 1000), false)
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
