import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { bugImpactStrength } from '../src/presentation.js'
import { containedImageRect, sliceClipPolygon } from '../src/rendering.js'
import { createTargetSystem, HIT_EFFECT_MS, GOLDEN_HIT_EFFECT_MS,
  NORMAL_SLASH_HIT_RADIUS } from '../src/targets.js'

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const draw = main.match(/function drawTarget\(target, now\) \{[\s\S]*?\n\}\n/)[0]
function fixture(reducedMotion = false) {
  const calls = [], gradients = [], stack = []
  const image = { naturalWidth: 800, naturalHeight: 800 }, tint = {}
  const context = { globalAlpha: 1,
    save() { stack.push(this.globalAlpha) }, restore() { this.globalAlpha = stack.pop() },
    createRadialGradient(...args) {
      const gradient = { args, stops: [], addColorStop(...stop) { this.stops.push(stop) } }
      gradients.push(gradient); return gradient
    },
    beginPath() {}, arc(...args) { calls.push({ type: 'arc', args }) },
    fill() { calls.push({ type: 'fill', style: this.fillStyle, alpha: this.globalAlpha }) },
    stroke() { calls.push({ type: 'stroke', style: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha }) },
    drawImage(...args) { calls.push({ type: 'image', args, alpha: this.globalAlpha }) },
    translate() {}, rotate() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {},
  }
  const scope = { context, assets: { images: new Map([['bug', image], ['bug-impact', tint], ['python', image]]) },
    containedImageRect, sliceClipPolygon, bugImpactStrength, HIT_EFFECT_MS, GOLDEN_HIT_EFFECT_MS,
    reducedMotionQuery: { matches: reducedMotion }, Math }
  runInNewContext(draw, scope)
  return { calls, gradients, image, tint, draw: scope.drawTarget }
}
const liveBug = () => ({ kind: 'bug', catalogId: 'bug', radius: 50, visualScale: 1,
  x: 200, y: 150, rotation: 0, createdAt: 0, sliced: false, slicedAt: null })

test('live Bug aura is centered, behind unchanged artwork, and does not mutate its target', () => {
  const f = fixture(), bug = liveBug(), before = structuredClone(bug)
  f.draw(bug, 0)
  assert.deepEqual(bug, before)
  assert.equal(f.gradients.length, 1)
  assert.deepEqual(f.gradients[0].args, [200,150,7.5,200,150,59])
  const ring = f.calls.find(c => c.type === 'stroke')
  assert.match(ring.style, /rgba\(230, 35, 45,/)
  assert.equal(ring.width, 1.8)
  const images = f.calls.filter(c => c.type === 'image')
  assert.equal(images.length, 1)
  assert.equal(images[0].args[0], f.image)
  assert.equal(images[0].alpha, 1)
  assert.ok(f.calls.indexOf(ring) < f.calls.indexOf(images[0]))
})
test('Bug aura pulses every 1050ms with only ±4% radius variation', () => {
  const radii = []
  for (const now of [0,262.5,525,787.5,1050]) {
    const f = fixture(); f.draw(liveBug(), now); radii.push(f.gradients[0].args[5])
  }
  assert.ok(Math.abs(radii[0] - radii[4]) < 1e-9)
  assert.ok(Math.abs(radii[1] / radii[0] - 1.04) < 1e-9)
  assert.ok(Math.abs(radii[3] / radii[0] - .96) < 1e-9)
})
test('reduced motion keeps a stable live hazard ring', () => {
  const first = fixture(true), second = fixture(true)
  first.draw(liveBug(), 262.5); second.draw(liveBug(), 787.5)
  assert.deepEqual(first.gradients[0].args, second.gradients[0].args)
  assert.deepEqual(first.gradients[0].stops, second.gradients[0].stops)
})
test('Bug hit intensifies the hazard ring and clears its aura at 240ms', () => {
  const live = fixture(); live.draw(liveBug(), 0)
  const hit = fixture(), target = { ...liveBug(), sliced: true, slicedAt: 100 }
  hit.draw(target, 100)
  assert.ok(hit.calls.find(c => c.type === 'stroke').width > live.calls.find(c => c.type === 'stroke').width)
  assert.ok(hit.gradients[0].args[5] > live.gradients[0].args[5])
  assert.ok(hit.calls.some(c => c.type === 'image' && c.args[0] === hit.tint))
  const ended = fixture(); ended.draw(target, 340)
  assert.equal(ended.gradients.length, 0)
  assert.ok(!ended.calls.some(c => c.type === 'image' && c.args[0] === ended.tint))
})
test('non-Bug tech rendering gains no aura', () => {
  const f = fixture(); f.draw({ ...liveBug(), kind: 'normal', catalogId: 'python' }, 100)
  assert.equal(f.gradients.length, 0)
  assert.equal(f.calls.filter(c => c.type === 'stroke').length, 0)
})
test('rendering a Bug aura preserves the exact existing collision footprint', () => {
  const targets = createTargetSystem(), bug = targets.spawn(500,400,0,{catalogId:'bug',predictable:true})
  bug.x=250;bug.y=200
  const before = bug.radius
  fixture().draw(bug, 0)
  assert.equal(bug.radius, before)
  // Existing slash forgiveness stays intact; an aura never adds to it.
  const y = bug.y + bug.radius + NORMAL_SLASH_HIT_RADIUS + 1
  assert.deepEqual(targets.hitWithSegment({from:{x:150,y},to:{x:350,y},activeSlash:true},10), [])
  assert.equal(bug.sliced, false)
  assert.equal(targets.hitWithSegment({from:{x:150,y:200},to:{x:350,y:200},activeSlash:true},20).length, 1)
  targets.update(0,20+HIT_EFFECT_MS,500,400)
  assert.equal(targets.state.targets.length, 0)
})
