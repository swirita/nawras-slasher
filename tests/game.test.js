import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createGameClock, difficultyAt, formatTime, GAME_DURATION_MS,
  INITIAL_SPAWN_INTERVAL_MS, FINAL_SPAWN_INTERVAL_MS,
} from '../src/game.js'

test('difficulty rises continuously across the round', () => {
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
})

test('clock starts explicitly, ends once, and reset restores three minutes', () => {
  const clock = createGameClock()
  assert.equal(clock.update(50000), false)
  assert.equal(clock.state.remainingMs, GAME_DURATION_MS)
  assert.equal(clock.start(1000), true)
  assert.equal(clock.start(2000), false)
  clock.update(91000)
  assert.equal(clock.state.remainingMs, 90000)
  assert.equal(formatTime(clock.state.remainingMs), '01:30')
  assert.equal(clock.update(181000), true)
  assert.equal(clock.state.phase, 'ended')
  assert.equal(formatTime(clock.state.remainingMs), '00:00')
  assert.equal(clock.update(190000), false)
  clock.reset()
  assert.equal(clock.state.phase, 'ready')
  assert.equal(formatTime(clock.state.remainingMs), '03:00')
})
