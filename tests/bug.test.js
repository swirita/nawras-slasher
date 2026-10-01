import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { BUG_TARGET, TECH_TARGETS, TECH_TARGET_BY_ID, ORDINARY_TARGETS,
  TARGET_BY_ID, REQUIRED_ASSETS, selectWeightedTarget } from '../src/catalog.js'
import { createGameSession, COUNTDOWN_MS } from '../src/game.js'
import { createTargetSystem, MAX_ACTIVE_TARGETS, HIT_EFFECT_MS } from '../src/targets.js'
import { WEB_TARGET_IDS, selectWebRushTech } from '../src/web-rush.js'
import { bugImpactStrength, BUG_IMPACT_MS, BUG_WASH_MS } from '../src/presentation.js'
import { soundCueForEvent, createAudioSystem } from '../src/audio.js'

const bug = id => ({ id, kind: 'bug', catalogId: 'bug', x: 250, y: 200 })
const tech = id => ({ id, kind: 'normal', catalogId: 'python', x: 100, y: 200 })
function playing() {
  const game = createGameSession()
  game.startCountdown(0)
  game.update(COUNTDOWN_MS)
  game.drainEvents()
  return game
}

test('Bug is a separate immutable penalty definition, not a scoring tech', () => {
  assert.deepEqual(BUG_TARGET, { id: 'bug', label: 'Bug', asset: 'assets/bug.png',
    type: 'penalty', penalty: 25, weight: 6, visualScale: 1 })
  assert.equal(Object.isFrozen(BUG_TARGET), true)
  assert.equal(TARGET_BY_ID.get('bug'), BUG_TARGET)
  assert.equal(TECH_TARGET_BY_ID.has('bug'), false)
  assert.equal(TECH_TARGETS.length, 9)
  assert.equal(ORDINARY_TARGETS.length, 10)
})
test('Bug uses the existing preload and Pages-safe public asset path', () => {
  assert.ok(existsSync(new URL('../public/assets/bug.png', import.meta.url)))
  assert.deepEqual(REQUIRED_ASSETS.find(t => t.id === 'bug'), { id: 'bug', asset: BUG_TARGET.asset })
  assert.equal(REQUIRED_ASSETS.filter(t => t.id === 'bug').length, 1)
  for (const base of ['/', '/nawras-slasher/']) {
    assert.equal(new URL(base + BUG_TARGET.asset, 'https://example.github.io').pathname,
      `${base}assets/bug.png`)
  }
})
test('ordinary weighted sampling gives Bug 6 of 106 weight units', () => {
  const counts = new Map()
  for (let i = 0; i < 106; i++) {
    const target = selectWeightedTarget(() => (i + 0.5) / 106)
    counts.set(target.id, (counts.get(target.id) ?? 0) + 1)
  }
  for (const target of ORDINARY_TARGETS) assert.equal(counts.get(target.id), target.weight)
  assert.equal(counts.get('bug'), 6)
  for (const id of ['python', 'javascript', 'html', 'css']) assert.ok(counts.get(id) > 6)
})
test('Bug can spawn automatically through the ordinary scheduler selection', () => {
  const targets = createTargetSystem(() => 0.99)
  const target = targets.spawn(500, 400, 0)
  assert.equal(target.catalogId, 'bug')
  assert.equal(target.kind, 'bug')
  assert.equal(target.basePoints, 0)
  assert.equal(target.visualScale, 1)
})
test('Bug shares the active cap and ordinary exclusion/repeat protection', () => {
  const targets = createTargetSystem(() => 0.99)
  assert.equal(targets.spawn(500, 400, 0).catalogId, 'bug')
  assert.equal(targets.spawn(500, 400, 1).catalogId, 'bug')
  assert.notEqual(targets.spawn(500, 400, 2).catalogId, 'bug')
  assert.notEqual(selectWeightedTarget(() => 0.99, ['bug']).id, 'bug')
  for (let i = 0; i < 10; i++) targets.spawn(500, 400, i + 3, { catalogId: 'bug' })
  assert.equal(targets.activeCount(), MAX_ACTIVE_TARGETS)
  assert.equal(targets.spawn(500, 400, 100, { catalogId: 'bug' }), null)
  assert.equal(selectWeightedTarget(() => 0, ORDINARY_TARGETS.map(t => t.id)), null)
})
test('WEB RUSH retains its existing web family and tech-only selection', () => {
  assert.deepEqual(WEB_TARGET_IDS, ['html', 'css', 'javascript', 'react'])
  assert.equal(WEB_TARGET_IDS.includes('bug'), false)
  for (let i = 0; i <= 100; i++) {
    assert.notEqual(selectWebRushTech(() => i / 100).id, 'bug')
  }
})
for (const [before, after] of [[180, 155], [100, 75], [25, 0], [10, 0], [0, 0]]) {
  test(`Bug score floor: ${before} → ${after}`, () => {
    const game = playing()
    game.state.score = before
    const event = game.scoreTarget(bug(1), 3010)
    assert.equal(game.state.score, after)
    assert.equal(event.type, 'bug-hit')
    assert.equal(event.points, -25, 'feedback always communicates the fixed penalty')
    assert.equal(event.deducted, before - after)
    assert.equal(game.state.score >= 0, true)
  })
}
for (const streak of [1, 5, 20]) test(`combo ${streak} never multiplies the Bug penalty`, () => {
  const game = playing()
  for (let i = 0; i < streak; i++) game.scoreTarget(tech(i), 3010 + i * 10)
  const before = game.state.score
  const result = game.scoreTarget(bug(100), 3400)
  assert.equal(result.points, -25)
  assert.equal(game.state.score, Math.max(0, before - 25))
  assert.equal(game.state.combo, 0)
  assert.equal(game.state.bestCombo, streak)
})
test('Bug resets streak/last-hit time, preserves Best Combo, and the next tech restarts at ×1', () => {
  const game = playing()
  for (let i = 0; i < 12; i++) game.scoreTarget(tech(i), 3010 + i * 10)
  game.drainEvents()
  const slicedBefore = game.state.targetsSliced
  game.scoreTarget(bug(100), 3200)
  assert.equal(game.state.combo, 0)
  assert.equal(game.state.lastHitAt, null)
  assert.equal(game.state.bestCombo, 12)
  assert.equal(game.state.targetsSliced, slicedBefore, 'hazards do not count as successful scoring slices')
  assert.deepEqual(game.drainEvents().map(e => e.type), ['bug-hit'])
  game.update(3300)
  assert.equal(game.state.combo, 0)
  const next = game.scoreTarget(tech(101), 3310)
  assert.equal(next.points, 10)
  assert.equal(next.combo, 1)
  assert.equal(next.scoreMultiplier, 1)
  assert.equal(game.scoreTarget(tech(102), 3320).combo, 2)
  assert.equal(game.state.bestCombo, 12)
})
test('one Bug collision slices it once and deducts only once', () => {
  const targets = createTargetSystem(), game = playing()
  game.state.score = 100
  const target = targets.spawn(500, 400, 3000, { predictable: true, catalogId: 'bug' })
  Object.assign(target, { x: 250, y: 200 })
  const segment = { from: { x: 150, y: 200 }, to: { x: 350, y: 200 }, activeSlash: true }
  const hits = targets.hitWithSegment(segment, 3010)
  assert.deepEqual(hits, [target])
  game.scoreTarget(hits[0], 3010)
  assert.equal(target.sliced, true)
  assert.deepEqual(targets.hitWithSegment(segment, 3020), [])
  assert.equal(game.scoreTarget(target, 3020), null)
  assert.equal(game.state.score, 75)
  targets.update(0, 3010 + HIT_EFFECT_MS, 500, 400)
  assert.equal(targets.state.targets.length, 0)
})
test('slow movement cannot hit or penalize Bug', () => {
  const targets = createTargetSystem(), game = playing()
  game.state.score = 100
  const target = targets.spawn(500, 400, 0, { predictable: true, catalogId: 'bug' })
  target.x = 250; target.y = 200
  assert.deepEqual(targets.hitWithSegment({ from: { x: 150, y: 200 }, to: { x: 350, y: 200 } }, 10), [])
  assert.equal(game.state.score, 100)
  assert.equal(target.sliced, false)
})
test('an off-screen missed Bug changes neither score nor combo and emits no feedback', () => {
  const targets = createTargetSystem(), game = playing()
  for (let i = 0; i < 5; i++) game.scoreTarget(tech(i), 3010 + i * 10)
  game.drainEvents()
  const before = { score: game.state.score, combo: game.state.combo, bestCombo: game.state.bestCombo }
  const target = targets.spawn(500, 400, 3050, { catalogId: 'bug' })
  target.y = 400 + target.radius + 10; target.vy = 100
  targets.update(0.05, 3100, 500, 400)
  game.update(3100)
  assert.equal(targets.state.targets.length, 0)
  assert.equal(targets.state.hits, 0)
  assert.deepEqual({ score: game.state.score, combo: game.state.combo, bestCombo: game.state.bestCombo }, before)
  assert.deepEqual(game.drainEvents(), [])
})
test('Bug cannot penalize outside PLAYING', () => {
  const game = createGameSession()
  for (const phase of ['READY', 'COUNTDOWN', 'FINISHED', 'INTERRUPTED']) {
    game.state.phase = phase
    game.state.score = 100
    assert.equal(game.scoreTarget(bug(1), 0), null)
    assert.equal(game.state.score, 100)
    assert.deepEqual(game.drainEvents(), [])
  }
})
test('Bug impact fades rapidly with no central warning and keeps floating negative points', () => {
  assert.equal(BUG_IMPACT_MS, 240)
  assert.equal(BUG_WASH_MS, 140)
  assert.equal(bugImpactStrength(100, 100), 1)
  assert.equal(bugImpactStrength(220, 100), 0.25)
  assert.equal(bugImpactStrength(340, 100), 0)
  assert.equal(bugImpactStrength(240, 100, BUG_WASH_MS), 0)
  assert.equal(bugImpactStrength(100, null), 0)
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
  assert.doesNotMatch(html + css + main, /OOPS! YOU HIT A BUG|bug-feedback|bugFeedback/)
  assert.match(main, /bugImpactAt = now/)
  assert.match(main, /!reducedMotionQuery\.matches && game\.state\.phase === 'PLAYING'/)
  assert.match(main, /feedback\.kind === 'bug' \? `−\$\{Math\.abs\(feedback\.points\)\}`/)
  assert.match(main, /game\.state\.combo === 0/)
})
test('Debug selector and diagnostic lookup include the separate Bug definition', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(main, /for \(const target of ORDINARY_TARGETS\)[\s\S]*?option\.value = target\.id/)
  assert.match(main, /TARGET_BY_ID\.get\(targets\.state\.lastHit\.catalogId\)/)
  assert.equal(ORDINARY_TARGETS.find(t => t.id === 'bug').label, 'Bug')
})
test('Bug sound uses a quiet short descending synthesized cue and respects Sound Off', async () => {
  const tones = []
  class Context {
    state = 'running'; currentTime = 0; destination = {}
    createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {} }, connect() {} } }
    createOscillator() {
      const tone = {}
      tones.push(tone)
      return { frequency: { setValueAtTime: f => tone.start = f,
        exponentialRampToValueAtTime: f => tone.end = f }, connect() {}, start() {}, stop() {} }
    }
  }
  assert.deepEqual(soundCueForEvent({ type: 'bug-hit' }), { name: 'bug-hit' })
  assert.equal(soundCueForEvent({ type: 'target-sliced', kind: 'normal' }).name, 'normal-slice')
  assert.equal(soundCueForEvent({ type: 'target-sliced', kind: 'golden' }).name, 'golden-slice')
  const audio = createAudioSystem({ AudioContextClass: Context })
  assert.equal(audio.cue('bug-hit'), false)
  await audio.unlock()
  assert.equal(audio.cue('bug-hit'), true)
  assert.deepEqual(tones, [{ start: 240, end: 200 }, { start: 250, end: 190 },
    { start: 230, end: 170 }, { start: 160, end: 50 }, { start: 392, end: 360 }, { start: 262, end: 140 }])
  audio.setEnabled(false)
  assert.equal(audio.cue('bug-hit'), false)
  assert.equal(tones.length, 6)
})
