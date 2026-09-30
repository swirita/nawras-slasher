import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createGameSession, COMBO_WINDOW_MS, COUNTDOWN_MS, GAME_DURATION_MS,
  MAX_COMBO, NORMAL_POINTS, GOLDEN_POINTS, formatTime,
} from '../src/game.js'

const target = (id, kind = 'normal') => ({ id, kind, x: 100, y: 200 })

function startPlaying(game, at = 0) {
  assert.equal(game.startCountdown(at), true)
  game.update(at + COUNTDOWN_MS)
  assert.equal(game.state.phase, 'PLAYING')
  game.drainEvents()
  return at + COUNTDOWN_MS
}

test('READY and COUNTDOWN cannot spawn; countdown does not consume round time', () => {
  const game = createGameSession()
  assert.equal(game.state.phase, 'READY')
  assert.equal(game.canSpawn(), false)
  assert.equal(game.scoreTarget(target(1), 0), null)
  assert.equal(game.startCountdown(100), true)
  assert.equal(game.startCountdown(200), false)
  assert.equal(game.state.phase, 'COUNTDOWN')
  assert.equal(game.canSpawn(), false)
  assert.equal(game.scoreTarget(target(1), 200), null)
  game.update(1100)
  assert.equal(game.state.countdownNumber, 2)
  game.update(2100)
  assert.equal(game.state.countdownNumber, 1)
  game.update(3099)
  assert.equal(game.state.remainingMs, GAME_DURATION_MS)
  assert.equal(game.canSpawn(), false)
  game.update(3100)
  assert.equal(game.state.phase, 'PLAYING')
  assert.equal(game.canSpawn(), true)
  assert.equal(formatTime(game.state.remainingMs), '01:30')
  assert.deepEqual(game.drainEvents().map((event) => event.type),
    ['countdown-tick', 'countdown-tick', 'countdown-tick', 'round-start'])
})

test('normal and golden points use combo multiplier; unique hits update sliced and best combo', () => {
  assert.equal(NORMAL_POINTS, 10)
  assert.equal(GOLDEN_POINTS, 25)
  const game = createGameSession()
  const now = startPlaying(game)
  assert.equal(game.state.combo, 1)
  assert.equal(game.scoreTarget(target(1), now + 10).points, 10)
  assert.equal(game.scoreTarget(target(2, 'golden'), now + 100).points, 50)
  assert.equal(game.scoreTarget(target(3), now + 200).points, 30)
  assert.equal(game.scoreTarget(target(4), now + 300).points, 40)
  assert.equal(game.scoreTarget(target(5), now + 400).points, 50)
  assert.equal(game.scoreTarget(target(6, 'golden'), now + 500).points, 125)
  assert.equal(game.state.combo, MAX_COMBO)
  assert.equal(game.state.bestCombo, MAX_COMBO)
  assert.equal(game.state.score, 305)
  assert.equal(game.state.targetsSliced, 6)
  assert.equal(game.scoreTarget(target(6, 'golden'), now + 600), null)
  assert.equal(game.state.score, 305)
  assert.equal(game.state.targetsSliced, 6)
})

test('combo expires after two seconds; a miss never resets it', () => {
  assert.equal(COMBO_WINDOW_MS, 2000)
  const game = createGameSession()
  const now = startPlaying(game)
  game.scoreTarget(target(1), now + 10)
  game.scoreTarget(target(2), now + 20)
  game.update(now + 20 + COMBO_WINDOW_MS - 1)
  assert.equal(game.state.combo, 2)
  game.update(now + 20 + COMBO_WINDOW_MS)
  assert.equal(game.state.combo, 1)
  assert.equal(game.state.bestCombo, 2)
  assert.equal(game.scoreTarget(target(3, 'golden'), now + 2100).points, 25)
  game.scoreTarget(target(4), now + 2200)
  // No target was sliced here; elapsed time alone has no score penalty.
  assert.equal(game.state.score, 10 + 20 + 25 + 20)
})

test('FINAL 15 emits once, FINISHED occurs at zero, and scoring stops', () => {
  const game = createGameSession()
  const now = startPlaying(game)
  game.update(now + 75000)
  assert.equal(formatTime(game.state.remainingMs), '00:15')
  game.update(now + 76000)
  assert.equal(game.drainEvents().filter((event) => event.type === 'final-15').length, 1)
  game.update(now + GAME_DURATION_MS)
  assert.equal(game.state.phase, 'FINISHED')
  assert.equal(formatTime(game.state.remainingMs), '00:00')
  assert.equal(game.canSpawn(), false)
  assert.equal(game.scoreTarget(target(1), now + GAME_DURATION_MS), null)
  assert.equal(game.state.score, 0)
  assert.equal(game.update(now + GAME_DURATION_MS + 1000), false)
  assert.equal(game.drainEvents().filter((event) => event.type === 'round-finished').length, 1)
})

test('final-ten timer ticks begin at ten, count down once each, and time up fires once', () => {
  const game = createGameSession()
  const now = startPlaying(game)
  game.update(now + 79999)
  assert.equal(game.drainEvents().filter((event) => event.type === 'final-ten-tick').length, 0)
  const seconds = []
  for (let second = 10; second >= 1; second -= 1) {
    game.update(now + GAME_DURATION_MS - second * 1000)
    seconds.push(...game.drainEvents().filter((event) => event.type === 'final-ten-tick')
      .map((event) => event.second))
    game.update(now + GAME_DURATION_MS - second * 1000 + 100)
    assert.equal(game.drainEvents().filter((event) => event.type === 'final-ten-tick').length, 0)
  }
  assert.deepEqual(seconds, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  game.update(now + GAME_DURATION_MS)
  assert.equal(game.drainEvents().filter((event) => event.type === 'round-finished').length, 1)
  game.update(now + GAME_DURATION_MS + 1000)
  assert.equal(game.drainEvents().length, 0)
})

test('Play Again resets round state and preserves the best score in page memory', () => {
  const game = createGameSession()
  let now = startPlaying(game)
  game.scoreTarget(target(1, 'golden'), now + 10)
  game.scoreTarget(target(2), now + 20)
  game.update(now + GAME_DURATION_MS)
  assert.equal(game.state.highScore, 45)
  assert.equal(game.state.newHighScore, true)
  game.reset()
  assert.equal(game.state.phase, 'READY')
  assert.equal(game.state.score, 0)
  assert.equal(game.state.combo, 1)
  assert.equal(game.state.bestCombo, 1)
  assert.equal(game.state.targetsSliced, 0)
  assert.equal(game.state.remainingMs, GAME_DURATION_MS)
  assert.equal(game.state.highScore, 45)
  assert.equal(game.state.newHighScore, false)
  now = startPlaying(game, 100000)
  game.scoreTarget(target(1), now + 10)
  game.update(now + GAME_DURATION_MS)
  assert.equal(game.state.score, 10)
  assert.equal(game.state.highScore, 45)
  assert.equal(game.state.newHighScore, false)
})
