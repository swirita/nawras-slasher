export const LEADERBOARD_STORAGE_KEY = 'nawrasSlasherLeaderboard'
export const MAX_PLAYER_NAME_LENGTH = 16
export const MAX_STORED_PLAYERS = 100
export const TOP_PLAYER_COUNT = 5

export function normalizePlayerName(value) {
  if (typeof value !== 'string') return null
  const name = [...value.trim().replace(/\s+/gu, ' ')].slice(0, MAX_PLAYER_NAME_LENGTH).join('')
  return name ? { id: name.toLowerCase(), name } : null
}

const validScore = (value) => typeof value === 'number'
  && Number.isFinite(value) && value >= 0
const validTime = (value) => typeof value === 'number'
  && Number.isFinite(value) && value >= 0

function compareEntries(a, b) {
  if (a.bestScore !== b.bestScore) return b.bestScore - a.bestScore
  if (a.bestAt !== b.bestAt) return a.bestAt - b.bestAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function cleanEntries(raw) {
  if (!Array.isArray(raw)) return []
  const unique = new Map()
  for (const item of raw) {
    const player = normalizePlayerName(item?.name)
    if (!player || !validScore(item?.bestScore)) continue
    const entry = { ...player, bestScore: item.bestScore,
      bestAt: validTime(item?.bestAt) ? item.bestAt : Number.MAX_SAFE_INTEGER }
    const old = unique.get(player.id)
    if (!old || compareEntries(entry, old) < 0) unique.set(player.id, entry)
  }
  return [...unique.values()].sort(compareEntries).slice(0, MAX_STORED_PLAYERS)
}

export function createLeaderboard({ storage, now = Date.now } = {}) {
  let backend = null
  try { backend = storage === undefined ? globalThis.localStorage : storage } catch { /* memory only */ }
  let entries = []
  try {
    const saved = backend?.getItem(LEADERBOARD_STORAGE_KEY)
    if (saved) entries = cleanEntries(JSON.parse(saved))
  } catch { /* malformed or blocked storage starts with an empty leaderboard */ }

  function persist() {
    try { backend?.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(entries)) } catch { /* memory only */ }
  }

  function all() { return entries.map((entry) => ({ ...entry })) }
  function top() { return all().slice(0, TOP_PLAYER_COUNT) }
  function find(player) {
    const id = typeof player === 'string' ? normalizePlayerName(player)?.id : player?.id
    return entries.find((entry) => entry.id === id) ?? null
  }
  function best(player) { return find(player)?.bestScore ?? null }
  function rank(player) {
    const entry = find(player)
    return entry ? entries.indexOf(entry) + 1 : null
  }

  function recordCompletedScore(player, score) {
    const normalized = normalizePlayerName(player?.name ?? player)
    if (!normalized || !validScore(score)) return null
    const previous = find(normalized)
    const previousBest = previous?.bestScore ?? null
    const status = previousBest === null ? 'first'
      : score > previousBest ? 'improved' : 'unchanged'
    if (status !== 'unchanged') {
      const timestamp = now()
      const entry = { id: normalized.id, name: previous?.name ?? normalized.name,
        bestScore: score, bestAt: validTime(timestamp) ? timestamp : Date.now() }
      entries = cleanEntries([...entries.filter((item) => item.id !== normalized.id), entry])
      persist()
    }
    const currentRank = rank(normalized)
    return { status, previousBest, bestScore: best(normalized) ?? score,
      rank: currentRank, inTop5: currentRank !== null && currentRank <= TOP_PLAYER_COUNT }
  }

  function clear() {
    entries = []
    try { backend?.removeItem(LEADERBOARD_STORAGE_KEY) } catch { /* memory remains clear */ }
  }

  return { all, top, best, rank, recordCompletedScore, clear }
}
