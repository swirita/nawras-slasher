import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPerformanceMonitor, SLOW_FRAME_MS } from '../src/performance-monitor.js'

test('performance monitor measures recent rendered intervals and accumulated slow frames', () => {
  const monitor = createPerformanceMonitor()
  monitor.startFrame(0)
  monitor.finishFrame(3)
  monitor.startFrame(16)
  monitor.finishFrame(4)
  monitor.startFrame(48)
  monitor.finishFrame(12)
  const stats = monitor.snapshot()
  assert.equal(SLOW_FRAME_MS, 25)
  assert.equal(stats.sampleCount, 2)
  assert.equal(stats.averageFrameMs, 24)
  assert.equal(stats.renderedFps, 1000 / 24)
  assert.equal(stats.averageWorkMs, 8)
  assert.equal(stats.worstFrameMs, 32)
  assert.equal(stats.slowFrames, 1)
})

test('performance monitor excludes suspended-tab gaps and resets between sessions', () => {
  const monitor = createPerformanceMonitor()
  monitor.startFrame(0)
  monitor.startFrame(16)
  monitor.finishFrame(5)
  monitor.startFrame(2016)
  assert.equal(monitor.snapshot().sampleCount, 0)
  monitor.startFrame(2032)
  monitor.finishFrame(6)
  assert.equal(monitor.snapshot().averageWorkMs, 6)
  monitor.reset()
  assert.deepEqual(monitor.snapshot(), {
    renderedFps: 0, averageFrameMs: 0, averageWorkMs: 0,
    worstFrameMs: 0, slowFrames: 0, sampleCount: 0,
  })
})

test('performance monitor keeps a fixed recent window without accumulating frame samples', () => {
  const monitor = createPerformanceMonitor()
  for (let frame = 0; frame < 300; frame += 1) {
    monitor.startFrame(frame * 16)
    monitor.finishFrame(2)
  }
  const stats = monitor.snapshot()
  assert.equal(stats.sampleCount, 120)
  assert.equal(stats.averageFrameMs, 16)
  assert.equal(stats.slowFrames, 0)
})

test('performance diagnostics remain inside the hidden developer panel', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const panel = html.match(/<aside id="debug-panel"[^>]*hidden>([\s\S]*?)<\/aside>/)?.[1]
  assert.ok(panel)
  for (const id of ['render-fps', 'fps-value', 'detect-ms',
    'tracking-reason', 'result-age', 'active-delegate', 'copy-tracking-diagnostics']) {
    assert.match(panel, new RegExp(`id="${id}"`))
  }
  assert.doesNotMatch(panel, /id="(?:canvas-draw-fps|good-hand-age)"/)
  assert.doesNotMatch(panel, /id="(?:compare-tracking|compare-rendering|diagnostic-gpu|diagnostic-cpu|render-preview-legacy)"/)
})
