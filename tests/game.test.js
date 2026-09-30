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
  assert.equal(late.pairProbability, 0.56)
  assert.equal(late.tripleProbability, 0.1)
  assert.equal(difficultyAt(45000).progress, 0.5)
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
