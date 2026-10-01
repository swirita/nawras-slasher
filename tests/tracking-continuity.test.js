import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createTrackingContinuity, CURSOR_GRACE_MS, INTERACTION_MAX_AGE_MS } from '../src/tracking-continuity.js'
import { createFingerProcessor } from '../src/tracking.js'
import { createHandMotionProcessor, handAnchorFromLandmarks, estimateFingerFromHand } from '../src/hand.js'
import { createSlashTracker, HAND_SLASH_START_SPEED, HAND_PREDICTION_MIN_DIRECTION_COSINE } from '../src/slash.js'
import { createTargetSystem } from '../src/targets.js'
import { cameraPointToDisplay } from '../src/geometry.js'

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const extract = name => main.match(new RegExp(`function ${name}\\([^]*?\\n}\\n`))[0]
function fixture(mode = 'HYBRID') {
  const continuity = createTrackingContinuity(), finger = createFingerProcessor()
  const hand = createHandMotionProcessor(), slash = createSlashTracker(), targets = createTargetSystem(() => .5)
  slash.setMotionSource(mode)
  let scores = 0
  const scope = { continuity, finger, hand, slash, targets, displayWidth: 1000, displayHeight: 750,
    displayDiagonal: 1250, video: {videoWidth:640,videoHeight:480}, rawTrail:[],anchorTrail:[],
    fingerDetected:false, rawFingerSpeed:0, performance:{now:()=>0}, setStatus(){},processGameEvents(){},
    game:{state:{phase:'PLAYING'},scoreTarget(){scores++}},
    cameraPointToDisplay,handAnchorFromLandmarks,estimateFingerFromHand,
    HAND_SLASH_START_SPEED,HAND_PREDICTION_MIN_DIRECTION_COSINE,INTERACTION_MAX_AGE_MS }
  const api = runInNewContext(extract('applySlashSegment') + extract('processResult') + '\n({processResult,applySlashSegment})', scope)
  function result(x=500,y=375) {
    const landmarks = Array.from({length:21},()=>({x:1-(x-40)/1000,y:y/750}))
    landmarks[8]={x:1-x/1000,y:y/750}
    return {landmarks:[landmarks]}
  }
  return { ...scope,...api,result,get scores(){return scores} }
}

test('80ms inference delay no longer makes every stationary-hand result disappear', () => {
  const f=fixture(), old=createSlashTracker()
  let before=0,after=0
  for(let i=0;i<20;i++) {
    const at=i*100,receivedAt=at+80
    old.detected({x:500,y:375},at,1250)
    old.tick(receivedAt)
    before+=Number(old.state.tracking==='DETECTED')
    f.processResult(f.result(),at,receivedAt)
    f.slash.tick(f.continuity.clock(receivedAt))
    after+=Number(f.continuity.tick(receivedAt).cursorVisible)
    assert.equal(f.continuity.state.detectionLosses,0)
    assert.equal(f.slash.state.tracking,'DETECTED')
  }
  assert.equal(before,0)
  assert.equal(after,20)
  assert.equal(f.scores,0)
})

test('a brief true no-hand result holds the cursor, but fresh collisions expire earlier', () => {
  const f=fixture()
  f.processResult(f.result(),0,20)
  f.processResult({landmarks:[]},50,70)
  assert.equal(f.continuity.state.detectionLosses,1)
  assert.equal(f.continuity.state.noHandResults,1)
  assert.equal(f.continuity.tick(100).cursorVisible,true)
  assert.equal(f.continuity.state.canCollide,true)
  assert.equal(f.continuity.tick(INTERACTION_MAX_AGE_MS+1).canCollide,false)
  assert.equal(f.continuity.state.cursorVisible,true)
  assert.equal(f.continuity.tick(CURSOR_GRACE_MS+1).cursorVisible,false)
})

