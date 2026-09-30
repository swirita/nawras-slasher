import test from 'node:test'
import assert from 'node:assert/strict'
import { createAudioSystem, MASTER_VOLUME, comboPitch, countdownPitch,
  soundCueForEvent } from '../src/audio.js'
import { createGameSession } from '../src/game.js'

class FakeAudioContext {
  state = 'suspended'
  currentTime = 0
  sampleRate = 48000
  destination = {}
  createGain() {
    return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {} }, connect() {} }
  }
  createOscillator() {
    return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {}, start() {}, stop() {} }
  }
  createBiquadFilter() {
    return { Q: { value: 0 }, frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {} }
  }
  createBuffer(channels, frames) { return { getChannelData() { return new Float32Array(frames) } } }
  createBufferSource() { return { connect() {}, start() {}, stop() {} } }
  async resume() { this.state = 'running' }
}

test('audio stays silent before unlock and while SOUND OFF; toggling persists in memory', async () => {
  const audio = createAudioSystem({ AudioContextClass: FakeAudioContext })
  assert.equal(audio.state.volume, MASTER_VOLUME)
  assert.equal(audio.cue('countdown-tick', { number: 3 }), false)
  assert.equal(await audio.unlock(), true)
  assert.equal(audio.cue('countdown-tick', { number: 3 }), true)
  assert.equal(audio.state.cuesPlayed, 1)
  assert.equal(audio.setEnabled(false), false)
  assert.equal(audio.cue('round-start'), false)
  assert.equal(audio.state.cuesPlayed, 1)
  assert.equal(audio.setEnabled(true), true)
  assert.equal(audio.cue('combo-increase', { combo: 3 }), true)
  assert.equal(audio.state.cuesPlayed, 2)
})

test('successful-hit pitch rises musically from x1 to x5 and resets to base', () => {
  const pitches = [1, 2, 3, 4, 5].map((combo) => comboPitch(combo))
  assert.ok(pitches.every((pitch, index) => index === 0 || pitch > pitches[index - 1]))
  assert.ok(pitches[4] < pitches[0] * 1.6)
  const game = createGameSession()
  game.startCountdown(0)
  game.update(3000)
  game.scoreTarget({ id: 1, kind: 'normal', catalogId: 'python', x: 0, y: 0 }, 3010)
  game.scoreTarget({ id: 2, kind: 'normal', catalogId: 'java', x: 0, y: 0 }, 3020)
  assert.equal(comboPitch(game.state.combo), pitches[1])
  game.update(5020)
  assert.equal(game.state.combo, 1)
  assert.equal(comboPitch(game.state.combo), pitches[0])
})

test('countdown maps 3, 2, 1, GO to rising ticks and a distinct launch cue', async () => {
  assert.ok(countdownPitch(3) < countdownPitch(2))
  assert.ok(countdownPitch(2) < countdownPitch(1))
  const game = createGameSession()
  const audio = createAudioSystem({ AudioContextClass: FakeAudioContext })
  await audio.unlock()
  game.startCountdown(0)
  game.update(1000)
  game.update(2000)
  game.update(3000)
  const cues = game.drainEvents().map(soundCueForEvent)
  assert.deepEqual(cues.map((cue) => cue.name),
    ['countdown-tick', 'countdown-tick', 'countdown-tick', 'round-start'])
  assert.deepEqual(cues.slice(0, 3).map((cue) => cue.detail.number), [3, 2, 1])
  for (const cue of cues) assert.equal(audio.cue(cue.name, cue.detail), true)
  assert.equal(audio.state.cuesPlayed, 4)
})

test('game event mapping schedules final ticks and one time-up cue', () => {
  const game = createGameSession()
  game.startCountdown(0)
  game.update(3000)
  game.drainEvents()
  game.update(93000 - 10000)
  game.update(93000)
  game.update(95000)
  const names = game.drainEvents().map(soundCueForEvent).filter(Boolean).map((cue) => cue.name)
  assert.equal(names.filter((name) => name === 'final-ten-tick').length, 1)
  assert.equal(names.filter((name) => name === 'round-finished').length, 1)
})

test('an audio initialization failure cannot stop round events', async () => {
  class FailedAudioContext { constructor() { throw new Error('No sound device') } }
  const warn = console.warn
  console.warn = () => {}
  try {
    const audio = createAudioSystem({ AudioContextClass: FailedAudioContext })
    assert.equal(await audio.unlock(), false)
    assert.equal(audio.state.failed, true)
    assert.equal(audio.cue('countdown-tick', { number: 3 }), false)
    const game = createGameSession()
    assert.equal(game.startCountdown(0), true)
    assert.deepEqual(game.drainEvents().map((event) => event.type), ['countdown-tick'])
    game.update(3000)
    assert.equal(game.state.phase, 'PLAYING')
    assert.deepEqual(game.drainEvents().map((event) => event.type), ['round-start'])
  } finally {
    console.warn = warn
  }
})
