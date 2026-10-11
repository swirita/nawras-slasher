import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

let tracker = null
const epochNow = () => performance.timeOrigin + performance.now()
function gpuRenderer(canvas) {
  try {
    const gl = canvas.getContext?.('webgl2') ?? canvas.getContext?.('webgl')
    const debug = gl?.getExtension('WEBGL_debug_renderer_info')
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null
  } catch { return null }
}
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
      catch (error) {
        // Keep camera support on machines without a usable worker GPU context.
        options.baseOptions.delegate = 'CPU'
        options.canvas = new OffscreenCanvas(640, 480)
        tracker = await HandLandmarker.createFromOptions(vision, options)
      }
      self.postMessage({ type: 'ready', delegate: options.baseOptions.delegate,
        renderer: options.baseOptions.delegate === 'GPU' ? gpuRenderer(options.canvas) : null })
    } catch (error) { self.postMessage({ type: 'error', message: error.message }) }
    return
  }
  if (data.type !== 'frame') return
  const workerReceivedAt = epochNow()
  try {
    const start = performance.now()
    const result = tracker.detectForVideo(data.bitmap, data.at)
    self.postMessage({ type: 'result', id: data.id, result,
      detectMs: performance.now() - start, workerReceivedAt, workerPostedAt: epochNow() })
  } catch (error) { self.postMessage({ type: 'error', id: data.id, message: error.message }) }
  finally { data.bitmap.close() }
}
