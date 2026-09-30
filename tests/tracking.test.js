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
