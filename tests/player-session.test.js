import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createLeaderboard, LEADERBOARD_STORAGE_KEY } from '../src/leaderboard.js'
import { createPlayerSession } from '../src/player-session.js'
import { createGameSession, COUNTDOWN_MS, GAME_DURATION_MS } from '../src/game.js'
import { createResetConfirmation } from '../src/reset-game.js'

function storage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), values }
}

function finishRound(game, session, score, at) {
  assert.equal(game.startCountdown(at), true)
  game.update(at + COUNTDOWN_MS)
  game.drainEvents()
  game.state.score = score // The scoring subsystem is already tested; exercise completed-event routing.
  game.update(at + COUNTDOWN_MS + GAME_DURATION_MS)
  const finished = game.drainEvents().filter(({ type }) => type === 'round-finished')
  assert.equal(finished.length, 1)
  for (const _event of finished) session.recordFinishedRound(game.state.score)
  return session.state.lastCompleted
}

test('new player, repeat attempts, and next player save each completed round once', () => {
  let time = 100
  const board = createLeaderboard({ storage: storage(), now: () => time++ })
  const session = createPlayerSession(board)
  const game = createGameSession()
  assert.equal(session.state.currentPlayer, null)
  assert.equal(session.selectPlayer(' '), null)
  assert.deepEqual(session.selectPlayer(' Siwar '), { id: 'siwar', name: 'Siwar' })
  assert.equal(finishRound(game, session, 1500, 0).status, 'first')
  assert.equal(session.recordFinishedRound(1500).status, 'first')
  assert.equal(board.all().length, 1)
  game.reset(); session.clearRoundResult()
  assert.equal(session.state.currentPlayer.name, 'Siwar')
  assert.equal(finishRound(game, session, 1700, 100000).status, 'improved')
  assert.equal(board.all().length, 2)
  game.reset(); session.clearRoundResult()
  const lower = finishRound(game, session, 1400, 200000)
  assert.equal(lower.status, 'unchanged')
  assert.equal(lower.bestScore, 1700)
  assert.equal(board.best('siwar'), 1700)
  session.clearPlayer()
  assert.equal(session.state.currentPlayer, null)
  game.reset()
  session.selectPlayer('Lina')
  finishRound(game, session, 1900, 300000)
  assert.deepEqual(board.top().map(({ name }) => name), ['Lina', 'Siwar', 'Siwar', 'Siwar'])
})

test('RESET GAME discards the score and keeps the active player for a clean attempt', () => {
  const board = createLeaderboard({ storage: storage() })
  const session = createPlayerSession(board)
  const game = createGameSession()
  session.selectPlayer('Siwar')
  game.startCountdown(0)
  game.update(COUNTDOWN_MS)
  game.drainEvents()
  game.state.score = 1000
  const reset = createResetConfirmation({ isPlaying: () => game.state.phase === 'PLAYING',
    onConfirm: () => { game.reset(); session.clearRoundResult() },
    now: () => 10, setTimer: () => 1, clearTimer: () => {} })
  reset.click(); reset.click()
  assert.equal(game.state.phase, 'READY')
  assert.equal(game.state.score, 0)
  assert.equal(session.state.currentPlayer.name, 'Siwar')
  assert.deepEqual(board.top(), [])
  assert.equal(board.best('Siwar'), null)
  finishRound(game, session, 400, 100000)
  assert.equal(board.best('Siwar'), 400)
})

test('reload restores leaderboard but begins with no active player', () => {
  const backend = storage()
  const firstBoard = createLeaderboard({ storage: backend })
  const firstSession = createPlayerSession(firstBoard)
  firstSession.selectPlayer('Omar')
  firstSession.recordFinishedRound(600)
  assert.ok(backend.values.has(LEADERBOARD_STORAGE_KEY))
  const reloadedBoard = createLeaderboard({ storage: backend })
  const reloadedSession = createPlayerSession(reloadedBoard)
  assert.equal(reloadedBoard.best('Omar'), 600)
  assert.equal(reloadedSession.state.currentPlayer, null)
})

test('staff clear is a protected two-click action and leaves player identity intact', () => {
  const backend = storage()
  const board = createLeaderboard({ storage: backend })
  const session = createPlayerSession(board)
  session.selectPlayer('Omar')
  session.recordFinishedRound(600)
  let time = 0
  const control = createResetConfirmation({ isPlaying: () => true,
    onConfirm: () => board.clear(), now: () => time,
    setTimer: () => 1, clearTimer: () => {} })
  control.click()
  assert.equal(board.best('Omar'), 600)
  time = 500
  control.click()
  assert.deepEqual(board.top(), [])
  assert.equal(backend.values.has(LEADERBOARD_STORAGE_KEY), false)
  assert.equal(session.state.currentPlayer.name, 'Omar')
})

test('entry, completion, replay, reset and new-player controls are wired without camera auto-start on load', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(html, /<form id="player-entry"/)
  assert.match(html, /id="player-name"[^>]*maxlength="16"/)
  assert.match(html, /id="new-player"/)
  assert.match(html, /<section id="leaderboard-page"[\s\S]*id="clear-leaderboard"/)
  assert.match(main, /playerEntry\.addEventListener\('submit'/)
  assert.match(main, /if \(await startCamera\(\)\) await beginRound\(\)/)
  assert.match(main, /case 'round-finished':\s*renderPersonalResult\(playerSession\.recordFinishedRound/)
  assert.match(main, /newPlayerButton\.addEventListener\('click'/)
  assert.doesNotMatch(main, /innerHTML/)
})

test('round peak combo is saved once even after the live combo resets, and replay resets the peak', () => {
 const board=createLeaderboard({storage:storage()})
 const session=createPlayerSession(board)
 const game=createGameSession()
 session.selectPlayer('Lina')
 game.startCountdown(0); game.update(COUNTDOWN_MS); game.drainEvents()
 for(let i=0;i<5;i++) game.scoreTarget({id:'peak-'+i,kind:'normal',catalogId:'python'},COUNTDOWN_MS+i*100)
 assert.equal(game.state.bestCombo,5)
 game.update(COUNTDOWN_MS+GAME_DURATION_MS)
 assert.equal(game.state.combo,1)
 const saved=session.recordFinishedRound(game.state.score,game.state.bestCombo)
 assert.equal(board.all()[0].bestCombo,5)
 assert.equal(session.recordFinishedRound(0,1),saved)
 assert.equal(board.all().length,1)
 game.reset(); session.clearRoundResult()
 assert.equal(game.state.bestCombo,1)
 const replay=session.recordFinishedRound(0,1)
 assert.notEqual(replay.id,saved.id)
 assert.equal(board.all().length,2)
})
