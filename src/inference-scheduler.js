// One latest frame identity, not a frame queue. Both video delivery and worker
// completion call pump(); the driver's busy slot includes bitmap capture.
export function createLatestFrameScheduler({ video, getDriver, getFrame, isEnabled,
  now = () => performance.now() }) {
  const state = { lastFrameId: null, starts: 0, duplicateChecks: 0, busyChecks: 0 }
  function pump() {
    if (!isEnabled()) return false
    const driver = getDriver()
    if (!driver) return false
    if (driver.state.busy) { state.busyChecks++; return false }
    const frame = getFrame()
    if (frame.id === null || frame.id === undefined) return false
    if (frame.id === state.lastFrameId) { state.duplicateChecks++; return false }
    if (!driver.detectForVideo(video, now(), { framePresentedAt: frame.presentedAt })) return false
    state.lastFrameId = frame.id
    state.starts++
    return true
  }
  function reset() { state.lastFrameId = null }
  return { state, pump, reset }
}
