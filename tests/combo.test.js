import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameSession, COUNTDOWN_MS, COMBO_WINDOW_MS,
  GAME_DURATION_MS, MAX_SCORE_MULTIPLIER, GOLDEN_POINTS } from '../src/game.js'
import { TECH_TARGETS } from '../src/catalog.js'
import { comboPresentation, resultSummary } from '../src/presentation.js'

function streak(count, catalogId = 'python') {
  const game = createGameSession()
  game.startCountdown(0)
  game.update(COUNTDOWN_MS)
  const awards = []
  for (let id = 1; id <= count; id++) {
    awards.push(game.scoreTarget({ id, kind: 'normal', catalogId }, COUNTDOWN_MS + id * 50))
  }
  return { game, awards }
}

test('streak reaches 6, 10, and 20 while every catalog score stays capped at ×5', () => {
  assert.equal(MAX_SCORE_MULTIPLIER, 5)
  for (const definition of TECH_TARGETS) {
    const { game, awards } = streak(20, definition.id)
    for (const count of [1, 2, 3, 4, 5, 6, 10, 20]) {
      assert.equal(awards[count - 1].combo, count)
      assert.equal(awards[count - 1].scoreMultiplier, Math.min(count, 5))
      assert.equal(awards[count - 1].points, definition.basePoints * Math.min(count, 5))
    }
    assert.equal(game.state.combo, 20)
    assert.equal(game.state.scoreMultiplier, 5)
    assert.equal(game.state.bestCombo, 20)
  }
})

test('Golden Nawras above five awards its unchanged base score times five', () => {
  const { game } = streak(10)
  const award = game.scoreTarget({ id: 'golden', kind: 'golden' }, COUNTDOWN_MS + 550)
  assert.equal(award.combo, 11)
  assert.equal(award.scoreMultiplier, 5)
  assert.equal(award.points, GOLDEN_POINTS * 5)
  assert.equal(award.points, 250)
})

test('uncapped combo expires at the same exact boundary and preserves Best Combo', () => {
  const { game } = streak(20)
  const lastHitAt = game.state.lastHitAt
  game.update(lastHitAt + COMBO_WINDOW_MS - 1)
  assert.equal(game.state.combo, 20)
  game.update(lastHitAt + COMBO_WINDOW_MS)
  assert.equal(game.state.combo, 1)
  assert.equal(game.state.scoreMultiplier, 1)
  assert.equal(game.state.bestCombo, 20)
  assert.equal(game.drainEvents().filter(event => event.type === 'combo-expired').length, 1)
  assert.equal(game.scoreTarget({ id: 'next', kind: 'normal', catalogId: 'python' },
    lastHitAt + COMBO_WINDOW_MS).points, 10)
})

test('scoring at the timeout boundary resets even without an intervening update', () => {
  const { game } = streak(10)
  const award = game.scoreTarget({ id: 'next', kind: 'normal', catalogId: 'python' },
    game.state.lastHitAt + COMBO_WINDOW_MS)
  assert.equal(award.combo, 1)
  assert.equal(award.points, 10)
  assert.equal(game.state.bestCombo, 10)
})

test('completed result reports uncapped Best Combo and a new round clears the streak', () => {
  const { game } = streak(20)
  game.update(COUNTDOWN_MS + GAME_DURATION_MS)
  assert.equal(game.state.phase, 'FINISHED')
  assert.deepEqual(resultSummary(game.state), { score: 900, sliced: 20, bestCombo: 20 })
  assert.equal(game.state.combo, 1)
  assert.equal(game.state.scoreMultiplier, 1)
  game.reset()
  assert.equal(game.state.bestCombo, 1)
  assert.equal(game.state.combo, 1)
  assert.equal(game.state.scoreMultiplier, 1)
  game.startCountdown(100000)
  game.update(100000 + COUNTDOWN_MS)
  assert.equal(game.scoreTarget({ id: 1, kind: 'normal', catalogId: 'python' }, 103010).points, 10)
})

test('combo presentation separates streak from maximum multiplier', () => {
  assert.equal(comboPresentation(2), 'COMBO 2')
  for (const count of [5, 6, 10, 20, 100]) {
    assert.equal(comboPresentation(count), `COMBO ${count}\n×5 MAX`)
  }
})
