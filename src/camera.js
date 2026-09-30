export const FINISHED_CAMERA_RELEASE_MS = 700

export function createCameraSession({ video, getUserMedia, onUnexpectedEnd = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  const state = { stream: null, active: false, pending: false, releaseScheduled: false }
  let generation = 0
  let pendingPromise = null
  let releaseTimer = null
  let endedListeners = []

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

  return { state, acquire, release, scheduleRelease, cancelScheduledRelease }
}
