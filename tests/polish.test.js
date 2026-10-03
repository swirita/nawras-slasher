import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createAudioSystem, soundCueForEvent } from '../src/audio.js'
import { createGameSession } from '../src/game.js'
import { createLeaderboard, LEADERBOARD_STORAGE_KEY } from '../src/leaderboard.js'
import { createFullscreenController } from '../src/fullscreen.js'

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
function cursorFixture() {
  const callbacks = new Map(), classes = new Set()
  let time = 0, next = 0
  const fixture = {
    game: { state: { phase: 'READY' } }, mouseIdleTimer: null,
    app: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) } },
    setTimeout: (fn, ms) => { callbacks.set(++next, { fn, at: time + ms }); return next },
    clearTimeout: id => callbacks.delete(id),
  }
  const functions = ['clearMouseIdle', 'armMouseIdle'].map(name =>
    main.match(new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}\\n`))?.[0]).join('\n')
  runInNewContext(functions, fixture)
  return { fixture, callbacks,
    hidden: () => classes.has('cursor-idle'),
    playing: () => { fixture.game.state.phase = 'PLAYING'; fixture.armMouseIdle() },
    advance: ms => { time += ms; for (const [id, timer] of callbacks) if (time >= timer.at) { callbacks.delete(id); timer.fn() } },
  }
}

test('PLAYING cursor starts visible and hides exactly after 1700ms', () => {
  const f = cursorFixture(); f.playing()
  assert.equal(f.hidden(), false); assert.equal(f.callbacks.size, 1)
  f.advance(1699); assert.equal(f.hidden(), false)
  f.advance(1); assert.equal(f.hidden(), true); assert.equal(f.callbacks.size, 0)
})
test('mouse movement immediately reveals cursor and rearms one idle timer', () => {
  const f = cursorFixture(); f.playing(); f.advance(1700)
  f.fixture.armMouseIdle(); assert.equal(f.hidden(), false)
  for (let i = 0; i < 100; i++) f.fixture.armMouseIdle()
  assert.equal(f.callbacks.size, 1)
  f.advance(1699); assert.equal(f.hidden(), false)
  f.advance(1); assert.equal(f.hidden(), true)
})
test('leaving PLAYING cancels cursor timer and restores visible cursor in every UI phase', () => {
  for (const phase of ['READY', 'COUNTDOWN', 'FINISHED', 'INTERRUPTED']) {
    const f = cursorFixture(); f.playing(); f.advance(1700)
    f.fixture.game.state.phase = phase; f.fixture.clearMouseIdle()
    assert.equal(f.hidden(), false); assert.equal(f.callbacks.size, 0)
    f.fixture.armMouseIdle(); f.advance(2000)
    assert.equal(f.hidden(), false); assert.equal(f.callbacks.size, 0)
  }
  assert.match(main, /else \{ clearMouseIdle\(\); bugImpactAt = null \}/)
})
test('fullscreen entry and native exit leave the cursor deadline intact', () => {
  const f = cursorFixture(), document = new EventTarget()
  document.documentElement = { requestFullscreen() {} }
  const fullscreen = createFullscreenController({ document, hint: {}, getPhase: () => f.fixture.game.state.phase })
  f.playing(); f.advance(1000)
  document.fullscreenElement = document.documentElement; fullscreen.sync()
  f.advance(700); assert.equal(f.hidden(), true)
  f.fixture.armMouseIdle(); document.fullscreenElement = null; fullscreen.sync()
  assert.equal(f.hidden(), false); f.advance(1700); assert.equal(f.hidden(), true)
})
test('cursor work is absent from frame and only physical mouse pointer movement rearms it', () => {
  const frame = main.match(/function frame\(activeSession\) \{[\s\S]*?\n\}\n/)[0]
  assert.doesNotMatch(frame, /app\.style\.cursor|mouseIdle|armMouseIdle/)
  assert.match(main, /document\.addEventListener\('pointermove', \(event\) => \{[\s\S]*?event\.pointerType === 'mouse'[\s\S]*?armMouseIdle\(\)/)
})

const sequences = {
  'normal-slice': [[600,.05,'sine',.07,0,200],[660,.09,'triangle',.05,.04,880],[990,.14,'triangle',.045,.09,1100]],
  'golden-slice': [[600,.05,'sine',.07,0,200],[784,.08,'triangle',.05,.04,800],[988,.08,'triangle',.05,.09,1000],
    [1175,.08,'triangle',.05,.14,1200],[1568,.30,'triangle',.05,.19,1600],[2349,.35,'sine',.02,.19,2400],[2362,.35,'sine',.02,.19,2410]],
  'bug-hit': [[240,.05,'sawtooth',.04,0,200],[250,.05,'sawtooth',.04,.04,190],[230,.05,'sawtooth',.04,.08,170],
    [160,.07,'square',.05,.05,50],[392,.14,'triangle',.07,.14,360],[262,.30,'triangle',.07,.30,140]],
}
for (const [cue, expected] of Object.entries(sequences)) test(`${cue} plays only its specified tones and reuses one AudioContext`, async () => {
  let instances = 0
  const tones = [], nodes = []
  class Context {
    state = 'running'; currentTime = 0; destination = {}
    constructor() { instances++ }
    createGain() {
      const node = { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {},
        linearRampToValueAtTime: (amp) => { if (tones.length) tones.at(-1).amp = amp } },
        connect() {}, disconnect() { node.disconnected = true } }
      nodes.push(node); return node
    }
    createOscillator() {
      const tone = {}, node = { frequency: { setValueAtTime: (hz, at) => { tone.hz=hz; tone.at=at },
        exponentialRampToValueAtTime: (hz, at) => { tone.end=hz; tone.duration=at-tone.at } },
        set type(type) { tone.type=type }, connect() {}, start() {}, stop() {},
        disconnect() { node.disconnected = true } }
      tones.push(tone); nodes.push(node); return node
    }
    createBufferSource() { assert.fail('Hit sound should not additionally play noise/another cue') }
  }
  const audio = createAudioSystem({ AudioContextClass: Context })
  await audio.unlock(); await audio.unlock()
  assert.equal(audio.cue(cue, { combo: cue === 'normal-slice' ? 1 : 20 }), true)
  assert.equal(instances, 1); assert.equal(audio.state.cuesPlayed, 1)
  assert.equal(tones.length, expected.length)
  for (let i = 0; i < expected.length; i++) {
    const [hz,duration,type,amp,at,end] = expected[i], tone = tones[i]
    assert.deepEqual([tone.hz,tone.type,tone.amp,tone.at,tone.end],[hz,type,amp,at,end])
    assert.ok(Math.abs(tone.duration-duration)<1e-12)
  }
  for (const node of nodes) if (node.onended) node.onended()
  assert.ok(nodes.slice(1).every(node => node.disconnected))
  audio.setEnabled(false); assert.equal(audio.cue(cue), false)
  assert.equal(tones.length, expected.length)
})

test('each target emits exactly one intended hit cue, with no additional normal hit for Bug or Golden', () => {
  for (const [kind, catalogId, name] of [['normal','python','normal-slice'],['golden','golden','golden-slice'],['bug','bug','bug-hit']]) {
    const game = createGameSession(); game.startCountdown(0); game.update(3000); game.drainEvents()
    const target = { id: 1, kind, catalogId, x: 100, y: 100 }
    game.scoreTarget(target,3010); game.scoreTarget(target,3020)
    const hits = game.drainEvents().map(soundCueForEvent).filter(cue => cue && Object.hasOwn(sequences,cue.name))
    assert.deepEqual(hits.map(c => c.name),[name])
  }
})
test('leaderboard reload/reopen with the same storage retains two players and their best scores', () => {
  const values = new Map(), calls = []
  const storage = { getItem: key => values.get(key), setItem: (key,value) => { calls.push('write');values.set(key,value) },
    removeItem: () => assert.fail('Initialization must never clear leaderboard'), clear: () => assert.fail('Global storage clear') }
  const first = createLeaderboard({ storage, now:()=>1 })
  first.recordCompletedScore('Polish One',180)
  const saved = values.get(LEADERBOARD_STORAGE_KEY)
  const reload = createLeaderboard({storage}); assert.equal(values.get(LEADERBOARD_STORAGE_KEY),saved)
  assert.equal(calls.length,1)
  reload.recordCompletedScore('Polish Two',240)
  const reopen = createLeaderboard({storage}); reopen.recordCompletedScore('Polish One',100)
  assert.deepEqual(reopen.top().map(row=>[row.name,row.bestScore]),[['Polish Two',240],['Polish One',180],['Polish One',100]])
  assert.equal(calls.length,3)
  assert.doesNotMatch(main,/localStorage\.(clear|removeItem)/)
  assert.equal((main.match(/leaderboard\.clear\(\)/g) ?? []).length,1)
  assert.match(main,/onConfirm: \(\) => \{ leaderboard\.clear\(\); renderLeaderboard\(\) \}/)
})
test('HUD stops writing unchanged combo levels', () => {
  assert.match(main,/if \(comboIndicator\.dataset\.level !== level\) comboIndicator\.dataset\.level = level/)
})
