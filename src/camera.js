export const FINISHED_CAMERA_RELEASE_MS = 700

export function createCameraSession({ video, getUserMedia, onUnexpectedEnd = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now(), onFrame = () => {} }) {
  const state = { stream: null, active: false, pending: false, releaseScheduled: false,
    settings: {}, freshFrames: 0, freshFrameRate: 0, frameRateSource: 'UNAVAILABLE',
    frameId: null, lastFrameAt: null, decodedFrames: 0, decodedFrameRate: 0,
    callbackIntervalMs: null, mediaIntervalMs: null, missedCallbacks: 0,
    presentationDelayMs: null, sourceCaptureAgeMs: null }
  let generation = 0
  let pendingPromise = null
  let releaseTimer = null
  let endedListeners = []
  let frameCallback = null
  let frameWindowAt = null, windowFrames = 0, lastFrameCount = null
  let lastCallbackAt = null, lastMediaTime = null
  let lastDecodedCount = null, decodedWindowAt = null, decodedWindowFrames = 0

  function notifyFrame(id, at, metadata = {}) {
    if (id === state.frameId) return
    state.frameId = id
    state.callbackIntervalMs = lastCallbackAt === null ? null : at - lastCallbackAt
    state.mediaIntervalMs = lastMediaTime === null || !Number.isFinite(metadata.mediaTime)
      ? null : (metadata.mediaTime - lastMediaTime) * 1000
    lastCallbackAt = at
    lastMediaTime = Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : null
    state.lastFrameAt = Number.isFinite(metadata.presentationTime) ? metadata.presentationTime : at
    state.presentationDelayMs = Number.isFinite(metadata.presentationTime)
      ? Math.max(0, now() - metadata.presentationTime) : null
    state.sourceCaptureAgeMs = Number.isFinite(metadata.captureTime) ? Math.max(0, now() - metadata.captureTime) : null
    onFrame(at, { ...metadata, presentationDelayMs: state.presentationDelayMs,
      sourceCaptureAgeMs: state.sourceCaptureAgeMs })
  }

  function updateFrameRate(at) {
    if (frameWindowAt !== null && at - frameWindowAt >= 1000) {
      state.freshFrameRate = windowFrames * 1000 / (at - frameWindowAt)
      frameWindowAt = at
      windowFrames = 0
    }
  }

  function recordFrames(count, at, source) {
    if (!Number.isFinite(count)) return
    state.frameRateSource = source
    if (lastFrameCount === null || count < lastFrameCount) {
      lastFrameCount = count
      frameWindowAt = at
      windowFrames = 0
      return
    }
    const fresh = count - lastFrameCount
    lastFrameCount = count
    state.freshFrames += fresh
    windowFrames += fresh
    updateFrameRate(at)
  }

  function observeDecodedFrames(at = now()) {
    if (!state.active) return
    const quality = video.getVideoPlaybackQuality?.()
    if (quality && Number.isFinite(quality.totalVideoFrames)) {
      const count = quality.totalVideoFrames
      if (lastDecodedCount === null || count < lastDecodedCount) {
        lastDecodedCount = count; decodedWindowAt = at; decodedWindowFrames = 0
      }
      const delta = count - lastDecodedCount
      state.decodedFrames += delta; decodedWindowFrames += delta; lastDecodedCount = count
      if (at - decodedWindowAt >= 1000) {
        state.decodedFrameRate = decodedWindowFrames * 1000 / (at - decodedWindowAt)
        decodedWindowAt = at; decodedWindowFrames = 0
      }
    }
    if (video.requestVideoFrameCallback) { updateFrameRate(at); return }
    if (quality && Number.isFinite(quality.totalVideoFrames)) {
      const count = quality.totalVideoFrames
      const delta = lastFrameCount === null ? 1 : Math.max(0, count - lastFrameCount)
      recordFrames(count, at, 'DECODED_FRAMES')
      notifyFrame(count, at, { frameDelta: delta })
    }
    else {
      // currentTime may interpolate without a decoded image change. Quantize it
      // to the configured cadence; this remains an estimate, never sensor FPS.
      const count = Math.floor(video.currentTime * (state.settings.frameRate || 30))
      const delta = lastFrameCount === null ? 1 : Math.max(0, count - lastFrameCount)
      recordFrames(count, at, 'ESTIMATED_MEDIA_TIME')
      notifyFrame(count, at, { frameDelta: delta })
    }
  }

  function watchFrames(watchedGeneration = generation) {
    if (!video.requestVideoFrameCallback) return
    frameCallback = video.requestVideoFrameCallback((at, metadata) => {
      if (!state.active || watchedGeneration !== generation) return
      frameCallback = null
      const frameDelta = lastFrameCount === null ? 1 : Math.max(0, metadata.presentedFrames - lastFrameCount)
      state.missedCallbacks += Math.max(0, frameDelta - 1)
      recordFrames(metadata.presentedFrames, at, 'PRESENTED_FRAMES')
      watchFrames(watchedGeneration)
      // presentedFrames counts compositor submissions, not sensor exposures.
      // mediaTime identifies the presented image, avoiding decoded-counter races.
      const identity = Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : metadata.presentedFrames
      notifyFrame(identity, at, { ...metadata, frameDelta })
    })
  }

  function cancelScheduledRelease() {
    if (releaseTimer !== null) clearTimer(releaseTimer)
    releaseTimer = null
    state.releaseScheduled = false
  }

  function stopTracks(stream) {
    for (const track of stream?.getTracks() ?? []) track.stop()
  }

  function release() {
    generation += 1
    cancelScheduledRelease()
    for (const [track, listener] of endedListeners) track.removeEventListener('ended', listener)
    endedListeners = []
    const previous = state.stream
    state.stream = null
    state.active = false
    if (frameCallback !== null) video.cancelVideoFrameCallback?.(frameCallback)
    frameCallback = null
    state.settings = {}
    state.pending = false
    pendingPromise = null
    stopTracks(previous)
    video.pause?.()
    video.srcObject = null
    return Boolean(previous)
  }

  function scheduleRelease(callback, delayMs = FINISHED_CAMERA_RELEASE_MS) {
    if (!state.active || state.releaseScheduled) return false
    state.releaseScheduled = true
    releaseTimer = setTimer(() => {
      releaseTimer = null
      state.releaseScheduled = false
      callback()
    }, delayMs)
    return true
  }

  function acquire(constraints, waitForReady) {
    if (state.active) return Promise.resolve(true)
    if (pendingPromise) return pendingPromise
    const attempt = ++generation
    state.pending = true
    const task = (async () => {
      let acquired = null
      try {
        acquired = await getUserMedia(constraints)
        if (attempt !== generation) {
          stopTracks(acquired)
          return false
        }
        state.stream = acquired
        video.srcObject = acquired
        for (const track of acquired.getVideoTracks()) {
          const listener = () => {
            if (state.stream === acquired && (state.active || state.pending)) onUnexpectedEnd()
          }
          track.addEventListener('ended', listener)
          endedListeners.push([track, listener])
        }
        if (attempt !== generation) return false
        await waitForReady()
        if (attempt !== generation) return false
        state.active = true
        const settings = acquired.getVideoTracks()[0]?.getSettings?.() ?? {}
        state.settings = Object.fromEntries(['width', 'height', 'frameRate', 'facingMode', 'aspectRatio', 'resizeMode']
          .filter(key => settings[key] !== undefined).map(key => [key, settings[key]]))
        state.freshFrames = state.freshFrameRate = 0
        state.frameId = state.lastFrameAt = null
        state.decodedFrames = state.decodedFrameRate = state.missedCallbacks = 0
        state.frameRateSource = 'UNAVAILABLE'
        state.callbackIntervalMs = state.mediaIntervalMs = state.presentationDelayMs = state.sourceCaptureAgeMs = null
        lastCallbackAt = lastMediaTime = null
        lastDecodedCount = decodedWindowAt = null
        decodedWindowFrames = 0
        frameWindowAt = lastFrameCount = null
        windowFrames = 0
        watchFrames()
        return true
      } catch (error) {
        if (attempt === generation) release()
        else if (acquired && acquired !== state.stream) stopTracks(acquired)
        throw error
      } finally {
        if (attempt === generation) state.pending = false
        if (pendingPromise === task) pendingPromise = null
      }
    })()
    pendingPromise = task
    return task
  }

  return { state, acquire, release, scheduleRelease, cancelScheduledRelease, observeDecodedFrames }
}
