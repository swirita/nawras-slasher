// Paths are relative to Vite's public directory. We keep the source artwork intact.
export const WORDMARK_ASSET = 'assets/nawras-name.png'
export const GOLDEN_ASSET = 'assets/nawras-small.png'

export const TECH_TARGETS = Object.freeze([
  { id: 'python', label: 'Python', asset: 'assets/Python-logo.svg.webp', basePoints: 10, weight: 15, visualScale: 1 },
  { id: 'java', label: 'Java', asset: 'assets/java-logo.webp', basePoints: 10, weight: 13, visualScale: 1.12 },
  { id: 'javascript', label: 'JavaScript', asset: 'assets/js.webp', basePoints: 10, weight: 15, visualScale: 1 },
  { id: 'html', label: 'HTML', asset: 'assets/html-logo.png', basePoints: 10, weight: 13, visualScale: 1.04 },
  { id: 'css', label: 'CSS', asset: 'assets/CSS3_logo.svg.webp', basePoints: 10, weight: 13, visualScale: 1.04 },
  { id: 'git', label: 'Git', asset: 'assets/Git_icon.svg.webp', basePoints: 15, weight: 9, visualScale: 1 },
  { id: 'react', label: 'React', asset: 'assets/React-icon.svg.webp', basePoints: 15, weight: 9, visualScale: 1.04 },
  { id: 'mysql', label: 'MySQL', asset: 'assets/mysql.png', basePoints: 15, weight: 8, visualScale: 1.12 },
  { id: 'openai', label: 'OpenAI', asset: 'assets/OpenAI_logo_2025_(symbol).svg.webp', basePoints: 20, weight: 5, visualScale: 1 },
].map((target) => Object.freeze(target)))

export const TECH_TARGET_BY_ID = new Map(TECH_TARGETS.map((target) => [target.id, target]))
export const REQUIRED_ASSETS = Object.freeze([
  { id: 'wordmark', asset: WORDMARK_ASSET },
  { id: 'golden', asset: GOLDEN_ASSET },
  ...TECH_TARGETS.map(({ id, asset }) => ({ id, asset })),
])

export function selectWeightedTech(random = Math.random, excludedIds = []) {
  const excluded = new Set(excludedIds)
  const eligible = TECH_TARGETS.filter((target) => !excluded.has(target.id))
  if (!eligible.length) return null
  const total = eligible.reduce((sum, target) => sum + target.weight, 0)
  let roll = Math.max(0, Math.min(0.999999999, random())) * total
  for (const target of eligible) {
    roll -= target.weight
    if (roll < 0) return target
  }
  return eligible.at(-1)
}
