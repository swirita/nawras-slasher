// All inputs use CSS pixel coordinates in the mirrored camera stage.
export function segmentIntersectsCircle(x1, y1, x2, y2, cx, cy, radius) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / lengthSquared))
  const closestX = x1 + projection * dx
  const closestY = y1 + projection * dy
  const distanceX = cx - closestX
  const distanceY = cy - closestY
  return distanceX * distanceX + distanceY * distanceY <= radius * radius
}

// Mirrors a normalized camera point after CSS object-fit: cover crops the video.
export function cameraPointToDisplay(x, y, sourceWidth, sourceHeight, displayWidth, displayHeight) {
  if (!sourceWidth || !sourceHeight || !displayWidth || !displayHeight) return null
  const scale = Math.max(displayWidth / sourceWidth, displayHeight / sourceHeight)
  const scaledWidth = sourceWidth * scale
  const scaledHeight = sourceHeight * scale
  const cropX = (scaledWidth - displayWidth) / 2
  const cropY = (scaledHeight - displayHeight) / 2
  return {
    x: (1 - x) * scaledWidth - cropX,
    y: y * scaledHeight - cropY,
  }
}
