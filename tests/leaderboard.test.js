import test from 'node:test'
import assert from 'node:assert/strict'
import { createLeaderboard, normalizePlayerName, LEADERBOARD_STORAGE_KEY,
  MAX_PLAYER_NAME_LENGTH, MAX_STORED_PLAYERS } from '../src/leaderboard.js'

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
    removeItem(key) { values.delete(key) },
  }
}

test('names trim and collapse whitespace, compare without case, and keep display case', () => {
  assert.deepEqual(normalizePlayerName(' Siwar '), { id: 'siwar', name: 'Siwar' })
  assert.deepEqual(normalizePlayerName('SIWAR'), { id: 'siwar', name: 'SIWAR' })
  assert.deepEqual(normalizePlayerName('siwar'), { id: 'siwar', name: 'siwar' })
  assert.deepEqual(normalizePlayerName('  Mariam   Noor  '),
    { id: 'mariam noor', name: 'Mariam Noor' })
  assert.equal(normalizePlayerName(' \n\t '), null)
  assert.equal(normalizePlayerName(null), null)
  assert.equal(MAX_PLAYER_NAME_LENGTH, 16)
  assert.equal([...normalizePlayerName('abcdefghijklmnopqr').name].length, 16)
})

test('first, better, lower, and equal completed scores keep one personal best row', () => {
  let timestamp = 100
  const board = createLeaderboard({ storage: fakeStorage(), now: () => timestamp })
  assert.deepEqual(board.top(), [])
  assert.equal(board.best('Siwar'), null)
  assert.equal(board.rank('Siwar'), null)
  const first = board.recordCompletedScore({ name: 'Siwar' }, 1240)
  assert.deepEqual(first, { status: 'first', previousBest: null, bestScore: 1240,
    rank: 1, inTop5: true })
  timestamp = 200
  const improved = board.recordCompletedScore({ name: ' SIWAR ' }, 1580)
  assert.equal(improved.status, 'improved')
  assert.equal(improved.previousBest, 1240)
  assert.equal(improved.bestScore, 1580)
  timestamp = 300
  assert.equal(board.recordCompletedScore({ name: 'siwar' }, 1430).status, 'unchanged')
  assert.equal(board.recordCompletedScore({ name: 'Siwar' }, 1580).status, 'unchanged')
  assert.deepEqual(board.all(), [{ id: 'siwar', name: 'Siwar', bestScore: 1580, bestAt: 200 }])
  assert.equal(board.recordCompletedScore({ name: '  ' }, 100), null)
  assert.equal(board.recordCompletedScore({ name: 'Ali' }, -1), null)
  assert.equal(board.recordCompletedScore({ name: 'Ali' }, Infinity), null)
})

test('ranking is descending, ties favor earlier best time then ID, and Top 5 is a view', () => {
  let timestamp = 100
  const board = createLeaderboard({ storage: fakeStorage(), now: () => timestamp })
  for (const [name, score, at] of [
    ['A', 100, 6], ['B', 700, 4], ['C', 500, 2], ['D', 400, 2],
    ['E', 300, 2], ['F', 200, 2], ['G', 600, 3],
  ]) {
    timestamp = at
    board.recordCompletedScore({ name }, score)
  }
  assert.deepEqual(board.top().map(({ id }) => id), ['b', 'g', 'c', 'd', 'e'])
  assert.equal(board.all().length, 7)
  assert.equal(board.rank('A'), 7)
  assert.equal(board.best('A'), 100)
  assert.equal(board.top().length, 5)
  const tied = createLeaderboard({ storage: fakeStorage(), now: () => 10 })
  tied.recordCompletedScore('Zed', 100)
  tied.recordCompletedScore('Ali', 100)
  assert.deepEqual(tied.top().map(({ id }) => id), ['ali', 'zed'])
  timestamp = 20
  const timeTie = createLeaderboard({ storage: fakeStorage(), now: () => timestamp })
  timeTie.recordCompletedScore('Zed', 100)
  timestamp = 30
  timeTie.recordCompletedScore('Ali', 100)
  assert.deepEqual(timeTie.top().map(({ id }) => id), ['zed', 'ali'])
})

test('leaderboard persists, reloads safely, and clears only its own storage key', () => {
  const storage = fakeStorage({ otherApp: 'keep me' })
  const first = createLeaderboard({ storage, now: () => 123 })
  first.recordCompletedScore('Lina', 2450)
  const saved = JSON.parse(storage.getItem(LEADERBOARD_STORAGE_KEY))
  assert.deepEqual(saved, [{ id: 'lina', name: 'Lina', bestScore: 2450, bestAt: 123 }])
  const reloaded = createLeaderboard({ storage })
  assert.equal(reloaded.best('LINA'), 2450)
  reloaded.clear()
  assert.deepEqual(reloaded.top(), [])
  assert.equal(storage.getItem(LEADERBOARD_STORAGE_KEY), null)
  assert.equal(storage.getItem('otherApp'), 'keep me')
})

test('corrupt JSON and malformed entries are ignored; duplicate stored names are deduplicated', () => {
  const broken = createLeaderboard({ storage: fakeStorage({ [LEADERBOARD_STORAGE_KEY]: '{bad' }) })
  assert.deepEqual(broken.top(), [])
  const storage = fakeStorage({ [LEADERBOARD_STORAGE_KEY]: JSON.stringify([
    null, {}, { name: '  ', bestScore: 10 }, { name: 'Ali', bestScore: -2 },
    { name: 'Omar', bestScore: '500' }, { name: 'Lina', bestScore: 120, bestAt: 3 },
    { id: 'wrong', name: ' LINA ', bestScore: 150, bestAt: 4 },
    { name: 'Siwar', bestScore: 90, bestAt: 'bad' },
  ]) })
  const board = createLeaderboard({ storage })
  assert.deepEqual(board.all(), [
    { id: 'lina', name: 'LINA', bestScore: 150, bestAt: 4 },
    { id: 'siwar', name: 'Siwar', bestScore: 90, bestAt: Number.MAX_SAFE_INTEGER },
  ])
})

test('blocked localStorage falls back to an in-memory leaderboard', () => {
  const blocked = { getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  const board = createLeaderboard({ storage: blocked, now: () => 42 })
  assert.equal(board.recordCompletedScore('Maya', 500).bestScore, 500)
  assert.equal(board.best('MAYA'), 500)
  board.clear()
  assert.deepEqual(board.top(), [])
})

test('storage remains bounded to 100 unique player bests', () => {
  const board = createLeaderboard({ storage: fakeStorage(), now: () => 1 })
  for (let index = 0; index < MAX_STORED_PLAYERS + 10; index += 1) {
    board.recordCompletedScore(`Player ${index}`, index)
  }
  assert.equal(board.all().length, MAX_STORED_PLAYERS)
  assert.equal(board.top()[0].bestScore, MAX_STORED_PLAYERS + 9)
})
