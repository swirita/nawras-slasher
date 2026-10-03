export const LEADERBOARD_STORAGE_KEY = 'nawrasSlasherLeaderboard'
export const MAX_PLAYER_NAME_LENGTH = 16
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
const validId = (value) => typeof value === 'string' && value.trim().length > 0

export function createEntryId() {
 return globalThis.crypto?.randomUUID?.() ?? 'round-' + Date.now() + '-' + Math.random().toString(36).slice(2)
}
const combo = entry => entry.bestCombo ?? 0
function compareEntries(a,b) { return b.bestScore-a.bestScore || combo(b)-combo(a) || a.bestAt-b.bestAt }
export function rankEntries(entries) {
 let rank=0
 return [...entries].sort(compareEntries).map((entry,index,sorted) => {
  const prev=sorted[index-1]
  if (!prev || entry.bestScore!==prev.bestScore || combo(entry)!==combo(prev)) rank=index+1
  return {...entry,rank}
 })
}
function cleanEntries(raw) {
 if (!Array.isArray(raw)) return []
 const ids=new Set()
 return raw.flatMap(item => {
  const player=normalizePlayerName(item?.name)
  if (!player || !validScore(item?.bestScore)) return []
  let id=validId(item.id) ? item.id : createEntryId()
  if(ids.has(id)) id=createEntryId()
  ids.add(id)
  return [{id,name:player.name,bestScore:item.bestScore,
   bestCombo:Number.isInteger(item.bestCombo)&&item.bestCombo>=0 ? item.bestCombo : null,
   bestAt:validTime(item.bestAt)?item.bestAt:Number.MAX_SAFE_INTEGER}]
 }).sort(compareEntries)
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

  if (entries.length) {
    try { if (backend?.getItem(LEADERBOARD_STORAGE_KEY) !== JSON.stringify(entries)) persist() } catch { /* memory only */ }
  }

  function all() { return entries.map((entry) => ({ ...entry })) }
  function ranked() { return rankEntries(entries) }
  function top() { return ranked().filter(entry => entry.rank <= TOP_PLAYER_COUNT) }
  function find(player) {
    if (typeof player === 'string') {
      const normalized = normalizePlayerName(player)
      return entries.find((entry) => normalizePlayerName(entry.name)?.id === normalized?.id) ?? null
    }
    return entries.find((entry) => entry.id === player?.id) ?? null
  }
  function best(player) { return find(player)?.bestScore ?? null }
  function rank(player) {
    const entry = find(player)
    return entry ? ranked().find(row => row.id === entry.id).rank : null
  }
  function recordCompletedScore(player, score, bestCombo = null, entryId = createEntryId()) {
    const normalized = normalizePlayerName(player?.name ?? player)
    if (!normalized || !validScore(score)) return null
    const previousBest = best(normalized.name)
    const status = previousBest === null ? 'first' : score > previousBest ? 'improved' : 'unchanged'
    if (!entries.some(entry => entry.id === entryId)) {
      const timestamp = now()
      entries = cleanEntries([...entries, { id: entryId, name: normalized.name, bestScore: score,
        bestCombo, bestAt: validTime(timestamp) ? timestamp : Date.now() }])
      persist()
    }
    const currentRank = rank({id:entryId})
    return { id:entryId, status, previousBest, bestScore:best(normalized.name), rank:currentRank,
      inTop5:currentRank !== null && currentRank <= TOP_PLAYER_COUNT }
  }

  function clear() {
    entries = []
    try { backend?.removeItem(LEADERBOARD_STORAGE_KEY) } catch { /* memory remains clear */ }
  }

  return { all, ranked, top, best, rank, recordCompletedScore, clear }
}
