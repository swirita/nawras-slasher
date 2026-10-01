import { normalizePlayerName } from './leaderboard.js'

// Active identity is deliberately memory-only; the leaderboard owns persistence.
export function createPlayerSession(leaderboard) {
  const state = { currentPlayer: null, lastCompleted: null }

  function selectPlayer(rawName) {
    const player = normalizePlayerName(rawName)
    if (!player) return null
    const existing = leaderboard.all().find((entry) => entry.id === player.id)
    state.currentPlayer = { id: player.id, name: existing?.name ?? player.name }
    state.lastCompleted = null
    return state.currentPlayer
  }

  function recordFinishedRound(score) {
    if (!state.currentPlayer) return null
    if (!state.lastCompleted) {
      state.lastCompleted = leaderboard.recordCompletedScore(state.currentPlayer, score)
    }
    return state.lastCompleted
  }

  function clearRoundResult() { state.lastCompleted = null }
  function clearPlayer() {
    state.currentPlayer = null
    state.lastCompleted = null
  }

  return { state, selectPlayer, recordFinishedRound, clearRoundResult, clearPlayer }
}
