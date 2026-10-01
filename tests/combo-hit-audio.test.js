import test from 'node:test'
import assert from 'node:assert/strict'
import { createAudioSystem, soundCueForEvent } from '../src/audio.js'
import { createGameSession, COMBO_WINDOW_MS } from '../src/game.js'

async function audioFixture() {
  const tones = []
  class Context {
    state = 'running'; currentTime = 0; destination = {}
    createGain() {
      return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {} }, connect() {} }
    }
    createOscillator() {
      const tone = {}
      tones.push(tone)
      return { set type(value) { tone.type = value },
        frequency: { setValueAtTime(value, at) { tone.start = value; tone.at = at },
          exponentialRampToValueAtTime(value, at) { tone.end = value; tone.duration = at - tone.at } },
        connect() {}, start() {}, stop() {} }
    }
  }
  const audio = createAudioSystem({ AudioContextClass: Context })
  await audio.unlock()
  return { audio, tones }
}

function playing() {
  const game = createGameSession()
  game.startCountdown(0); game.update(3000); game.drainEvents()
  return game
}
const tech = id => ({ id, kind: 'normal', catalogId: 'python', x: 0, y: 0 })
function playHit(audio, event) {
  const cue = soundCueForEvent(event)
  assert.equal(audio.cue(cue.name, cue.detail), true)
}
function assertNormalPitch(tones, multiplier) {
  assert.equal(tones.length, 3)
  for (const [i, [start, end]] of [[600,200],[660,880],[990,1100]].entries()) {
    assert.ok(Math.abs(tones[i].start - start * multiplier) < 1e-9)
    assert.ok(Math.abs(tones[i].end - end * multiplier) < 1e-9)
  }
}

for (const [combo, multiplier] of [[1,1],[2,1.06],[3,1.12],[4,1.18],[5,1.24],[6,1.24],[20,1.24]]) {
  test(`normal hit at combo ${combo} uses ${multiplier.toFixed(2)}× start and slide pitches`, async () => {
    const game = playing(), { audio, tones } = await audioFixture()
    let award
    for (let i = 0; i < combo; i++) award = game.scoreTarget(tech(i), 3010 + i * 10)
    assert.equal(award.combo, combo)
    playHit(audio, award)
    assertNormalPitch(tones, multiplier)
    assert.equal(audio.state.cuesPlayed, 1)
  })
}

test('combo expiry returns the next normal-hit sound to base pitch', async () => {
  const game = playing(), { audio, tones } = await audioFixture()
  for (let i = 0; i < 3; i++) game.scoreTarget(tech(i), 3010 + i * 10)
  game.update(3030 + COMBO_WINDOW_MS)
  const award = game.scoreTarget(tech(3), 3030 + COMBO_WINDOW_MS + 1)
  assert.equal(award.combo, 1)
  playHit(audio, award); assertNormalPitch(tones, 1)
})

test('a Bug resets the next normal-hit sound to base pitch', async () => {
  const game = playing(), { audio, tones } = await audioFixture()
  for (let i = 0; i < 5; i++) game.scoreTarget(tech(i), 3010 + i * 10)
  game.scoreTarget({ id: 5, kind: 'bug', catalogId: 'bug' }, 3060)
  assert.equal(game.state.combo, 0)
  const award = game.scoreTarget(tech(6), 3070)
  assert.equal(award.combo, 1)
  playHit(audio, award); assertNormalPitch(tones, 1)
})

for (const cue of ['bug-hit', 'golden-slice']) {
  test(`${cue} frequencies and timing are unaffected by combo`, async () => {
    const { audio, tones } = await audioFixture()
    audio.cue(cue, { combo: 1 })
    const base = structuredClone(tones)
    for (const combo of [2,5,6,20]) {
      tones.length = 0; audio.cue(cue, { combo })
      assert.deepEqual(tones, base)
    }
  })
}

test('normal scoring and uncapped streak retain the ×5 score cap while audio stays capped', async () => {
  const game = playing(), { audio, tones } = await audioFixture()
  let expectedScore = 0
  for (let i = 1; i <= 20; i++) {
    const award = game.scoreTarget(tech(i), 3000 + i * 10)
    assert.equal(award.combo, i)
    assert.equal(award.points, 10 * Math.min(i, 5))
    expectedScore += award.points
    tones.length = 0; playHit(audio, award)
    assertNormalPitch(tones, 1 + (Math.min(i,5) - 1) * .06)
    assert.equal(game.state.score, expectedScore)
  }
  assert.equal(game.state.combo, 20)
  assert.equal(game.state.bestCombo, 20)
  assert.equal(game.state.scoreMultiplier, 5)
})
