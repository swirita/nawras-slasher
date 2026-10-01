import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createFinishedIdle, FINISHED_IDLE_TIMEOUT_MS,
  FINISHED_IDLE_COUNTDOWN_MS } from '../src/finished-idle.js'
import { createLeaderboard } from '../src/leaderboard.js'
import { createPlayerSession } from '../src/player-session.js'

function clock() {
  let time = 0
  let nextId = 0
  const timers = new Map()
  return {
    now: () => time,
    at: (value) => { time = value },
    runTo: (value) => {
      while (true) {
        const due = [...timers].filter(([, item]) => item.due <= value)
          .sort((a, b) => a[1].due - b[1].due)[0]
        if (!due) break
        time = due[1].due
        timers.delete(due[0])
        due[1].callback()
      }
      time = value
    },
    setTimer: (callback, delay) => {
      const id = ++nextId
      timers.set(id, { callback, due: time + delay })
      return id
    },
    clearTimer: (id) => { timers.delete(id) },
    pending: () => timers.size,
  }
}

function setup(options = {}) {
  const time = clock()
  const countdowns = []
  let expires = 0
  const idle = createFinishedIdle({
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    onCountdown: (seconds) => countdowns.push(seconds),
    onExpire: () => { expires += 1 },
    ...options,
  })
  return { time, countdowns, idle, expires: () => expires }
}

test('FINISHED idle starts once and leaving FINISHED removes its scheduled check', () => {
  const { time, idle, expires } = setup()
  idle.start()
  assert.equal(idle.state.active, true)
  assert.equal(time.pending(), 1)
  idle.start()
  idle.start()
  assert.equal(time.pending(), 1)
  idle.stop() // PLAY AGAIN, NEW PLAYER, or another phase transition
  assert.equal(idle.state.active, false)
  assert.equal(time.pending(), 0)
  time.at(70_000)
  idle.check()
  assert.equal(expires(), 0)
  for (let round = 0; round < 20; round += 1) {
    idle.start()
    assert.equal(time.pending(), 1)
    idle.stop()
    assert.equal(time.pending(), 0)
  }
})

test('countdown stays hidden through 49 seconds, shows 10 to 1, and expires at 60', () => {
  const { time, idle, countdowns, expires } = setup()
  assert.equal(FINISHED_IDLE_TIMEOUT_MS, 60_000)
  assert.equal(FINISHED_IDLE_COUNTDOWN_MS, 10_000)
  idle.start()
  for (const second of [0, 1, 25, 49]) {
    time.runTo(second * 1000)
    assert.equal(idle.state.countdown, null)
  }
  for (let second = 50; second <= 59; second += 1) {
    time.runTo(second * 1000)
    assert.equal(idle.state.countdown, 60 - second)
  }
  assert.deepEqual(countdowns, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  time.runTo(60_000)
  assert.equal(expires(), 1)
  assert.equal(idle.state.active, false)
  assert.equal(idle.state.countdown, null)
  assert.equal(time.pending(), 0)
})

test('activity hides a visible countdown immediately and restarts the full idle period', () => {
  const { time, idle, countdowns, expires } = setup()
  idle.start()
  time.at(55_000)
  idle.check()
  assert.equal(idle.state.countdown, 5)
  time.at(55_250)
  idle.activity()
  assert.equal(idle.state.countdown, null)
  assert.deepEqual(countdowns, [5, null])
  assert.equal(time.pending(), 1)
  time.at(60_000)
  idle.check()
  assert.equal(expires(), 0)
  time.at(105_250)
  idle.check()
  assert.equal(idle.state.countdown, 10)
  time.at(115_250)
  idle.check()
  assert.equal(expires(), 1)
})

test('high-frequency pointer activity only updates time and keeps one timer', () => {
  const { time, idle, countdowns } = setup()
  idle.start()
  for (let index = 1; index <= 1000; index += 1) {
    time.at(index)
    idle.activity()
  }
  assert.equal(idle.state.lastActivityAt, 1000)
  assert.equal(time.pending(), 1)
  assert.deepEqual(countdowns, [])
})

test('a late check after background throttling expires by elapsed real time', () => {
  const { time, idle, expires } = setup()
  idle.start()
  time.at(63_000)
  idle.check()
  assert.equal(expires(), 1)
  assert.equal(time.pending(), 0)
})

test('expiry clears current player once while preserving the recorded leaderboard', () => {
  const entries = new Map()
  const board = createLeaderboard({ storage: {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  } })
  const session = createPlayerSession(board)
  session.selectPlayer('Siwar')
  session.recordFinishedRound(1500)
  const before = [...entries]
  let newPlayerCalls = 0
  const { time, idle } = setup({ onExpire: () => {
    newPlayerCalls += 1
    session.clearPlayer()
  } })
  idle.start()
  time.at(60_000)
  idle.check()
  idle.check()
  assert.equal(newPlayerCalls, 1)
  assert.equal(session.state.currentPlayer, null)
  assert.deepEqual(board.top().map(({ name, bestScore }) => ({ name, bestScore })),
    [{ name: 'Siwar', bestScore: 1500 }])
  assert.deepEqual([...entries], before)
  assert.doesNotMatch(readFileSync(new URL('../src/finished-idle.js', import.meta.url), 'utf8'),
    /startCamera|recordFinishedRound|recordCompletedScore/)
})

test('the app routes manual and idle expiry through one New Player action', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(main, /onExpire: \(\) => enterNewPlayer\(\)/)
  assert.match(main, /newPlayerButton\.addEventListener\('click', enterNewPlayer\)/)
  assert.match(main, /case 'round-finished':[\s\S]*?finishedIdle\.start\(\)/)
  assert.match(main, /if \(game\.state\.phase !== 'FINISHED'\) finishedIdle\.stop\(\)/)
  assert.match(main, /playAgainButton\.addEventListener\('click',[\s\S]*?finishedIdle\.stop\(\)/)
  assert.match(main, /function enterNewPlayer\(\)[\s\S]*?finishedIdle\.stop\(\)[\s\S]*?playerSession\.clearPlayer\(\)[\s\S]*?releaseCamera\(\)/)
  assert.equal(main.match(/window\.addEventListener\('pointerdown'/g)?.length, 1)
  assert.equal(main.match(/document\.addEventListener\('pointermove'/g)?.length, 1)
  assert.equal(main.match(/document\.addEventListener\('keydown'/g)?.length, 1)
  assert.match(main, /document\.addEventListener\('pointermove',[\s\S]*?finishedIdle\.activity\(\)/)
  assert.match(main, /document\.addEventListener\('keydown',[\s\S]*?finishedIdle\.activity\(\)/)
  assert.match(main, /visibilitychange'[\s\S]*?finishedIdle\.check\(\)/)
  assert.match(html, /id="finished-idle-countdown"[^>]*hidden/)
})
