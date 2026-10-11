const LIMIT = 240

export function summarize(values) {
  if (!values.length) return { count: 0, mean: null, p50: null, p95: null, max: null }
  const ordered = [...values].sort((a, b) => a - b)
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: ordered[Math.floor((ordered.length - 1) * .5)],
    p95: ordered[Math.ceil((ordered.length - 1) * .95)], max: ordered.at(-1) }
}

// Small rolling samples for Copy diagnostics; never store video frames, bitmaps,
// landmarks or inference requests.
export function createTrackingDiagnostics() {
  const state = {}
  const series = {}
  const previous = {}
  let startedAt = null
  let counts
  function resetWindow(now) {
    startedAt = now
    for (const key of Object.keys(series)) delete series[key]
    for (const key of Object.keys(previous)) delete previous[key]
    counts = { cameraCallbacks: 0, presentedFrames: 0, missedCallbacks: 0,
      results: 0, handResults: 0, staleResults: 0, positions: 0, renders: 0, canvasDraws: 0 }
  }
  resetWindow(0)
  function add(name, value) {
    if (!Number.isFinite(value) || value < 0) return
    const samples = series[name] ??= []
    samples.push(value)
    if (samples.length > LIMIT) samples.shift()
  }
  function interval(name, at) {
    if (previous[name] !== undefined) add(name, at - previous[name])
    previous[name] = at
  }
  function camera(at, metadata) {
    counts.cameraCallbacks++
    counts.presentedFrames += metadata.frameDelta ?? 1
    counts.missedCallbacks += Math.max(0, (metadata.frameDelta ?? 1) - 1)
    interval('cameraCallbackIntervalMs', at)
    if (Number.isFinite(metadata.mediaTime)) interval('cameraMediaIntervalMs', metadata.mediaTime * 1000)
    add('presentationCallbackDelayMs', metadata.presentationDelayMs)
    add('sourceCaptureAgeMs', metadata.sourceCaptureAgeMs)
    add('videoProcessingMs', metadata.processingDuration * 1000)
  }
  function render(at) { counts.renders++; interval('renderIntervalMs', at) }
  function frameWork(ms) { add('frameWorkMs', ms) }
  function canvasDraw(at, workMs) {
    counts.canvasDraws++
    interval('canvasDrawIntervalMs', at)
    add('canvasDrawWorkMs', workMs)
  }
  function stability(before, after) {
    for (const key of ['acceptedUpdates', 'heldSamples', 'rejectedSamples', 'estimatedUpdates',
      'detectionLosses', 'reacquisitions', 'noHandResults', 'invalidResults',
      'displayOnlyResults', 'collisionsRejectedAge']) {
      counts[key] = (counts[key] ?? 0) + Math.max(0, (after[key] ?? 0) - (before[key] ?? 0))
    }
  }
  function inference(at, stats) {
    counts.results++
    if (stats.hasHand) counts.handResults++
    if (stats.lastReplyStale) counts.staleResults++
    interval('resultDeliveryIntervalMs', at)
    for (const [name, value] of Object.entries({ captureMs: stats.captureMs, inferenceMs: stats.detectMs,
      workerStartDelayMs: stats.workerStartDelayMs, workerDeliveryMs: stats.workerDeliveryMs,
      totalResultAgeMs: stats.resultAgeMs, frameAgeAtCaptureMs: stats.frameAgeAtCaptureMs })) add(name, value)
  }
  function position(receivedAt, capturedAt) {
    counts.positions++
    interval('acceptedPositionIntervalMs', receivedAt)
    interval('acceptedCaptureIntervalMs', capturedAt)
  }
  function snapshot(now) {
    const elapsedMs = Math.max(0, now - startedAt)
    return { activeDelegate: state.activeDelegate,
      renderer: state.renderer ?? null,
      cameraSettings: { ...state.cameraSettings }, frameRateSource: state.frameRateSource ?? 'UNAVAILABLE',
      startedAt, elapsedMs, counts: { ...counts },
      cameraPresentedFps: elapsedMs ? counts.presentedFrames * 1000 / elapsedMs : 0,
      inferenceFps: elapsedMs ? counts.results * 1000 / elapsedMs : 0,
      acceptedPositionFps: elapsedMs ? counts.positions * 1000 / elapsedMs : 0,
      animationCallbackFps: elapsedMs ? counts.renders * 1000 / elapsedMs : 0,
      canvasDrawFps: elapsedMs ? counts.canvasDraws * 1000 / elapsedMs : 0,
      timings: Object.fromEntries(Object.entries(series).map(([name, values]) => [name, summarize(values)])) }
  }
  return { state, resetWindow, camera, render, frameWork, canvasDraw, stability, inference, position, snapshot }
}
