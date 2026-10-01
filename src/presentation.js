import { MAX_SCORE_MULTIPLIER } from './game.js'

export function comboPresentation(combo) {
  return `COMBO ${combo}${combo >= MAX_SCORE_MULTIPLIER ? '\n×5 MAX' : ''}`
}

export const RESULT_COUNTUP_MS = 850

export const CALLOUT_EXIT_MS = Object.freeze({
  go: 400,
  'web-rush': 400,
  finale: 450,
  bug: 200,
})

export function calloutPhaseAt(now, visibleUntil, kind) {
  if (now < visibleUntil) return 'visible'
  if (now < visibleUntil + (CALLOUT_EXIT_MS[kind] ?? 0)) return 'exiting'
  return 'hidden'
}

export function displayedResultScore(actualScore, elapsedMs) {
  const progress = Math.max(0, Math.min(1, elapsedMs / RESULT_COUNTUP_MS))
  return Math.round(actualScore * (1 - (1 - progress) ** 3))
}

export function resultSummary(state) {
  return { score: state.score, sliced: state.targetsSliced, bestCombo: state.bestCombo }
}
