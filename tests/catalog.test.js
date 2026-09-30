import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import {
  TECH_TARGETS, TECH_TARGET_BY_ID, REQUIRED_ASSETS, GOLDEN_ASSET, WORDMARK_ASSET,
  selectWeightedTech,
} from '../src/catalog.js'
import { createTargetSystem, GOLDEN_TARGET_CHANCE, GOLDEN_ELIGIBLE_AFTER_MS } from '../src/targets.js'
import { containedImageRect, sliceClipPolygon } from '../src/rendering.js'

const expected = {
  python: [10, 15], java: [10, 13], javascript: [10, 15], html: [10, 13],
  css: [10, 13], git: [15, 9], react: [15, 9], mysql: [15, 8], openai: [20, 5],
}

test('the nine tech definitions carry the configured scores, weights, and local asset paths', () => {
  assert.deepEqual(TECH_TARGETS.map(({ id }) => id), Object.keys(expected))
  for (const definition of TECH_TARGETS) {
    assert.deepEqual([definition.basePoints, definition.weight], expected[definition.id])
    assert.ok(definition.weight > 0)
    assert.ok(definition.visualScale > 0)
    assert.ok(definition.asset.startsWith('assets/'))
    assert.equal(TECH_TARGET_BY_ID.get(definition.id), definition)
  }
  assert.equal(TECH_TARGET_BY_ID.has('golden'), false)
  assert.equal(TECH_TARGET_BY_ID.has('nawras'), false)
  assert.deepEqual(REQUIRED_ASSETS.map(({ id }) => id),
    ['wordmark', 'golden', ...Object.keys(expected)])
  assert.ok(REQUIRED_ASSETS.some(({ asset }) => asset === GOLDEN_ASSET))
  assert.ok(REQUIRED_ASSETS.some(({ asset }) => asset === WORDMARK_ASSET))
  for (const { asset } of REQUIRED_ASSETS) {
    assert.equal(existsSync(new URL(`../public/${asset}`, import.meta.url)), true, asset)
  }
})

test('weighted selection stays within eligible technologies and respects exclusions', () => {
  for (let index = 0; index <= 100; index += 1) {
    const selected = selectWeightedTech(() => index / 100)
    assert.ok(TECH_TARGET_BY_ID.has(selected.id))
  }
  assert.equal(selectWeightedTech(() => 0).id, 'python')
  assert.notEqual(selectWeightedTech(() => 0, ['python']).id, 'python')
  assert.equal(selectWeightedTech(() => 0, TECH_TARGETS.map(({ id }) => id)), null)
})

test('automatic tech can repeat twice but never three times, and reset clears that history', () => {
  const targets = createTargetSystem(() => 0)
  const first = targets.spawn(600, 500, 0)
  const second = targets.spawn(600, 500, 1)
  const third = targets.spawn(600, 500, 2)
  assert.equal(first.catalogId, 'python')
  assert.equal(second.catalogId, 'python')
  assert.notEqual(third.catalogId, 'python')
  targets.reset()
  assert.equal(targets.spawn(600, 500, 3).catalogId, 'python')
})

test('one wave can exclude already spawned identities without changing the golden rule', () => {
  const targets = createTargetSystem(() => 0)
  const chosen = []
  for (let index = 0; index < 3; index += 1) {
    const target = targets.spawn(600, 500, index, { excludedIds: chosen })
    chosen.push(target.catalogId)
  }
  assert.equal(new Set(chosen).size, 3)
  assert.equal(GOLDEN_TARGET_CHANCE, 0.03)
  assert.equal(GOLDEN_ELIGIBLE_AFTER_MS, 9000)
  const golden = targets.spawn(600, 500, 9000, { elapsedMs: 9000 })
  assert.equal(golden.kind, 'golden')
  assert.equal(golden.catalogId, 'golden')
  assert.equal(golden.basePoints, 50)
})

test('arbitrary logo dimensions retain aspect ratio in whole and clipped slice rendering', () => {
  const square = containedImageRect(960, 960, 48, 1)
  const tall = containedImageRect(256, 512, 48, 1.12)
  const wide = containedImageRect(800, 400, 48, 1)
  assert.equal(square.width, square.height)
  assert.equal(tall.width / tall.height, 0.5)
  assert.equal(wide.width / wide.height, 2)
  assert.ok(tall.height > square.height)
  const target = { x: 200, y: 120, radius: 48,
    hitTangent: { x: 0, y: 1 }, hitDirection: { x: 1, y: 0 } }
  const left = sliceClipPolygon(target, -1)
  const right = sliceClipPolygon(target, 1)
  assert.deepEqual(left.slice(0, 2), right.slice(0, 2))
  assert.ok(left[2].x < target.x)
  assert.ok(right[2].x > target.x)
})
