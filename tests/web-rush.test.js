import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createGameSession, COUNTDOWN_MS, difficultyAt } from '../src/game.js'
import { createTargetSystem, MAX_ACTIVE_TARGETS, GOLDEN_TARGET_CHANCE } from '../src/targets.js'
import { TECH_TARGET_BY_ID } from '../src/catalog.js'
import { WEB_RUSH_CONFIG, WEB_TARGET_IDS, selectWebRushTech,
  spawnProfileFor, groupSizeForRoll } from '../src/web-rush.js'
import { createAudioSystem, soundCueForEvent } from '../src/audio.js'

function playingGame() {
  const game = createGameSession()
  game.startCountdown(0)
  game.update(COUNTDOWN_MS)
  game.drainEvents()
  return game
}

test('rush starts at 45 elapsed seconds once and ends after six seconds', () => {
  const game = playingGame()
  assert.equal(game.state.webRushActive, false)
  game.update(COUNTDOWN_MS + 44999)
  assert.equal(game.state.webRushActive, false)
  game.update(COUNTDOWN_MS + 45000)
  assert.equal(game.state.webRushActive, true)
  assert.equal(game.state.remainingMs, 45000)
  assert.equal(game.state.webRushStartedAt, COUNTDOWN_MS + 45000)
  assert.equal(game.state.webRushEndsAt, COUNTDOWN_MS + 51000)
  assert.deepEqual(game.drainEvents().map(({ type }) => type), ['web-rush-start'])
  game.update(COUNTDOWN_MS + 50999)
  assert.equal(game.state.webRushActive, true)
  game.update(COUNTDOWN_MS + 51000)
  assert.equal(game.state.webRushActive, false)
  assert.deepEqual(game.drainEvents().map(({ type }) => type), ['web-rush-end'])
  game.update(COUNTDOWN_MS + 60000)
  assert.equal(game.drainEvents().some(({ type }) => type === 'web-rush-start'), false)
})

test('manual trigger uses the same event, cannot stack, and prevents automatic retrigger', () => {
  const game = playingGame()
  assert.equal(game.triggerWebRush(COUNTDOWN_MS + 10000), true)
  assert.equal(game.triggerWebRush(COUNTDOWN_MS + 10001), false)
  assert.deepEqual(game.drainEvents().map(({ type }) => type), ['web-rush-start'])
  game.update(COUNTDOWN_MS + 16000)
  assert.equal(game.state.webRushActive, false)
  game.update(COUNTDOWN_MS + 45000)
  assert.deepEqual(game.drainEvents().map(({ type }) => type), ['web-rush-end'])
  assert.equal(game.triggerWebRush(COUNTDOWN_MS + 45000), false)
  game.reset()
  assert.equal(game.state.webRushTriggered, false)
  assert.equal(game.state.webRushActive, false)
  assert.equal(game.state.webRushStartedAt, null)
  assert.equal(game.state.webRushEndsAt, null)
  assert.equal(game.drainEvents().length, 0)
  game.startCountdown(COUNTDOWN_MS + 50000)
  game.update(COUNTDOWN_MS + 50000 + COUNTDOWN_MS)
  game.drainEvents()
  game.update(COUNTDOWN_MS + 50000 + COUNTDOWN_MS + 45000)
  assert.equal(game.state.webRushActive, true)
})

test('countdown, FINAL 15, FINISHED and abort leave no active rush', () => {
  const countdown = createGameSession()
  assert.equal(countdown.triggerWebRush(0), false)
  countdown.startCountdown(0)
  assert.equal(countdown.triggerWebRush(1000), false)
  const game = playingGame()
  game.update(COUNTDOWN_MS + 10000)
  assert.equal(game.triggerWebRush(COUNTDOWN_MS + 10000), true)
  game.drainEvents()
  game.update(COUNTDOWN_MS + 75000)
  assert.equal(game.state.webRushActive, false)
  assert.deepEqual(game.drainEvents().map(({ type }) => type), ['web-rush-end', 'final-15'])
  assert.equal(game.triggerWebRush(COUNTDOWN_MS + 75000), false)
  game.update(COUNTDOWN_MS + 90000)
  assert.equal(game.state.phase, 'FINISHED')
  assert.equal(game.state.webRushActive, false)
  const finishedDuringRush = playingGame()
  finishedDuringRush.triggerWebRush(COUNTDOWN_MS + 10000)
  finishedDuringRush.drainEvents()
  finishedDuringRush.update(COUNTDOWN_MS + 90000)
  assert.equal(finishedDuringRush.state.webRushActive, false)
  assert.equal(finishedDuringRush.state.phase, 'FINISHED')
  assert.deepEqual(finishedDuringRush.drainEvents().map(({ type }) => type),
    ['web-rush-end', 'round-finished'])
  const interrupted = playingGame()
  interrupted.triggerWebRush(COUNTDOWN_MS + 2000)
  interrupted.abort()
  assert.equal(interrupted.state.webRushActive, false)
  assert.equal(interrupted.drainEvents().length, 0)
})

