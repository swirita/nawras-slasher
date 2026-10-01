import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { comboPresentation } from '../src/presentation.js'
import { createGameSession, COUNTDOWN_MS } from '../src/game.js'

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')

function fixture() {
  const classes = new Set()
  let finish
  const indicator = { hidden: true, textContent: '', dataset: {}, offsetWidth: 1,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    addEventListener: (_, handler) => { finish = handler } }
  const game = createGameSession()
  game.startCountdown(0)
  game.update(COUNTDOWN_MS)
  const scope = vm.createContext({ document: { querySelector: () => indicator }, game,
    timerValue: {}, scoreValue: {}, timerStat: {}, app: {}, webRushButton: {},
    lastHudSecond: null, lastHudScore: null, NUMBER_FORMAT: new Intl.NumberFormat(),
    formatTime: () => '', comboPresentation, setClass() {},
    setText: (element, text) => { element.textContent = text } })
  vm.runInContext(main.slice(main.indexOf('const comboIndicator ='), main.indexOf('const timerStat ='))
    + main.slice(main.indexOf('function breakComboIndicator()'), main.indexOf('function clearMouseIdle()')), scope)
  let id = 0
  let at = COUNTDOWN_MS
  const hit = () => {
    game.scoreTarget({ id: ++id, kind: 'normal', catalogId: 'python' }, ++at)
    scope.updateHud()
  }
  const bug = () => {
    game.scoreTarget({ id: ++id, kind: 'bug', catalogId: 'bug' }, ++at)
    scope.breakComboIndicator()
    scope.updateHud()
  }
  return { game, indicator, classes, hit, bug, update: scope.updateHud,
    finish: (animationName = 'combo-break') => finish({ animationName }) }
}

test('Bug resets combo while retaining the active text for red fade, never Combo 0', () => {
  const f = fixture()
  for (let i = 0; i < 5; i++) f.hit()
  const previous = f.indicator.textContent
  const previousScore = f.game.state.score
  f.bug()
  assert.equal(f.game.state.combo, 0)
  assert.equal(f.game.state.score, previousScore - 25)
  assert.equal(f.indicator.textContent, previous)
  assert.equal(f.indicator.hidden, false)
  assert.ok(f.classes.has('breaking'))
  assert.ok(!f.classes.has('bump'))
  f.update()
  assert.equal(f.indicator.textContent, previous)
  f.finish()
  assert.equal(f.indicator.hidden, true)
  assert.ok(!f.classes.has('breaking'))
  f.update()
  assert.equal(f.indicator.hidden, true)
})

test('Bug without a displayed combo produces no break feedback, including repeated hits', () => {
  const f = fixture()
  f.update()
  f.bug()
  f.hit() // Combo 1 retains the existing hidden presentation.
  f.bug()
  f.bug()
  assert.equal(f.indicator.hidden, true)
  assert.equal(f.indicator.textContent, '')
  assert.ok(!f.classes.has('breaking'))
})

test('new streak cancels fade and an old animation completion cannot hide it', () => {
  const f = fixture()
  f.hit(); f.hit(); f.bug()
  f.hit()
  assert.ok(!f.classes.has('breaking'))
  assert.equal(f.indicator.hidden, true) // Existing Combo 1 behavior.
  f.hit()
  assert.equal(f.indicator.textContent, 'COMBO 2')
  assert.equal(f.indicator.hidden, false)
  assert.equal(f.indicator.dataset.level, '2')
  f.finish()
  assert.equal(f.indicator.hidden, false)
})

test('repeated Bug hits do not restart a break or display zero', () => {
  const f = fixture()
  f.hit(); f.hit(); f.bug(); f.bug()
  assert.equal(f.indicator.textContent, 'COMBO 2')
  assert.ok(f.classes.has('breaking'))
  f.finish('combo-bump')
  assert.equal(f.indicator.hidden, false)
  f.finish()
  assert.equal(f.indicator.hidden, true)
})

test('leaving gameplay cancels combo-break feedback', () => {
  const f = fixture()
  f.hit(); f.hit(); f.bug()
  f.game.state.phase = 'FINISHED'
  f.update()
  assert.equal(f.indicator.hidden, true)
  assert.ok(!f.classes.has('breaking'))
})

test('break styling overrides maximum-combo gold with an opacity-only animation', () => {
  assert.ok(css.indexOf('.combo-indicator.breaking') > css.indexOf('.combo-indicator[data-level="5"]'))
  assert.match(css, /\.combo-indicator\.breaking\s*\{[^}]*color: #e6232d;[^}]*animation: combo-break 480ms ease-out forwards;/)
  assert.match(css, /@keyframes combo-break\s*\{\s*0%, 25% \{ opacity: 1; \}\s*100% \{ opacity: 0; \}/)
  assert.match(main, /case 'bug-hit':[\s\S]*?breakComboIndicator\(\)\s+updateHud\(\)/)
})
