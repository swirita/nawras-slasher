import test from 'node:test'
import assert from 'node:assert/strict'
import { segmentIntersectsCircle, cameraPointToDisplay } from '../src/geometry.js'

test('segment through circle hits even when both endpoints are outside', () => {
  assert.equal(segmentIntersectsCircle(0, 50, 100, 50, 50, 50, 10), true)
})

test('segment that misses circle does not hit', () => {
  assert.equal(segmentIntersectsCircle(0, 0, 100, 0, 50, 50, 10), false)
})

test('tangent segment hits at the circle edge', () => {
  assert.equal(segmentIntersectsCircle(0, 40, 100, 40, 50, 50, 10), true)
})

test('segment endpoint inside circle hits', () => {
  assert.equal(segmentIntersectsCircle(0, 50, 45, 50, 50, 50, 10), true)
})

test('zero-length segment inside circle hits', () => {
  assert.equal(segmentIntersectsCircle(50, 50, 50, 50, 50, 50, 10), true)
})

test('zero-length segment outside circle does not hit', () => {
  assert.equal(segmentIntersectsCircle(80, 50, 80, 50, 50, 50, 10), false)
})

test('cover mapping accounts for vertical crop and mirror', () => {
  // A 4:3 source fills a 16:9 viewport: 180 source-scaled pixels crop top/bottom.
  assert.deepEqual(cameraPointToDisplay(0.25, 0.5, 640, 480, 1920, 1080), { x: 1440, y: 540 })
  assert.deepEqual(cameraPointToDisplay(0.5, 0, 640, 480, 1920, 1080), { x: 960, y: -180 })
})

test('cover mapping accounts for horizontal crop and mirror', () => {
  const point = cameraPointToDisplay(0.25, 0.5, 640, 480, 600, 1000)
  assert.ok(Math.abs(point.x - 633.3333333333334) < 0.001)
  assert.equal(point.y, 500)
})
