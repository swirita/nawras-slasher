export function isEditableTarget(target) {
  return Boolean(target?.isContentEditable
    || target?.closest?.('input, textarea, select'))
}

// Fullscreen belongs to the browser; this controller never changes game state.
export function createFullscreenController({ document, hint, getPhase,
  warn = (error) => console.warn('Fullscreen request failed:', error) }) {
  const state = { active: false, pending: false }

  function sync() {
    state.active = Boolean(document.fullscreenElement)
    hint.hidden = state.active || getPhase() !== 'READY'
      || document.fullscreenEnabled === false
      || typeof document.documentElement.requestFullscreen !== 'function'
  }

  async function request() {
    state.pending = true
    try {
      await document.documentElement.requestFullscreen()
    } catch (error) {
      warn(error)
    } finally {
      state.pending = false
      sync()
    }
  }

  function handleKeydown(event) {
    if (event.defaultPrevented || event.repeat || event.key?.toLowerCase() !== 'f'
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || isEditableTarget(event.target)
      || event.composedPath?.().some(isEditableTarget)
      || document.fullscreenElement || state.pending
      || document.fullscreenEnabled === false
      || typeof document.documentElement.requestFullscreen !== 'function') return false
    event.preventDefault()
    void request()
    return true
  }

  document.addEventListener('fullscreenchange', sync)
  sync()
  return { state, sync, handleKeydown }
}
