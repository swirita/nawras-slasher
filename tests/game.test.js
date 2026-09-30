import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createGameClock, difficultyAt, formatTime, GAME_DURATION_MS,
  INITIAL_SPAWN_INTERVAL_MS, FINAL_SPAWN_INTERVAL_MS,
} from '../src/game.js'

test('difficulty rises continuously across the round', () => {
  assert.equal(GAME_DURATION_MS, 90000)
  const early = difficultyAt(0)
  const middle = difficultyAt(GAME_DURATION_MS / 2)
  const late = difficultyAt(GAME_DURATION_MS)
  assert.equal(early.spawnIntervalMs, INITIAL_SPAWN_INTERVAL_MS)
  assert.equal(late.spawnIntervalMs, FINAL_SPAWN_INTERVAL_MS)
  assert.ok(early.spawnIntervalMs > middle.spawnIntervalMs && middle.spawnIntervalMs > late.spawnIntervalMs)
  assert.ok(early.launchSpeedScale < middle.launchSpeedScale && middle.launchSpeedScale < late.launchSpeedScale)
  assert.equal(early.pairProbability, 0)
  assert.ok(middle.pairProbability > 0 && late.pairProbability > middle.pairProbability)
  assert.equal(early.activeLimit, 1)
  assert.equal(late.activeLimit, 5)
  assert.equal(late.pairProbability, 0.74)
  assert.equal(late.tripleProbability, 0.11)
  assert.equal(difficultyAt(45000).progress, 0.5)
  assert.deepEqual([0, 10, 20, 30, 45, 60, 75, 90].map((second) =>
    difficultyAt(second * 1000).spawnIntervalMs), [3400, 3050, 2650, 2300, 1950, 1650, 1350, 1120])
  assert.deepEqual([0, 10, 20, 30, 45, 60, 75, 90].map((second) =>
    difficultyAt(second * 1000).launchSpeedScale), [0.82, 0.88, 0.96, 1.08, 1.20, 1.31, 1.38, 1.45])
  assert.equal(difficultyAt(15000).spawnIntervalMs, 2850)
  assert.equal(difficultyAt(15000).pairProbability, 0.11)
  assert.ok(difficultyAt(30000).spawnIntervalMs < 2950)
  assert.ok(difficultyAt(30000).launchSpeedScale > 0.99)
  assert.ok(FINAL_SPAWN_INTERVAL_MS >= 1000 && FINAL_SPAWN_INTERVAL_MS <= 1250)
})

test('clock starts explicitly, ends at 90 seconds, and reset restores 01:30', () => {
  const clock = createGameClock()
  assert.equal(clock.update(50000), false)
  assert.equal(clock.state.remainingMs, GAME_DURATION_MS)
  assert.equal(clock.start(1000), true)
  assert.equal(clock.start(2000), false)
  clock.update(46000)
  assert.equal(clock.state.remainingMs, 45000)
  assert.equal(formatTime(clock.state.remainingMs), '00:45')
  assert.equal(clock.update(91000), true)
  assert.equal(clock.state.phase, 'ended')
  assert.equal(formatTime(clock.state.remainingMs), '00:00')
  assert.equal(clock.update(190000), false)
  clock.reset()
  assert.equal(clock.state.phase, 'ready')
  assert.equal(formatTime(clock.state.remainingMs), '01:30')
})