test('rush profile changes density and group odds, preserving launch speed and normal profile', () => {
  const normal = difficultyAt(45000)
  assert.equal(spawnProfileFor(normal, false, MAX_ACTIVE_TARGETS), normal)
  const rush = spawnProfileFor(normal, true, MAX_ACTIVE_TARGETS)
  assert.equal(rush.spawnIntervalMs, 950)
  assert.equal(rush.launchSpeedScale, normal.launchSpeedScale)
  assert.equal(rush.activeLimit, 5)
  assert.equal(rush.tripleProbability, 0.20)
  assert.equal(rush.pairProbability, 0.50)
  assert.equal(rush.singleProbability, 0.30)
  assert.equal(WEB_RUSH_CONFIG.singleProbability, 0.30)
  assert.equal(groupSizeForRoll(0.1, rush), 1)
  assert.equal(groupSizeForRoll(0.4, rush), 2)
  assert.equal(groupSizeForRoll(0.8, rush), 3)
  assert.equal(groupSizeForRoll(0.01, normal), 3)
  assert.equal(spawnProfileFor(difficultyAt(51000), false, MAX_ACTIVE_TARGETS).spawnIntervalMs,
    difficultyAt(51000).spawnIntervalMs)
})

test('web-family selection is 90/10 at boundary, with fallback and within-wave variety', () => {
  assert.deepEqual(WEB_TARGET_IDS, ['html', 'css', 'javascript', 'react'])
  assert.equal(WEB_RUSH_CONFIG.webProbability, 0.90)
  const rolls = [0.899, 0, 0.9, 0]
  const random = () => rolls.shift()
  assert.equal(WEB_TARGET_IDS.includes(selectWebRushTech(random).id), true)
  assert.equal(WEB_TARGET_IDS.includes(selectWebRushTech(random).id), false)
  const excluded = []
  for (let index = 0; index < 4; index += 1) {
    const definition = selectWebRushTech(() => 0, excluded)
    assert.equal(WEB_TARGET_IDS.includes(definition.id), true)
    excluded.push(definition.id)
  }
  assert.equal(new Set(excluded).size, 4)
  assert.equal(WEB_TARGET_IDS.includes(selectWebRushTech(() => 0, excluded).id), false)
  assert.equal(selectWebRushTech(() => 0, [...TECH_TARGET_BY_ID.keys()]), null)
})

test('rush target selection uses existing assets and scores; Golden roll remains separate', () => {
  const targets = createTargetSystem(() => 0)
  const golden = targets.spawn(500, 400, 0, { selectionMode: 'web-rush', elapsedMs: 10000 })
  assert.equal(GOLDEN_TARGET_CHANCE, 0.03)
  assert.equal(golden.kind, 'golden')
  assert.equal(golden.basePoints, 50)
  assert.equal(golden.catalogId, 'golden')
  const other = targets.spawn(500, 400, 1, { selectionMode: 'web-rush', elapsedMs: 0 })
  assert.equal(WEB_TARGET_IDS.includes(other.catalogId), true)
  assert.equal(other.basePoints, TECH_TARGET_BY_ID.get(other.catalogId).basePoints)
  assert.equal(other.visualScale, TECH_TARGET_BY_ID.get(other.catalogId).visualScale)
  const normal = createTargetSystem(() => 0).spawn(500, 400, 0, { elapsedMs: 0 })
  assert.equal(normal.catalogId, 'python')
})

test('rush wave capacity never exceeds the five-target cap', () => {
  const targets = createTargetSystem(() => 0.5)
  for (let index = 0; index < 8; index += 1) targets.spawn(500, 400, index, {
    elapsedMs: 45000, selectionMode: 'web-rush', activeLimit: 5,
  })
  assert.equal(targets.activeCount(), MAX_ACTIVE_TARGETS)
})

test('dedicated rush cue plays once from the event and respects SOUND OFF', async () => {
  class FakeAudioContext {
    state = 'suspended'; currentTime = 0; sampleRate = 48000; destination = {}
    createGain() { return { gain: { value: 0, setValueAtTime() {},
      linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} } }
    createOscillator() { return { frequency: { setValueAtTime() {},
      exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} } }
    createBiquadFilter() { return { Q: { value: 0 }, frequency: { setValueAtTime() {},
      exponentialRampToValueAtTime() {} }, connect() {} } }
    createBuffer(_channels, frames) { return { getChannelData() { return new Float32Array(frames) } } }
    createBufferSource() { return { connect() {}, start() {}, stop() {} } }
    async resume() { this.state = 'running' }
  }
  const game = playingGame()
  const audio = createAudioSystem({ AudioContextClass: FakeAudioContext })
  await audio.unlock()
  game.update(COUNTDOWN_MS + 45000)
  for (const event of game.drainEvents()) {
    const cue = soundCueForEvent(event)
    if (cue) audio.cue(cue.name, cue.detail)
  }
  assert.equal(audio.state.cuesPlayed, 1)
  game.update(COUNTDOWN_MS + 46000)
  assert.equal(game.drainEvents().length, 0)
  audio.setEnabled(false)
  assert.equal(audio.cue('web-rush-start'), false)
  assert.equal(audio.state.cuesPlayed, 1)
  assert.equal(soundCueForEvent({ type: 'target-sliced', kind: 'normal', combo: 1 }).name,
    'normal-slice')
  assert.equal(soundCueForEvent({ type: 'target-sliced', kind: 'golden', combo: 1 }).name,
    'golden-slice')
  assert.equal(soundCueForEvent({ type: 'final-15' }).name, 'final-15')
})

test('Expo keeps the automatic rush presentation without a manual developer trigger', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
  const panel = html.match(/<aside id="debug-panel"[^>]*hidden>([\s\S]*?)<\/aside>/)
  assert.ok(panel)
  assert.doesNotMatch(panel[1], /id="trigger-web-rush"/)
  assert.match(html, /class="web-rush-atmosphere"/)
  assert.match(css, /\.app\.web-rush \.web-rush-atmosphere/)
})
