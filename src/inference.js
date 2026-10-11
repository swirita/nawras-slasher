import { RESULT_MAX_AGE_MS } from './tracking-continuity.js'

// One capture/inference at a time. Busy frames are skipped, never queued.
export function createInferenceDriver({ worker, capture = createImageBitmap,
  now = () => performance.now(), timeOrigin = performance.timeOrigin, onResult, onError,
  onIdle = () => {}, onMeasurement = () => {}, delegate = 'UNKNOWN', renderer = null,
  maxResultAgeMs = RESULT_MAX_AGE_MS }) {
  const state = { busy: false, completed: 0, skipped: 0, discarded: 0,
    detectMs: 0, latencyMs: 0, maxPending: 0, staleDiscarded: 0,
    handReplies: 0, emptyReplies: 0, staleHandReplies: 0, lastReplyStale: false,
    delegate, renderer, captureMs: 0, capturedAt: null, resultAgeMs: 0,
    workerStartDelayMs: null, workerDeliveryMs: null, frameAgeAtCaptureMs: null }
  let generation = 0, sequence = 0, pending = null, closed = false
  function notifyIdle() {
    if (!closed) onIdle()
  }
  worker.onmessage = ({ data }) => {
    if (data.type !== 'result' && data.type !== 'error') return
    if (!pending || pending.id !== data.id) return
    const request = pending
    pending = null; state.busy = false
    if (closed || request.generation !== generation) { state.discarded++; notifyIdle(); return }
    if (data.type === 'error') { onError(new Error(data.message)); notifyIdle(); return }
    const receivedAt = now()
    state.detectMs = data.detectMs
    state.captureMs = request.captureMs
    state.capturedAt = request.at
    state.latencyMs = receivedAt - request.at
    state.resultAgeMs = state.latencyMs
    state.frameAgeAtCaptureMs = Number.isFinite(request.framePresentedAt)
      ? Math.max(0, request.at - request.framePresentedAt) : null
    // Worker and window performance.now() have different origins. Compare
    // epoch-relative timestamps, never subtract raw clocks across realms.
    state.workerStartDelayMs = Number.isFinite(data.workerReceivedAt) && Number.isFinite(request.sentAtEpoch)
      ? Math.max(0, data.workerReceivedAt - request.sentAtEpoch) : null
    state.workerDeliveryMs = Number.isFinite(data.workerPostedAt) && Number.isFinite(timeOrigin)
      ? Math.max(0, timeOrigin + receivedAt - data.workerPostedAt) : null
    state.completed++
    const hasHand = Boolean(data.result.landmarks?.length)
    state.lastReplyStale = state.latencyMs > maxResultAgeMs
    if (hasHand) state.handReplies++
    else state.emptyReplies++
    try {
      onMeasurement(receivedAt, { ...state, hasHand })
      if (state.lastReplyStale) {
        state.discarded++; state.staleDiscarded++
        if (hasHand) state.staleHandReplies++
        return
      }
      onResult(data.result, request.at, data.detectMs, state.latencyMs)
    } finally { notifyIdle() }
  }
  worker.onerror = error => { if (!closed) { state.busy = false; pending = null; onError(error); notifyIdle() } }

  function detectForVideo(video, at, { framePresentedAt } = {}) {
    if (closed || state.busy) { state.skipped++; return false }
    state.busy = true; state.maxPending = 1
    const request = { id: ++sequence, at, generation, framePresentedAt }
    pending = request
    const captureStartedAt = now()
    let bitmapPromise
    try { bitmapPromise = capture(video) }
    catch (error) { pending = null; state.busy = false; onError(error); notifyIdle(); return false }
    Promise.resolve(bitmapPromise).then(bitmap => {
      request.captureMs = now() - captureStartedAt
      if (closed || request.generation !== generation) {
        bitmap.close(); pending = null; state.busy = false; notifyIdle(); return
      }
      request.sentAtEpoch = Number.isFinite(timeOrigin) ? timeOrigin + now() : null
      try { worker.postMessage({ type: 'frame', id: request.id, at, bitmap }, [bitmap]) }
      catch (error) { bitmap.close(); throw error }
    }).catch(error => {
      pending = null; state.busy = false
      if (!closed && request.generation === generation) onError(error)
      notifyIdle()
    })
    return true
  }
  function reset() { generation++; state.lastReplyStale = false }
  function close() {
    closed = true; generation++; pending = null; state.busy = false
    worker.terminate(); worker.onmessage = null; worker.onerror = null
    notifyIdle()
  }
  return { state, detectForVideo, reset, close }
}

export async function initializeInference({ wasmRoot, modelBuffer, onResult, onError,
  onIdle, onMeasurement }) {
  const worker = new Worker(new URL('./inference-worker.js', import.meta.url), { type: 'module' })
  try {
    const ready = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') resolve(data)
        else if (data.type === 'error') reject(new Error(data.message))
      }
      worker.onerror = reject
      worker.postMessage({ type: 'init', wasmRoot, modelBuffer }, [modelBuffer.buffer])
    })
    return createInferenceDriver({ worker, onResult, onError, onIdle, onMeasurement,
      delegate: ready.delegate, renderer: ready.renderer })
  } catch (error) { worker.terminate(); throw error }
}
