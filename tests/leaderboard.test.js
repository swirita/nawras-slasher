import test from 'node:test'
import assert from 'node:assert/strict'
import { createLeaderboard, normalizePlayerName, LEADERBOARD_STORAGE_KEY,
  MAX_PLAYER_NAME_LENGTH, rankEntries } from '../src/leaderboard.js'

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
    removeItem(key) { values.delete(key) },
  }
}

test('names trim and collapse whitespace, compare without case, and keep display case', () => {
  assert.deepEqual(normalizePlayerName(' Siwar '), { id: 'siwar', name: 'Siwar' })
  assert.deepEqual(normalizePlayerName('SIWAR'), { id: 'siwar', name: 'SIWAR' })
  assert.deepEqual(normalizePlayerName('siwar'), { id: 'siwar', name: 'siwar' })
  assert.deepEqual(normalizePlayerName('  Mariam   Noor  '),
    { id: 'mariam noor', name: 'Mariam Noor' })
  assert.equal(normalizePlayerName(' \n\t '), null)
  assert.equal(normalizePlayerName(null), null)
  assert.equal(MAX_PLAYER_NAME_LENGTH, 16)
  assert.equal([...normalizePlayerName('abcdefghijklmnopqr').name].length, 16)
})


test('score, combo, competition ranks and stable fully tied order', () => {
 const board=createLeaderboard({storage:fakeStorage(),now:()=>10})
 for(const [id,score,combo] of [['a',900,2],['b',500,5],['c',500,3],['d',500,3],['e',400,2],['f',400,2],['g',300,4]]) board.recordCompletedScore('Same Name',score,combo,id)
 assert.deepEqual(board.ranked().map(e=>[e.id,e.rank]),[['a',1],['b',2],['c',3],['d',3],['e',5],['f',5],['g',7]])
 assert.equal(board.top().length,6)
 assert.equal(board.rank({id:'f'}),5)
 assert.deepEqual(rankEntries([{id:'a',bestScore:5,bestCombo:2,bestAt:10},{id:'b',bestScore:5,bestCombo:2,bestAt:1}]).map(e=>[e.id,e.rank]),[['b',1],['a',1]])
 assert.deepEqual(rankEntries([900,500,500,100].map((score,i)=>({id:String(i),bestScore:score,bestCombo:2,bestAt:i}))).map(e=>e.rank),[1,2,2,4])
})
test('all rounds persist, including duplicate names and more than 100 records', () => {
 const storage=fakeStorage({otherApp:'keep me'})
 const board=createLeaderboard({storage,now:()=>10})
 for(let i=0;i<140;i++) board.recordCompletedScore('Lina',i,3,'round-'+i)
 board.recordCompletedScore('Lina',139,3,'round-139')
 assert.equal(board.all().length,140)
 const reloaded=createLeaderboard({storage})
 assert.equal(reloaded.best('LINA'),139)
 assert.equal(reloaded.all().length,140)
 assert.equal(new Set(reloaded.all().map(e=>e.id)).size,140)
 assert.equal(reloaded.all()[0].bestCombo,3)
 reloaded.clear()
 assert.equal(storage.getItem(LEADERBOARD_STORAGE_KEY),null)
 assert.equal(storage.getItem('otherApp'),'keep me')
})
test('legacy records retain scores, missing combos sort as zero and migrated IDs persist', () => {
 const storage=fakeStorage({[LEADERBOARD_STORAGE_KEY]:JSON.stringify([
 {name:'Lina',bestScore:500,bestAt:1}, {name:'Lina',bestScore:500,bestAt:1},
 {id:'new',name:'Lina',bestScore:500,bestCombo:2,bestAt:3}, null, {name:'bad',bestScore:-2}
 ])})
 const board=createLeaderboard({storage})
 assert.equal(board.all().length,3)
 assert.deepEqual(board.ranked().map(e=>e.rank),[1,2,2])
 assert.equal(board.all()[1].bestCombo,null)
 assert.deepEqual(createLeaderboard({storage}).all(),board.all())
})
test('invalid input and blocked storage remain safe', () => {
 const board=createLeaderboard({storage:{getItem(){throw Error()},setItem(){throw Error()},removeItem(){throw Error()}}})
 assert.equal(board.recordCompletedScore(' ',1),null)
 assert.equal(board.recordCompletedScore('Lina',Infinity),null)
 assert.equal(board.recordCompletedScore('Lina',500,5).rank,1)
 board.clear()
 assert.deepEqual(board.all(),[])
 assert.deepEqual(createLeaderboard({storage:fakeStorage({[LEADERBOARD_STORAGE_KEY]:'{bad'})}).all(),[])
})
