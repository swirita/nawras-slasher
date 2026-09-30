import test from 'node:test'
import assert from 'node:assert/strict'
import { displayedResultScore, resultSummary, RESULT_COUNTUP_MS } from '../src/presentation.js'
import { createGameSession } from '../src/game.js'

test('result count-up is presentation only and ends at the stored score', () => {
  const game = createGameSession()
  game.startCountdown(0)
  game.update(3000)
  game.scoreTarget({ id: 1, kind: 'golden', x: 0, y: 0 }, 3010)
  game.update(93000)
  assert.equal(game.state.score, 50)
  assert.equal(displayedResultScore(game.state.score, 0), 0)
  assert.ok(displayedResultScore(game.state.score, RESULT_COUNTUP_MS / 2) > 0)
  assert.equal(displayedResultScore(game.state.score, RESULT_COUNTUP_MS), 50)
  assert.equal(displayedResultScore(game.state.score, RESULT_COUNTUP_MS + 100), 50)
  assert.equal(game.state.score, 50)
  assert.equal(game.state.highScore, 50)
  assert.deepEqual(resultSummary(game.state), { score: 50, sliced: 1, bestCombo: 1 })
})
