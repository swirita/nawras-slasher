import { segmentIntersectsCircle } from './geometry.js'
import { selectWeightedTech, TECH_TARGET_BY_ID } from './catalog.js'

export const MAX_ACTIVE_TARGETS = 5
export const GRAVITY_PX_PER_S2 = 1050
export const MAX_PHYSICS_DT_S = 0.05
export const HIT_EFFECT_MS = 320
export const GOLDEN_HIT_EFFECT_MS = 480
export const NORMAL_SLASH_HIT_RADIUS = 24
export const FAST_SLASH_HIT_RADIUS = 40
export const PREDICTED_SLASH_HIT_RADIUS = 50

export const GOLDEN_TARGET_CHANCE = 0.03
export const GOLDEN_ELIGIBLE_AFTER_MS = 9000
const MAX_TARGET_AGE_MS = 5000

// These CSS-pixel margins affect collision only. Rendering uses the segment's
// unchanged endpoints, so the visual slash never snaps toward a target.
export function collisionProfileForSegment(segment) {
  if (!segment?.activeSlash) return null
  if (segment.predicted) return { mode: 'PREDICTED', radius: PREDICTED_SLASH_HIT_RADIUS }
  if (segment.collisionMode === 'FAST') return { mode: 'FAST', radius: FAST_SLASH_HIT_RADIUS }
  return { mode: 'NORMAL', radius: NORMAL_SLASH_HIT_RADIUS }
}

export function createTargetSystem(random = Math.random) {
  const state = { targets: [], hits: 0, lastHit: null, lastCollision: null }
  let nextId = 1
  let lastAutomaticTechId = null
  let automaticRepeatCount = 0

  function activeCount() {
    let count = 0
    for (const target of state.targets) if (!target.sliced) count += 1
    return count
  }

  function spawn(width, height, now, options = {}) {
    const { predictable = false, speedScale = 1, activeLimit = MAX_ACTIVE_TARGETS, lanePosition = null,
      kind = null, catalogId = null, excludedIds = [], elapsedMs = 0 } = options
    if (width <= 0 || height <= 0 || activeCount() >= Math.min(MAX_ACTIVE_TARGETS, activeLimit)) return null

    const isGolden = kind === 'golden' || (!kind && !catalogId && !predictable
      && elapsedMs >= GOLDEN_ELIGIBLE_AFTER_MS && random() < GOLDEN_TARGET_CHANCE)
    const definition = isGolden ? null : catalogId
      ? TECH_TARGET_BY_ID.get(catalogId)
      : selectWeightedTech(random, [
        ...excludedIds,
        ...(automaticRepeatCount >= 2 ? [lastAutomaticTechId] : []),
      ])
    if (!isGolden && !definition) return null

    const id = nextId++
    const radius = Math.max(38, Math.min(60, Math.min(width, height) * 0.08))
    const x = predictable
      ? width / 2
      : width * (lanePosition === null ? 0.14 + random() * 0.72 : 0.17 + lanePosition * 0.66)
    const gravity = GRAVITY_PX_PER_S2 * Math.max(1, speedScale ** 2)
    const drift = predictable ? 0 : ((random() - 0.5) * 190 + (0.5 - x / width) * 65) * speedScale
    const target = {
      id,
      x,
      y: height + radius,
      vx: predictable ? 0 : Math.max(-width * 0.26, Math.min(width * 0.26, drift)),
      // Faster late targets rise/fall faster, while gravity keeps their apex in view.
      vy: -Math.sqrt(2 * gravity * height * (predictable ? 0.68 : 0.53 + random() * 0.23))
        * Math.min(1, speedScale),
      gravity,
      rotation: predictable ? 0 : (random() - 0.5) * 0.24,
      angularVelocity: predictable ? 0 : (random() - 0.5) * 0.5,
      radius,
      sliced: false,
      slicedAt: null,
      createdAt: now,
      kind: isGolden ? 'golden' : 'normal',
      catalogId: isGolden ? 'golden' : definition.id,
      basePoints: isGolden ? 50 : definition.basePoints,
      visualScale: isGolden ? 1 : definition.visualScale,
    }
    if (!predictable && !catalogId && !kind) {
      if (isGolden) {
        lastAutomaticTechId = null
        automaticRepeatCount = 0
      } else {
        automaticRepeatCount = definition.id === lastAutomaticTechId ? automaticRepeatCount + 1 : 1
        lastAutomaticTechId = definition.id
      }
    }
    target.effectSeed = target.kind === 'golden' ? random() : 0
    state.targets.push(target)
    return target
  }

  function update(dtSeconds, now, width, height) {
    const dt = Math.max(0, Math.min(dtSeconds, MAX_PHYSICS_DT_S))
    for (const target of state.targets) {
      if (target.sliced) continue
      target.x += target.vx * dt
      target.y += target.vy * dt
      target.vy += target.gravity * dt
      target.rotation += target.angularVelocity * dt
    }

    let write = 0
    for (const target of state.targets) {
      const visible = target.sliced
        ? now - target.slicedAt < (target.kind === 'golden' ? GOLDEN_HIT_EFFECT_MS : HIT_EFFECT_MS)
        : now - target.createdAt <= MAX_TARGET_AGE_MS
          && target.x >= -target.radius && target.x <= width + target.radius
          && !(target.vy > 0 && target.y > height + target.radius)
      if (visible) state.targets[write++] = target
    }
    state.targets.length = write
  }

  function hitWithSegment(segment, now) {
    // A slow move produces no active slash segment; it must never hit a target.
    const profile = collisionProfileForSegment(segment)
    if (!profile) return []
    state.lastCollision = { ...profile, at: now }

    const hitTargets = []
    for (const target of state.targets) {
      if (target.sliced) continue
      if (!segmentIntersectsCircle(
        segment.from.x, segment.from.y,
        segment.to.x, segment.to.y,
        target.x, target.y, target.radius + profile.radius,
      )) continue

      target.sliced = true // Immediately prevents duplicate hits.
      target.slicedAt = now
      state.hits += 1
      state.lastHit = {
        targetId: target.id,
        catalogId: target.catalogId,
        segmentType: segment.predicted ? 'PREDICTED' : segment.bridged ? 'BRIDGED' : 'NORMAL',
      }
      hitTargets.push(target)
    }
    return hitTargets
  }

  function clearTargets() {
    state.targets = []
  }

  function reset() {
    clearTargets()
    state.hits = 0
    state.lastHit = null
    state.lastCollision = null
    nextId = 1
    lastAutomaticTechId = null
    automaticRepeatCount = 0
  }

  return { state, spawn, update, hitWithSegment, activeCount, clearTargets, reset }
}
