import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createFullscreenController, isEditableTarget } from '../src/fullscreen.js'
import { createDeveloperUi } from '../src/developer-ui.js'
import { createGameSession, COUNTDOWN_MS, GAME_DURATION_MS } from '../src/game.js'

function fixture() {
  const document = new EventTarget()
  document.fullscreenEnabled = true
  document.fullscreenElement = null
  let requests = 0
  document.documentElement = { requestFullscreen: () => { requests++; return Promise.resolve() } }
  const hint = { hidden: true }
  const warnings = []
  let phase = 'READY'
  const controller = createFullscreenController({ document, hint, getPhase: () => phase,
    warn: error => warnings.push(error) })
  return { document, hint, warnings, controller, requests: () => requests,
    setPhase: next => { phase = next; controller.sync() } }
}
const key = (overrides = {}) => ({ key: 'f', target: null, prevented: false,
  preventDefault() { this.prevented = true }, ...overrides })
const settled = () => new Promise(resolve => setImmediate(resolve))

for (const letter of ['f', 'F']) test(`plain ${letter} requests native document fullscreen`, async () => {
  const f = fixture(), event = key({ key: letter })
  assert.equal(f.controller.handleKeydown(event), true)
  assert.equal(f.requests(), 1)
  assert.equal(event.prevented, true)
  assert.equal(f.controller.state.active, false, 'a resolved request does not imply fullscreen')
  await settled()
  assert.equal(f.hint.hidden, false)
})

for (const tag of ['input', 'textarea', 'select', 'contenteditable child']) {
  test(`F in ${tag} is left to the editable element`, () => {
    const f = fixture()
    const target = tag === 'contenteditable child' ? { isContentEditable: true }
      : { closest: selector => selector === 'input, textarea, select' ? {} : null }
    assert.equal(isEditableTarget(target), true)
    const event = key({ target })
    assert.equal(f.controller.handleKeydown(event), false)
    assert.equal(event.prevented, false)
    assert.equal(f.requests(), 0)
  })
}
test('editable composed paths protect inputs inside shadow DOM', () => {
  const f = fixture()
  assert.equal(f.controller.handleKeydown(key({ composedPath: () => [{}, { isContentEditable: true }] })), false)
  assert.equal(f.requests(), 0)
  assert.equal(isEditableTarget({ isContentEditable: false }), false)
})

