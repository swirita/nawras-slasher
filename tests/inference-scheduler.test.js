import test from 'node:test'
import assert from 'node:assert/strict'
import { createLatestFrameScheduler } from '../src/inference-scheduler.js'
import { createInferenceDriver } from '../src/inference.js'

test('delivery and completion start only the newest frame, without waiting for rendering or queuing', async () => {
  let time = 0, frame = { id: 1, presentedAt: 0 }, enabled = true
  const requests = [], measurements = [], worker = { postMessage: data => requests.push(data), terminate() {} }
  let scheduler
  const driver = createInferenceDriver({ worker, now: () => time, timeOrigin: 1000,
    capture: () => ({ close() {} }), onResult() {}, onError: error => { throw error },
    onIdle: () => scheduler.pump(), onMeasurement: (at, stats) => measurements.push(stats) })
  scheduler = createLatestFrameScheduler({ video: {}, getDriver: () => driver, getFrame: () => frame,
    isEnabled: () => enabled, now: () => time })
  scheduler.pump(); await Promise.resolve()
  for (let i = 2; i <= 6; i++) { frame = { id: i, presentedAt: i * 30 }; scheduler.pump() }
  assert.equal(requests.length, 1)
  time = 170
  worker.onmessage({ data: { type: 'result', id: requests[0].id, result: { landmarks: [] },
    detectMs: 47, workerReceivedAt: 1002, workerPostedAt: 1049 } })
  await Promise.resolve()
  assert.equal(requests.length, 2, 'stale completion immediately starts the newest available image')
  assert.equal(scheduler.state.lastFrameId, 6)
  assert.equal(requests[1].at, 170)
  assert.equal(measurements[0].workerStartDelayMs, 2)
  assert.equal(measurements[0].workerDeliveryMs, 121)
  assert.equal(driver.state.staleDiscarded, 1)
  time = 200
  worker.onmessage({ data: { type: 'result', id: requests[1].id, result: { landmarks: [] }, detectMs: 20 } })
  await Promise.resolve()
  assert.equal(requests.length, 2, 'same frame is never processed twice')
  enabled = false; frame.id = 7; scheduler.pump()
  assert.equal(requests.length, 2, 'camera-only mode does not infer')
  assert.equal(driver.state.maxPending, 1)
})

test('bitmap capture begins synchronously and invalidated in-flight capture releases its bitmap', async () => {
  let captured = false, resolveCapture
  const worker = { postMessage() {}, terminate() {} }
  const d = createInferenceDriver({ worker, onResult() {}, onError() {},
    capture: () => { captured = true; return new Promise(resolve => { resolveCapture = resolve }) } })
  d.detectForVideo({}, 0)
  assert.equal(captured, true)
  d.reset()
  await Promise.resolve(); assert.equal(d.state.busy, true)
  let closed = false
  resolveCapture({ close: () => { closed = true } })
  for (let i=0; i<5; i++) await Promise.resolve()
  assert.equal(closed, true)
  assert.equal(d.state.busy, false)
})