test('late inference is distinct from model losses and cannot score an old segment', () => {
  const f=fixture('FINGER ONLY')
  f.processResult(f.result(100),0,20)
  const t=f.targets.spawn(1000,750,0,{predictable:true,catalogId:'python'})
  t.x=135;t.y=375
  f.processResult(f.result(200),50,190) // 140ms old: display allowed, collisions forbidden.
  assert.equal(f.continuity.tick(190).cursorVisible,true)
  assert.equal(f.scores,0)
  assert.equal(t.sliced,false)
  assert.equal(f.continuity.state.detectionLosses,0)
  f.processResult(f.result(300),100,251)
  assert.equal(f.continuity.state.staleResults,1)
  assert.equal(f.continuity.state.lastGoodAt,50)
})

test('resuming after even a brief hand exit seeds a new slice instead of crossing targets', () => {
  for(const mode of ['HYBRID','FINGER ONLY']) {
    const f=fixture(mode)
    f.processResult(f.result(100),0,20)
    f.processResult(f.result(150),50,70)
    f.processResult({landmarks:[]},75,95)
    const t=f.targets.spawn(1000,750,100,{predictable:true,catalogId:'python'})
    t.x=500;t.y=375
    f.processResult(f.result(800),100,120)
    assert.equal(f.scores,0,mode)
    assert.equal(t.sliced,false)
    assert.equal(f.slash.state.segments.length,0)
    assert.equal(f.slash.state.lastSpeed,0)
    assert.equal(f.continuity.state.reacquisitions,1)
  }
})

test('fresh deliberate slices retain normal collision behavior', () => {
  const f=fixture('FINGER ONLY')
  f.processResult(f.result(100),0,20)
  const t=f.targets.spawn(1000,750,0,{predictable:true,catalogId:'python'})
  t.x=125;t.y=375
  f.processResult(f.result(150),50,70)
  assert.equal(f.scores,1)
  assert.equal(t.sliced,true)
})

test('a newer hand result cannot authorize an older held segment', () => {
  const f=fixture()
  f.processResult(f.result(500),200,220)
  const t=f.targets.spawn(1000,750,200,{predictable:true,catalogId:'python'})
  t.x=500;t.y=375
  f.applySlashSegment({from:{x:300,y:375},to:{x:700,y:375},activeSlash:true,at:50},220)
  assert.equal(f.scores,0)
  assert.equal(t.sliced,false)
})

test('stationary jitter and slow motion never create a scoring slash', () => {
  const f=fixture()
  for(let i=0;i<60;i++)f.processResult(f.result(500+i*.5+(i%2)*.2),i*33,i*33+20)
  assert.equal(f.slash.state.slashActive,false)
  assert.equal(f.scores,0)
  assert.ok(Math.abs(f.continuity.state.pointer.x-529.5)<3)
})

test('invalid landmarks are distinguished from empty model results', () => {
  const f=fixture(),invalid=f.result()
  invalid.landmarks[0][8].x=NaN
  f.processResult(invalid,0,20)
  assert.equal(f.continuity.state.invalidResults,1)
  assert.equal(f.continuity.state.noHandResults,0)
  assert.equal(f.continuity.tick(20).cursorVisible,false)
})

test('out-of-order results and resets cannot revive the old cursor', () => {
  const f=fixture()
  f.processResult(f.result(),100,120)
  f.processResult(f.result(800),50,130)
  assert.equal(f.continuity.state.staleResults,1)
  assert.equal(f.continuity.state.pointer.x,500)
  f.continuity.reset()
  assert.equal(f.continuity.tick(150).cursorVisible,false)
  assert.equal(f.continuity.state.canCollide,false)
})

test('finger offset smoothing uses elapsed time without extra filtering on fast samples', () => {
  function offset(steps) {
    const hand=createHandMotionProcessor()
    hand.sample({x:100,y:100},{x:100,y:100},0,1000)
    for(const at of steps)hand.sample({x:100,y:100},{x:140,y:100},at,1000)
    return hand.state.smoothedFingerOffset.x
  }
  assert.ok(Math.abs(offset([33])-offset([16.5,33]))<1e-10)
})
