export const RESULT_COUNTUP_MS = 850

export function displayedResultScore(actualScore, elapsedMs) {
  const progress = Math.max(0, Math.min(1, elapsedMs / RESULT_COUNTUP_MS))
  return Math.round(actualScore * (1 - (1 - progress) ** 3))
}

export function resultSummary(state) {
  return { score: state.score, sliced: state.targetsSliced, bestCombo: state.bestCombo }
}
