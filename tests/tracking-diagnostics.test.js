import test from 'node:test'
import assert from 'node:assert/strict'
import { createTrackingDiagnostics } from '../src/tracking-diagnostics.js'

test('camera delivery counts compositor frames independently of inference and detects missed callbacks', () => {
  const d = createTrackingDiagnostics()
  d.camera(10, { frameDelta: 1, mediaTime: 0 })
  d.camera(110, { frameDelta: 3, mediaTime: .1, presentationDelayMs: 2 })
  const s = d.snapshot(200)
  assert.equal(s.cameraPresentedFps, 20)
  assert.equal(s.counts.cameraCallbacks, 2)
  assert.equal(s.counts.missedCallbacks, 2)
  assert.equal(s.counts.results, 0)
  assert.equal(s.timings.cameraMediaIntervalMs.mean, 100)
  assert.equal(s.timings.cameraCallbackIntervalMs.mean, 100)
})

test('timing windows separate inference, delivery, stale results and accepted positions with bounded storage', () => {
  const d = createTrackingDiagnostics()
  for (let i = 0; i < 300; i++) d.inference(i * 60, { detectMs: 47, captureMs: .4,
    workerStartDelayMs: 2, workerDeliveryMs: 10, resultAgeMs: 160, hasHand: true, lastReplyStale: true })
  d.position(100, 40); d.position(180, 100)
  const s = d.snapshot(18000)
  assert.equal(s.counts.results, 300)
  assert.equal(s.counts.staleResults, 300)
  assert.equal(s.counts.positions, 2)
  assert.equal(s.timings.inferenceMs.count, 240)
  assert.equal(s.timings.inferenceMs.mean, 47)
  assert.equal(s.timings.workerDeliveryMs.mean, 10)
  assert.equal(s.timings.acceptedPositionIntervalMs.mean, 80)
  assert.equal(s.timings.acceptedCaptureIntervalMs.mean, 60)
  d.resetWindow(18000)
  assert.equal(d.snapshot(19000).counts.results, 0)
})

