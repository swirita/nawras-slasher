// Six small reusable textures replace gradients rasterized during every frame.
const SPECS = {
  'bug-base': [.127, [[0, 'rgba(230,35,45,.07)'], [.58, 'rgba(230,35,45,.09)'], [.82, 'rgba(230,35,45,.155)'], [1, 'rgba(230,35,45,0)']]],
  'bug-pulse': [.127, [[0, 'rgba(230,35,45,0)'], [.58, 'rgba(230,35,45,0)'], [.82, 'rgba(230,35,45,.05)'], [1, 'rgba(230,35,45,0)']]],
  'bug-hit': [.127, [[0, 'rgba(230,35,45,.40)'], [.58, 'rgba(230,35,45,.48)'], [.82, 'rgba(230,35,45,.42)'], [1, 'rgba(230,35,45,0)']]],
  'golden-base': [.18, [[0, 'rgba(255,249,209,.48)'], [.28, 'rgba(255,210,88,.40)'], [.68, 'rgba(191,116,20,.19)'], [1, 'rgba(148,81,14,0)']]],
  'golden-shimmer': [.18, [[0, 'rgba(255,249,209,.27)'], [.28, 'rgba(255,210,88,.2)'], [.68, 'rgba(255,210,88,0)'], [1, 'rgba(255,210,88,0)']]],
  'golden-hit': [0, [[0, 'rgba(255,254,226,.72)'], [.5, 'rgba(255,216,99,.33)'], [1, 'rgba(255,196,53,0)']]],
}

export function createGlowCache(createCanvas = () => document.createElement('canvas')) {
  const cache = new Map()
  for (const [name, [inner, stops]] of Object.entries(SPECS)) {
    const canvas = createCanvas()
    canvas.width = canvas.height = 512
    const context = canvas.getContext('2d')
    const gradient = context.createRadialGradient(256,256,256*inner,256,256,256)
    for (const [at,color] of stops) gradient.addColorStop(at,color)
    context.fillStyle = gradient
    context.fillRect(0,0,512,512)
    cache.set(name,canvas)
  }
  return cache
}

export function drawGlow(context, cache, name, x, y, radius, strength = 1) {
  if (strength <= 0) return
  const alpha = context.globalAlpha
  context.globalAlpha = alpha * strength
  context.drawImage(cache.get(name),x-radius,y-radius,radius*2,radius*2)
  context.globalAlpha = alpha
}
