import { normalizePlayerName, createEntryId } from './leaderboard.js'

// Active identity is deliberately memory-only; the leaderboard owns persistence.
export function createPlayerSession(leaderboard) {
  const state = { currentPlayer: null, lastCompleted: null }

  function selectPlayer(rawName) {
    const player = normalizePlayerName(rawName)
    if (!player) return null
    state.currentPlayer = player
    clearRoundResult()
    return state.currentPlayer
  }

  let roundId = createEntryId()

  function recordFinishedRound(score, bestCombo) {
    if (!state.currentPlayer) return null
    if (!state.lastCompleted) {
      state.lastCompleted = leaderboard.recordCompletedScore(state.currentPlayer, score, bestCombo, roundId)
    }
    return state.lastCompleted
  }

  function clearRoundResult() { state.lastCompleted = null; roundId = createEntryId() }
  function clearPlayer() {
    state.currentPlayer = null
    clearRoundResult()
  }

  return { state, selectPlayer, recordFinishedRound, clearRoundResult, clearPlayer }
}
