export const SLOW_FRAME_MS = 25
const RECENT_FRAMES = 120

export function createPerformanceMonitor() {
  const intervals = new Float32Array(RECENT_FRAMES)
  const workTimes = new Float32Array(RECENT_FRAMES)
  let lastFrameAt = null
  let nextIndex = 0
  let count = 0
  let currentIndex = -1
  let slowFrames = 0

  function startFrame(now) {
    currentIndex = -1
    if (lastFrameAt !== null) {
      const delta = now - lastFrameAt
      // A suspended tab is not a gameplay frame spike.
      if (delta > 0 && delta < 1000) {
        currentIndex = nextIndex
        intervals[nextIndex] = delta
        workTimes[nextIndex] = 0
        nextIndex = (nextIndex + 1) % RECENT_FRAMES
        count = Math.min(count + 1, RECENT_FRAMES)
        if (delta > SLOW_FRAME_MS) slowFrames += 1
      } else {
        nextIndex = 0
        count = 0
      }
    }
    lastFrameAt = now
  }

  function finishFrame(workMs) {
    if (currentIndex >= 0) workTimes[currentIndex] = workMs
  }

  function snapshot() {
    let intervalTotal = 0
    let workTotal = 0
    let worstFrameMs = 0
    for (let index = 0; index < count; index += 1) {
      intervalTotal += intervals[index]
      workTotal += workTimes[index]
      worstFrameMs = Math.max(worstFrameMs, intervals[index])
    }
    const averageFrameMs = count ? intervalTotal / count : 0
    return {
      renderedFps: averageFrameMs ? 1000 / averageFrameMs : 0,
      averageFrameMs,
      averageWorkMs: count ? workTotal / count : 0,
      worstFrameMs,
      slowFrames,
      sampleCount: count,
    }
  }

  function reset() {
    lastFrameAt = null
    nextIndex = 0
    count = 0
    currentIndex = -1
    slowFrames = 0
  }

  return { startFrame, finishFrame, snapshot, reset }
}
