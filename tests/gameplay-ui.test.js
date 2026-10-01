import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { WORDMARK_ASSET } from '../src/catalog.js'
import { CALLOUT_EXIT_MS, calloutPhaseAt } from '../src/presentation.js'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')

test('player actions keep their primary hierarchy and shared CSS interactions', () => {
  for (const id of ['player-entry-start', 'start-camera', 'start-round', 'play-again', 'camera-retry']) {
    assert.match(html, new RegExp(`<button id="${id}" class="primary-button"`))
  }
  assert.match(html, /id="start-camera"[^>]*>ENABLE CAMERA/)
  assert.match(html, /id="start-round"[^>]*disabled>START GAME/)
  assert.doesNotMatch(html, /id="(?:reset-game|new-player|change-player)"[^>]*primary-button/)
  assert.match(css, /@media \(hover: hover\)/)
  assert.match(css, /button:not\(:disabled\):hover[^}]*translateY\(-2px\)/)
  assert.match(css, /button:not\(:disabled\):active[^}]*scale\(0\.98\)[^}]*100ms/)
  assert.match(css, /button:focus-visible[^}]*#2ca9c9/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*button:not\(:disabled\):hover, button:not\(:disabled\):active \{ transform: none; \}/)
  assert.match(main, /comboPresentation\(game\.state\.combo\)/)
  assert.match(main, /setText\(finalComboValue, String\(summary\.bestCombo\)\)/)
  assert.match(main, /feedback\.scoreMultiplier/)
})

test('gameplay header keeps Score, centered NawrasEdu asset, and Time', () => {
  assert.equal(WORDMARK_ASSET, 'assets/nawras-name.png')
  const header = html.match(/<header class="hud">([\s\S]*?)<\/header>/)?.[1]
  assert.ok(header)
  assert.ok(header.indexOf('id="score"') < header.indexOf('id="hud-wordmark"'))
  assert.ok(header.indexOf('id="hud-wordmark"') < header.indexOf('id="timer"'))
  assert.match(header, /id="status"/)
  assert.match(main, /hudWordmark\.src = assets\.images\.get\('wordmark'\)\.src/)
  assert.match(css, /\.hud-stats[^}]*left: 50%; transform: translateX\(-50%\)/)
  assert.match(css, /\.hud-wordmark[^}]*object-fit: contain/)
  assert.match(css, /grid-template-columns: var\(--hud-card-width\) var\(--hud-logo-width\) var\(--hud-card-width\)/)
  assert.match(css, /align-items: center; column-gap: var\(--hud-gap\)/)
  assert.match(css, /\.hud-stat\s*\{[^}]*align-items: center;[^}]*justify-content: center;/)
})

test('major callouts exit after their existing visible duration, then hide', () => {
  for (const [kind, fadeMs] of Object.entries({ go: 400, 'web-rush': 400, finale: 450 })) {
    assert.equal(CALLOUT_EXIT_MS[kind], fadeMs)
    assert.equal(calloutPhaseAt(999, 1000, kind), 'visible')
    assert.equal(calloutPhaseAt(1000, 1000, kind), 'exiting')
    assert.equal(calloutPhaseAt(1000 + fadeMs - 1, 1000, kind), 'exiting')
    assert.equal(calloutPhaseAt(1000 + fadeMs, 1000, kind), 'hidden')
  }
  assert.equal(calloutPhaseAt(1000, 1000, 'countdown-1'), 'hidden')
  assert.match(main, /showCallout\('START!', now, 820, 'go'\)/)
  assert.match(main, /showCallout\('WEB RUSH!', now, WEB_RUSH_CONFIG\.announcementMs, 'web-rush'\)/)
  assert.match(main, /showCallout\('FINAL 15', now, 950, 'finale'\)/)
  assert.match(css, /\.state-callout\.exiting[^}]*opacity: 0;[^}]*scale\(0\.97\)/)
  assert.match(css, /\.state-callout\.exiting\[data-kind="finale"\][^}]*450ms/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.state-callout\.exiting \{ transform: translateX\(-50%\); \}/)
  assert.match(main, /stateCallout\.hidden = true\s+stateCallout\.classList\.remove\('exiting'\)/)
})

test('Sound toggle remains in hidden Debug and is absent from production controls', () => {
  const debug = html.match(/<aside id="debug-panel"[^>]*hidden>([\s\S]*?)<\/aside>/)?.[1]
  const controls = html.match(/<footer class="controls">([\s\S]*?)<\/footer>/)?.[1]
  assert.ok(debug)
  assert.ok(controls)
  assert.match(debug, /id="sound-toggle"/)
  assert.doesNotMatch(controls, /sound-toggle/)
  assert.match(main, /soundButton\.addEventListener\('click'/)
})

test('decorations are noninteractive and light sweep respects reduced motion', () => {
  assert.match(html, /class="top-decoration edge-decoration" aria-hidden="true"/)
  assert.match(html, /class="bottom-decoration edge-decoration" aria-hidden="true"/)
  assert.match(css, /\.edge-decoration[^}]*pointer-events: none/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.edge-sweep \{ animation: none; \}/)
})
