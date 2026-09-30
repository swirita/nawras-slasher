export function createDeveloperUi(panel) {
  const state = { visible: false }
  panel.hidden = true

  function handleKeydown(event) {
    if (!(event.ctrlKey && event.shiftKey && event.code === 'KeyD') || event.repeat) return false
    event.preventDefault()
    state.visible = !state.visible
    panel.hidden = !state.visible
    return true
  }

  return { state, handleKeydown }
}
