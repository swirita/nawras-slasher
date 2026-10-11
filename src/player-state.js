// Existing processor reset APIs own their private histories and prediction state.
export function resetPlayerTracking({ finger, hand, slash }) {
  finger.reset()
  hand.reset()
  slash.reset()
}
