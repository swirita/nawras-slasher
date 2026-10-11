import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeveloperUi } from '../src/developer-ui.js'

function button() {
  const listeners = new Map(), attributes = new Map()
  return { hidden: false, focusCount: 0,
    addEventListener: (type, callback) => listeners.set(type, callback),
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    focus() { this.focusCount++ },
    click() { listeners.get('click')() },
  }
}

test('Debug button, shortcut and close button share visibility, ARIA and refresh state', () => {
  const panel = { hidden: false }, toggleButton = button(), closeButton = button()
  const changes = []
  const ui = createDeveloperUi(panel, { toggleButton, closeButton, onChange: value => changes.push(value) })
  assert.equal(panel.hidden, true)
  toggleButton.click()
  assert.equal(panel.hidden, false)
  assert.equal(ui.state.visible, true)
  assert.equal(toggleButton.getAttribute('aria-expanded'), 'true')
  assert.equal(closeButton.focusCount, 1)
  closeButton.click()
  assert.equal(panel.hidden, true)
  assert.equal(toggleButton.getAttribute('aria-expanded'), 'false')
  const key = { ctrlKey: true, shiftKey: true, key: 'D', preventDefault() { this.prevented = true } }
  assert.equal(ui.handleKeydown(key), true, 'key-name fallback works without event.code')
  assert.equal(key.prevented, true)
  assert.equal(panel.hidden, false)
  toggleButton.click()
  assert.equal(panel.hidden, true)
  assert.deepEqual(changes, [true, false, true, false])
})

test('only the Debug chord toggles, without repeated keydown changes', () => {
  const panel = { hidden: false }, ui = createDeveloperUi(panel)
  for (const event of [
    { ctrlKey: true, shiftKey: true, code: 'KeyD', repeat: true },
    { ctrlKey: true, shiftKey: false, code: 'KeyD' },
    { ctrlKey: true, shiftKey: true, code: 'KeyD', altKey: true },
    { ctrlKey: false, shiftKey: true, code: 'KeyD' },
    { ctrlKey: true, shiftKey: true, code: 'KeyF' },
  ]) assert.equal(ui.handleKeydown(event), false)
  assert.equal(panel.hidden, true)
  assert.equal(ui.handleKeydown({ctrlKey:true,shiftKey:true,code:'KeyD',preventDefault(){}}), true)
  assert.equal(panel.hidden, false)
})
