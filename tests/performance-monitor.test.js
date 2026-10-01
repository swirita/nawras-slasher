import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPerformanceMonitor, SLOW_FRAME_MS } from '../src/performance-monitor.js'
import { activeReadyAmbientCount } from '../src/ready-ambient.js'

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

test('READY particle count reflects display breakpoints and active state', () => {
  assert.equal(activeReadyAmbientCount(1440, true), 26)
  assert.equal(activeReadyAmbientCount(1024, true), 20)
  assert.equal(activeReadyAmbientCount(700, true), 14)
  assert.equal(activeReadyAmbientCount(1440, false), 0)
})

test('performance diagnostics remain inside the hidden developer panel', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const panel = html.match(/<aside id="debug-panel"[^>]*hidden>([\s\S]*?)<\/aside>/)?.[1]
  assert.ok(panel)
  for (const id of ['render-fps', 'frame-ms', 'work-ms', 'worst-frame-ms',
    'slow-frames', 'fps-value', 'detect-ms', 'gameplay-particles',
    'slice-fragments', 'slash-segments', 'ready-particles', 'active-targets']) {
    assert.match(panel, new RegExp(`id="${id}"`))
  }
})
