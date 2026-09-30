// Existing processor reset APIs own their private histories and prediction state.
export function resetPlayerTracking({ finger, hand, slash, rawTrail, anchorTrail }) {
  finger.reset()
  hand.reset()
  slash.reset()
  rawTrail.length = 0
  anchorTrail.length = 0
}
