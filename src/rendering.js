// Target positions, image bounds, and collision radii all use canvas CSS pixels.
// One contained rectangle is reused for the whole image and both clipped halves.
export function containedImageRect(imageWidth, imageHeight, radius, visualScale = 1) {
  if (imageWidth <= 0 || imageHeight <= 0 || radius <= 0) return null
  const diameter = radius * 2 * visualScale
  const aspect = imageWidth / imageHeight
  const width = aspect >= 1 ? diameter : diameter * aspect
  const height = aspect >= 1 ? diameter / aspect : diameter
  return { x: -width / 2, y: -height / 2, width, height }
}

export function sliceClipPolygon(target, side) {
  const tangent = target.hitTangent ?? { x: 0, y: 1 }
  const normal = target.hitDirection ?? { x: 1, y: 0 }
  const span = target.radius * 3
  const { x, y } = target
  return [
    { x: x - tangent.x * span, y: y - tangent.y * span },
    { x: x + tangent.x * span, y: y + tangent.y * span },
    { x: x + tangent.x * span + side * normal.x * span,
      y: y + tangent.y * span + side * normal.y * span },
    { x: x - tangent.x * span + side * normal.x * span,
      y: y - tangent.y * span + side * normal.y * span },
  ]
}
