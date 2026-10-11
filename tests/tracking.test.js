import test from 'node:test'
import assert from 'node:assert/strict'
import { createFingerProcessor } from '../src/tracking.js'

test('adaptive smoothing reduces slow jitter and follows fast motion more closely', () => {
  const slow = createFingerProcessor()
  slow.sample({ x: 100, y: 100 }, 0, 1000)
  slow.sample({ x: 104, y: 100 }, 33, 1000)
  assert.ok(slow.state.smooth.x < 104)

  const fast = createFingerProcessor()
  fast.sample({ x: 100, y: 100 }, 0, 1000)
  fast.sample({ x: 128, y: 100 }, 33, 1000)
  assert.ok(fast.state.smooth.x > 120)
})

test('isolated sideways spike is rejected but sustained turn is accepted', () => {
  const processor = createFingerProcessor()
  processor.sample({ x: 100, y: 100 }, 0, 1000)
  processor.sample({ x: 130, y: 100 }, 33, 1000)
  assert.equal(processor.sample({ x: 150, y: 150 }, 66, 1000).length, 0)
  processor.sample({ x: 160, y: 100 }, 99, 1000)
  assert.equal(processor.state.rejected, 1)
  assert.equal(processor.state.raw.y, 100)

  processor.reset()
  processor.sample({ x: 100, y: 100 }, 0, 1000)
  processor.sample({ x: 130, y: 100 }, 33, 1000)
  assert.equal(processor.sample({ x: 130, y: 140 }, 66, 1000).length, 0)
  assert.equal(processor.sample({ x: 132, y: 165 }, 99, 1000).length, 2)
  assert.equal(processor.state.raw.y, 165)
})

test('fast gameplay path fits straight horizontal, vertical, and diagonal swipes', () => {
  for (const [dx, dy] of [[28, 0], [0, 28], [20, 20]]) {
    const processor = createFingerProcessor()
    for (let index = 0; index < 5; index += 1) {
      const perpendicular = index % 2 ? 5 : -5
      const x = 100 + dx * index + (dy ? perpendicular : 0)
      const y = 100 + dy * index + (dx && dy ? -perpendicular : dx ? perpendicular : 0)
      processor.sample({ x, y }, index * 33, 1000)
    }
    const actual = processor.state.path
    assert.ok(actual, `path exists for ${dx}, ${dy}`)
    const offset = dx && !dy ? actual.y - 100
      : dy && !dx ? actual.x - 100
        : actual.y - actual.x
    assert.ok(Math.abs(offset) < 5, `perpendicular wobble reduced for ${dx}, ${dy}: ${offset}`)
  }
})

test('fast moving turns resolve after one frame even beyond the old proximity limit', () => {
  const p = createFingerProcessor()
  const points = [[100,100], [140,100], [140,160], [140,220], [140,280], [200,280], [260,280], [320,280]]
  let consecutiveHolds = 0
  points.forEach(([x,y], i) => {
    const samples = p.sample({x,y}, i*33, 1000)
    consecutiveHolds = samples.length ? 0 : consecutiveHolds+1
    assert.ok(consecutiveHolds <= 1, 'valid turns cannot repeatedly freeze the cursor')
    if (i === 3) assert.equal(samples.length, 2, 'a moving 60px confirmation is accepted')
  })
  assert.equal(p.state.raw.x, 320)
  assert.equal(p.state.rejected, 0)
  assert.equal(p.state.accepted, points.length)
})

test('isolated implausible glitches do not enter a continuous swipe path', () => {
  const p = createFingerProcessor()
  const accepted = []
  for (let i=0; i<20; i++) {
    const point = {x:100+i*30,y:i === 8 ? 650 : 100}
    accepted.push(...p.sample(point,i*33,1000))
  }
  assert.equal(p.state.held, 1)
  assert.equal(p.state.rejected, 1)
  assert.ok(accepted.every(sample => sample.point.y === 100))
  assert.equal(p.state.raw.x, 670)
})

test('unconfirmed plausible turns reseed instead of starting an endless hold', () => {
  const p = createFingerProcessor()
  p.sample({x:100,y:100},0,1000)
  p.sample({x:140,y:100},33,1000)
  assert.equal(p.sample({x:140,y:160},66,1000).length,0)
  // Reverse the held direction, but stay off the old trajectory.
  const samples = p.sample({x:180,y:145},99,1000)
  assert.equal(samples.length,1)
  assert.equal(samples[0].reseed,true)
  assert.equal(p.state.pending,null)
  assert.equal(p.state.rejected,1)
})

test('expired held samples cannot be confirmed as old collision geometry', () => {
  const p=createFingerProcessor()
  p.sample({x:100,y:100},0,1000)
  p.sample({x:140,y:100},33,1000)
  p.sample({x:140,y:160},66,1000)
  const samples=p.sample({x:140,y:220},140,1000)
  assert.ok(samples.every(sample=>sample.at===140))
  assert.equal(p.state.rejected,1)
})
