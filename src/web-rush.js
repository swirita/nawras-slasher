import { TECH_TARGETS, selectWeightedTech } from './catalog.js'

export const WEB_TARGET_IDS = Object.freeze(['html', 'css', 'javascript', 'react'])
export const WEB_RUSH_CONFIG = Object.freeze({
  triggerElapsedMs: 45000,
  durationMs: 6000,
  spawnIntervalMs: 950,
  webProbability: 0.90,
  singleProbability: 0.30,
  pairProbability: 0.50,
  tripleProbability: 0.20,
  announcementMs: 900,
})

const WEB_ID_SET = new Set(WEB_TARGET_IDS)
const OTHER_TARGET_IDS = TECH_TARGETS.map(({ id }) => id).filter((id) => !WEB_ID_SET.has(id))

export function selectWebRushTech(random = Math.random, excludedIds = []) {
  const excluded = new Set(excludedIds)
  const webAvailable = WEB_TARGET_IDS.some((id) => !excluded.has(id))
  const otherAvailable = OTHER_TARGET_IDS.some((id) => !excluded.has(id))
  if (!webAvailable && !otherAvailable) return null
  const favorWeb = random() < WEB_RUSH_CONFIG.webProbability
  const useWeb = webAvailable && (favorWeb || !otherAvailable)
  const poolToExclude = useWeb ? OTHER_TARGET_IDS : WEB_TARGET_IDS
  return selectWeightedTech(random, [...excluded, ...poolToExclude])
}

export function spawnProfileFor(difficulty, webRushActive, maxActiveTargets) {
  if (!webRushActive) return difficulty
  return {
    ...difficulty,
    spawnIntervalMs: WEB_RUSH_CONFIG.spawnIntervalMs,
    singleProbability: WEB_RUSH_CONFIG.singleProbability,
    pairProbability: WEB_RUSH_CONFIG.pairProbability,
    tripleProbability: WEB_RUSH_CONFIG.tripleProbability,
    activeLimit: maxActiveTargets,
  }
}

export function groupSizeForRoll(roll, profile) {
  if (profile.singleProbability !== undefined) {
    if (roll < profile.singleProbability) return 1
    if (roll < profile.singleProbability + profile.pairProbability) return 2
    return 3
  }
  // Preserve the normal scheduler's existing triple-first roll semantics.
  if (roll < profile.tripleProbability) return 3
  if (roll < profile.tripleProbability + profile.pairProbability) return 2
  return 1
}