for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true },
  { shiftKey: true }, { ctrlKey: true, shiftKey: true }, { metaKey: true, shiftKey: true }]) {
  test(`F with ${Object.keys(modifiers).join('+')} preserves the shortcut`, () => {
    const f = fixture(), event = key(modifiers)
    assert.equal(f.controller.handleKeydown(event), false)
    assert.equal(event.prevented, false)
    assert.equal(f.requests(), 0)
  })
}
test('Escape, other keys, repeats, and handled events are untouched', () => {
  const f = fixture()
  for (const event of [key({ key: 'Escape' }), key({ key: 'd' }), key({ repeat: true }),
    key({ defaultPrevented: true })]) {
    assert.equal(f.controller.handleKeydown(event), false)
    assert.equal(event.prevented, false)
  }
  assert.equal(f.requests(), 0)
})
test('pending requests and existing fullscreen prevent duplicate requests', async () => {
  const f = fixture()
  let resolve
  f.document.documentElement.requestFullscreen = () => new Promise(r => { resolve = r })
  assert.equal(f.controller.handleKeydown(key()), true)
  assert.equal(f.controller.handleKeydown(key()), false)
  resolve()
  await settled()
  f.document.fullscreenElement = f.document.documentElement
  f.document.dispatchEvent(new Event('fullscreenchange'))
  assert.equal(f.controller.state.active, true)
  assert.equal(f.controller.handleKeydown(key()), false)
})
test('fullscreen rejection is contained and permits another attempt', async () => {
  const f = fixture(), error = new Error('Permission denied')
  f.document.documentElement.requestFullscreen = () => Promise.reject(error)
  f.controller.handleKeydown(key())
  await settled()
  assert.deepEqual(f.warnings, [error])
  assert.equal(f.controller.state.pending, false)
  assert.equal(f.controller.state.active, false)
  assert.equal(f.hint.hidden, false)
  assert.equal(f.controller.handleKeydown(key()), true)
  await settled()
})
test('unsupported fullscreen and synchronous API failures do not break normal mode', async () => {
  const f = fixture()
  f.document.documentElement.requestFullscreen = undefined
  f.controller.sync()
  assert.equal(f.hint.hidden, true)
  assert.equal(f.controller.handleKeydown(key()), false)
  f.document.documentElement.requestFullscreen = () => { throw new Error('Unsupported') }
  f.controller.handleKeydown(key())
  await settled()
  assert.equal(f.warnings.length, 1)
})
test('hint follows actual fullscreen changes and READY, never round results', () => {
  const f = fixture()
  assert.equal(f.hint.hidden, false)
  f.document.fullscreenElement = f.document.documentElement
  f.document.dispatchEvent(new Event('fullscreenchange'))
  assert.equal(f.hint.hidden, true)
  f.document.fullscreenElement = null
  f.document.dispatchEvent(new Event('fullscreenchange'))
  assert.equal(f.hint.hidden, false)
  for (const phase of ['COUNTDOWN', 'PLAYING', 'FINISHED', 'INTERRUPTED']) {
    f.setPhase(phase)
    assert.equal(f.hint.hidden, true)
  }
  f.setPhase('READY')
  assert.equal(f.hint.hidden, false)
})
test('fullscreen remains browser owned across resets, finished rounds, and new players', () => {
  const f = fixture()
  f.document.fullscreenElement = f.document.documentElement
  for (const phase of ['READY', 'COUNTDOWN', 'PLAYING', 'FINISHED', 'READY', 'PLAYING', 'INTERRUPTED']) {
    f.setPhase(phase)
    assert.equal(f.controller.state.active, true)
    assert.equal(f.document.fullscreenElement, f.document.documentElement)
  }
})
test('fullscreen changes leave a running round untouched and its timer continues', () => {
  const f = fixture(), game = createGameSession()
  game.startCountdown(0)
  game.update(COUNTDOWN_MS)
  game.scoreTarget({ id: 1, kind: 'normal', catalogId: 'python', x: 100, y: 200 }, COUNTDOWN_MS + 10)
  assert.equal(game.state.score, 10)
  const before = structuredClone(game.state)
  f.setPhase('PLAYING')
  for (const element of [f.document.documentElement, null]) {
    f.document.fullscreenElement = element
    f.document.dispatchEvent(new Event('fullscreenchange'))
    assert.deepEqual(game.state, before)
  }
  game.update(COUNTDOWN_MS + 1000)
  assert.equal(game.state.remainingMs, GAME_DURATION_MS - 1000)
  assert.equal(game.state.score, before.score)
})
test('Ctrl+Shift+D still toggles the developer panel', () => {
  const f = fixture(), panel = { hidden: false }, developer = createDeveloperUi(panel)
  const event = key({ key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true })
  assert.equal(f.controller.handleKeydown(event), false)
  assert.equal(developer.handleKeydown(event), true)
  assert.equal(panel.hidden, false)
})
test('cursor hiding requires PLAYING and its single inactivity class', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(css, /\.app\[data-phase="PLAYING"\]\.cursor-idle, \.app\[data-phase="PLAYING"\]\.cursor-idle \* \{ cursor: none !important; \}/)
  assert.doesNotMatch(css, /\.app\[data-phase="PLAYING"\], \.app\[data-phase="PLAYING"\] \*/)
  assert.match(main, /if \(game\.state\.phase === 'PLAYING'\) armMouseIdle\(\)/)
  assert.match(main, /app\.dataset\.phase = game\.state\.phase/)
  const resize = main.match(/function resizeCanvas\(\) \{([\s\S]*?)\n\}\n/)?.[1]
  assert.match(resize, /canvas\.width = Math\.round\(width \* pixelRatio\)/)
  assert.match(resize, /canvas\.height = Math\.round\(height \* pixelRatio\)/)
  assert.doesNotMatch(resize, /targets\.clearTargets|game\.(reset|abort)|camera\.release/)
})
test('the actual resize handler updates backing pixels without discarding live targets', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const resize = main.match(/function resizeCanvas\(\) \{[\s\S]*?\n\}\n/)?.[0]
  assert.ok(resize)
  const liveTarget = { id: 7, x: 200, y: 300, vx: 15, vy: -250 }
  const transforms = [], resets = []
  const fixture = {
    canvas: { clientWidth: 1024, clientHeight: 700 },
    window: { devicePixelRatio: 2 },
    context: { setTransform: (...args) => transforms.push(args) },
    displayWidth: 1440, displayHeight: 900, displayPixelRatio: 1,
    handLandmarker: { reset: () => resets.push('inference') },
    continuity: { reset: () => resets.push('continuity') }, lastVideoTime: 5,
    finger: { reset: () => resets.push('finger') },
    hand: { reset: () => resets.push('hand') },
    slash: { reset: () => resets.push('slash') },
    targets: { state: { targets: [liveTarget] }, clearTargets: () => assert.fail('Live target cleared') },
    rawTrail: [1], anchorTrail: [1], rawFingerSpeed: 1, fingerDetected: true,
    performance: { now: () => 100 }, drawScene: () => {},
  }
  runInNewContext(`${resize}\nresizeCanvas()`, fixture)
  assert.equal(fixture.canvas.width, 2048)
  assert.equal(fixture.canvas.height, 1400)
  assert.deepEqual(transforms, [[2, 0, 0, 2, 0, 0]])
  assert.deepEqual(resets, ['inference', 'continuity', 'finger', 'hand', 'slash'])
  assert.equal(fixture.lastVideoTime, -1)
  assert.equal(fixture.displayWidth, 1024)
  assert.equal(fixture.displayHeight, 700)
  assert.equal(fixture.targets.state.targets[0], liveTarget)
  assert.deepEqual(liveTarget, { id: 7, x: 200, y: 300, vx: 15, vy: -250 })
})
