import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ambientParticleSpec, populateReadyAmbient,
  READY_AMBIENT_COUNT } from '../src/ready-ambient.js'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')

test('ambient particle parameters remain small, faint, and slow', () => {
  for (const sample of [0, 0.5, 0.999999]) {
    const spec = ambientParticleSpec(6, () => sample)
    assert.ok(spec.size >= 2 && spec.size <= 5)
    assert.ok(spec.speed >= 10 && spec.speed <= 30)
    assert.ok(spec.durationMs >= 6000 && spec.durationMs <= 12_000)
    assert.ok(spec.opacity >= 0 && spec.opacity <= 0.42)
    assert.ok(spec.streakLength >= 8 && spec.streakLength <= 16)
  }
})

test('READY ambience builds one fixed pool with a few micro-streaks', () => {
  const nodes = []
  const doc = {
    createDocumentFragment: () => ({ append: (node) => nodes.push(node) }),
    createElement: () => ({ className: '', style: { setProperty: () => {} } }),
  }
  const container = { ownerDocument: doc, replaceChildren: () => {} }
  populateReadyAmbient(container, () => 0.5)
  assert.equal(READY_AMBIENT_COUNT, 26)
  assert.equal(nodes.length, 26)
  assert.equal(nodes.filter((node) => node.className.includes('ambient-streak')).length, 3)
})

test('ambient layer runs only on name-entry READY and respects motion and tab visibility', () => {
  assert.match(html, /id="ready-ambient" class="ready-ambient" aria-hidden="true"/)
  assert.match(css, /\.ready-ambient[^}]*overflow: hidden; pointer-events: none;/)
  assert.match(css, /\.app\[data-phase="READY"\]\.needs-player \.ready-ambient \{ display: block; \}/)
  assert.match(css, /\.ready-brand[^}]*z-index: 4;/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.app\[data-phase="READY"\]\.needs-player \.ready-ambient \{ display: none; \}/)
  assert.match(css, /\.app\.ambient-paused \.ambient-particle \{ animation-play-state: paused; \}/)
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.ambient-particle:nth-child\(n \+ 15\)/)
  assert.match(css, /@media \(min-width: 701px\) and \(max-width: 1100px\)[\s\S]*?\.ambient-particle:nth-child\(n \+ 21\)/)
  assert.match(main, /populateReadyAmbient\(readyAmbient\)/)
  assert.match(main, /app\.dataset\.phase = game\.state\.phase/)
  assert.match(main, /app\.classList\.toggle\('needs-player', !player\)/)
  assert.match(main, /app\.classList\.toggle\('ambient-paused', document\.hidden\)/)
})
