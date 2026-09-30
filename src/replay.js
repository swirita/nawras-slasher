export function createReplayFlow({ canReplay, prepareCamera, resetRound, beginRound,
  onLoading = () => {}, onFailure = () => {} }) {
  const state = { pending: false }

  async function replay() {
    if (state.pending || !canReplay()) return false
    state.pending = true
    onLoading(true)
    try {
      const ready = await prepareCamera()
      if (!ready) return false
      resetRound()
      await beginRound()
      return true
    } catch (error) {
      onFailure(error)
      return false
    } finally {
      state.pending = false
      onLoading(false)
    }
  }

  return { state, replay }
}
