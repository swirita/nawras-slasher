export function createDeveloperUi(panel, { toggleButton, closeButton, onChange = () => {} } = {}) {
  const state = { visible: false }
  panel.hidden = true
  toggleButton?.setAttribute('aria-expanded', 'false')

  function toggle(visible = !state.visible) {
    state.visible = visible
    panel.hidden = !visible
    toggleButton?.setAttribute('aria-expanded', String(visible))
    onChange(visible)
    if (visible) closeButton?.focus({ preventScroll: true })
    else if (toggleButton && !toggleButton.hidden) toggleButton.focus({ preventScroll: true })
    return visible
  }

  toggleButton?.addEventListener('click', () => toggle())
  closeButton?.addEventListener('click', () => toggle(false))

  function handleKeydown(event) {
    const isD = event.code === 'KeyD' || event.key?.toLowerCase() === 'd'
    if (!(event.ctrlKey && event.shiftKey && isD) || event.altKey || event.repeat) return false
    event.preventDefault()
    toggle()
    return true
  }

  return { state, toggle, handleKeydown }
}
