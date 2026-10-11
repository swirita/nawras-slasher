export const READY_AMBIENT_COUNT = 26

const COLORS = ['#168fb2', '#2aa7c7', '#268ab8', '#43b7d1']

export function ambientParticleSpec(index, random = Math.random) {
  const unit = () => Math.min(0.999999, Math.max(0, random()))
  const depth = unit()
  const x = 4 + unit() * 92
  const y = 5 + unit() * 90
  const size = 2 + 3 * depth * depth
  const speed = 10 + 17 * depth + 3 * unit()
  const durationMs = 6000 + 6000 * unit()
  const travel = speed * durationMs / 1000
  const angle = (unit() - 0.5) * 1.4
  const center = x > 30 && x < 70 && y > 25 && y < 75
  return {
    x, y, size, speed, durationMs,
    dx: Math.sin(angle) * travel,
    dy: -Math.cos(angle) * travel,
    opacity: (0.16 + 0.22 * depth + 0.04 * unit()) * (center ? 0.45 : 1),
    delayMs: -durationMs * unit(),
    streak: index % 8 === 6,
    streakLength: 8 + unit() * 8,
    color: COLORS[Math.floor(unit() * COLORS.length)],
  }
}

export function populateReadyAmbient(container, random = Math.random) {
  const doc = container.ownerDocument
  const fragment = doc.createDocumentFragment()
  for (let index = 0; index < READY_AMBIENT_COUNT; index += 1) {
    const spec = ambientParticleSpec(index, random)
    const particle = doc.createElement('span')
    particle.className = spec.streak ? 'ambient-particle ambient-streak' : 'ambient-particle'
    particle.style.setProperty('--ambient-x', `${spec.x}%`)
    particle.style.setProperty('--ambient-y', `${spec.y}%`)
    particle.style.setProperty('--ambient-size', `${spec.size}px`)
    particle.style.setProperty('--ambient-alpha', String(spec.opacity))
    particle.style.setProperty('--ambient-dx', `${spec.dx}px`)
    particle.style.setProperty('--ambient-dy', `${spec.dy}px`)
    particle.style.setProperty('--ambient-duration', `${spec.durationMs}ms`)
    particle.style.setProperty('--ambient-delay', `${spec.delayMs}ms`)
    particle.style.setProperty('--ambient-streak-length', `${spec.streakLength}px`)
    particle.style.setProperty('--ambient-color', spec.color)
    fragment.append(particle)
  }
  container.replaceChildren(fragment)
}
