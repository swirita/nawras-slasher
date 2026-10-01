import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

let tracker = null
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const vision = await FilesetResolver.forVisionTasks(data.wasmRoot, true)
      const options = {
        baseOptions: { modelAssetBuffer: data.modelBuffer, delegate: 'GPU' },
        canvas: new OffscreenCanvas(640, 480),
        runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }
      try { tracker = await HandLandmarker.createFromOptions(vision, options) }
      catch {
        // Keep camera support on machines without a usable worker GPU context.
        options.baseOptions.delegate = 'CPU'
        options.canvas = new OffscreenCanvas(640, 480)
        tracker = await HandLandmarker.createFromOptions(vision, options)
      }
      self.postMessage({ type: 'ready' })
    } catch (error) { self.postMessage({ type: 'error', message: error.message }) }
    return
  }
  if (data.type !== 'frame') return
  try {
    const start = performance.now()
    const result = tracker.detectForVideo(data.bitmap, data.at)
    self.postMessage({ type: 'result', id: data.id, result,
      detectMs: performance.now() - start })
  } catch (error) { self.postMessage({ type: 'error', id: data.id, message: error.message }) }
  finally { data.bitmap.close() }
}
