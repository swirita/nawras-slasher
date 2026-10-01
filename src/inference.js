// One capture/inference at a time. Busy frames are skipped, never queued.
export function videoFrameId(video) {
  // currentTime interpolates between decoded frames in Chromium.
  return video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.currentTime
}

export function createInferenceDriver({ worker, capture = createImageBitmap,
  now = () => performance.now(), onResult, onError, maxResultAgeMs = 250 }) {
  const state = { busy: false, completed: 0, skipped: 0, discarded: 0,
    detectMs: 0, latencyMs: 0, maxPending: 0 }
  let generation = 0, sequence = 0, pending = null, closed = false
  worker.onmessage = ({ data }) => {
    if (data.type !== 'result' && data.type !== 'error') return
    if (!pending || pending.id !== data.id) return
    const request = pending
    pending = null; state.busy = false
    if (closed || request.generation !== generation) { state.discarded++; return }
    if (data.type === 'error') { onError(new Error(data.message)); return }
    state.detectMs = data.detectMs
    state.latencyMs = now() - request.at
    state.completed++
    if (state.latencyMs > maxResultAgeMs) { state.discarded++; return }
    onResult(data.result, request.at, data.detectMs, state.latencyMs)
  }
  worker.onerror = error => { if (!closed) { state.busy = false; pending = null; onError(error) } }

  function detectForVideo(video, at) {
    if (closed || state.busy) { state.skipped++; return false }
    state.busy = true; state.maxPending = 1
    const request = { id: ++sequence, at, generation }
    pending = request
    Promise.resolve().then(() => capture(video)).then(bitmap => {
      if (closed || request.generation !== generation) {
        bitmap.close(); pending = null; state.busy = false; return
      }
      try { worker.postMessage({ type: 'frame', id: request.id, at, bitmap }, [bitmap]) }
      catch (error) { bitmap.close(); throw error }
    }).catch(error => {
      pending = null; state.busy = false
      if (!closed && request.generation === generation) onError(error)
    })
    return true
  }
  function reset() { generation++ }
  function close() {
    closed = true; generation++; pending = null; state.busy = false
    worker.terminate(); worker.onmessage = null; worker.onerror = null
  }
  return { state, detectForVideo, reset, close }
}

export async function initializeInference({ wasmRoot, modelBuffer, onResult, onError }) {
  const worker = new Worker(new URL('./inference-worker.js', import.meta.url), { type: 'module' })
  try {
    await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') resolve()
        else if (data.type === 'error') reject(new Error(data.message))
      }
      worker.onerror = reject
      worker.postMessage({ type: 'init', wasmRoot, modelBuffer }, [modelBuffer.buffer])
    })
    return createInferenceDriver({ worker, onResult, onError })
  } catch (error) { worker.terminate(); throw error }
}
