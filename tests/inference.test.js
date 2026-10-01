import test from 'node:test'
import assert from 'node:assert/strict'
import { createInferenceDriver, videoFrameId } from '../src/inference.js'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const tick = async () => { for (let i=0;i<5;i++) await Promise.resolve() }

test('fresh-frame identity uses decoded frames rather than interpolated video time', () => {
  let frames = 7
  const video = { currentTime: 1, getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }) }
  assert.equal(videoFrameId(video), 7)
  video.currentTime = 1.02
  assert.equal(videoFrameId(video), 7, 'the same decoded image is not inferred twice')
  frames++
  assert.equal(videoFrameId(video), 8)
  assert.equal(videoFrameId({ currentTime: 2 }), 2, 'fallback for browsers without frame counters')
})
function fixture(capture) {
  let time=100
  const sent=[],results=[],errors=[]
  const bitmap={ closed:0,close(){this.closed++} }
  const worker={postMessage:(message,transfer)=>sent.push({message,transfer}),terminate(){this.terminated=true}}
  const driver=createInferenceDriver({worker,capture:capture??(()=>Promise.resolve(bitmap)),
    now:()=>time,onResult:(...args)=>results.push(args),onError:error=>errors.push(error)})
  return{driver,worker,sent,bitmap,results,errors,setTime:t=>time=t,
    respond:(data={})=>worker.onmessage({data:{type:'result',id:sent.at(-1).message.id,result:{landmarks:[]},detectMs:30,...data}})}
}

test('capture and worker inference share one in-flight slot and never queue frames',async()=>{
  const f=fixture()
  assert.equal(f.driver.detectForVideo({},100),true)
  for(let i=0;i<100;i++)assert.equal(f.driver.detectForVideo({},101+i),false)
  await tick()
  assert.equal(f.sent.length,1)
  assert.deepEqual(f.sent[0].transfer,[f.bitmap])
  f.setTime(135);f.respond()
  assert.equal(f.results.length,1)
  assert.equal(f.results[0][1],100,'motion retains its actual capture timestamp')
  assert.equal(f.driver.state.latencyMs,35)
  assert.equal(f.driver.state.detectMs,30)
  assert.equal(f.driver.state.maxPending,1)
  assert.equal(f.driver.detectForVideo({},136),true)
  await tick();assert.equal(f.sent.length,2)
  assert.equal(f.sent[1].message.at,136,'next request is fresh, not an old queued frame')
})
test('reset discards prior-camera results without starting overlapping inference',async()=>{
  const f=fixture();f.driver.detectForVideo({},100);await tick();f.driver.reset()
  assert.equal(f.driver.detectForVideo({},110),false)
  f.respond();assert.equal(f.results.length,0);assert.equal(f.driver.state.busy,false)
  assert.equal(f.driver.detectForVideo({},120),true);await tick();f.setTime(150);f.respond()
  assert.equal(f.results.length,1);assert.equal(f.results[0][1],120)
})
test('reset while capture is pending closes the untransferred bitmap',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>resolve=r))
  f.driver.detectForVideo({},100);await tick();f.driver.reset();resolve(f.bitmap);await tick()
  assert.equal(f.bitmap.closed,1);assert.equal(f.sent.length,0);assert.equal(f.driver.state.busy,false)
})
test('stale results are discarded instead of applying old hand positions',async()=>{
  const f=fixture();f.driver.detectForVideo({},100);await tick();f.setTime(351);f.respond()
  assert.equal(f.results.length,0);assert.equal(f.driver.state.discarded,1)
  assert.equal(f.driver.state.busy,false)
  assert.equal(f.driver.state.staleDiscarded,1)
})

test('result freshness rejects 151ms replies while accepting the 150ms display boundary', async () => {
  const f=fixture()
  f.driver.detectForVideo({},100);await tick();f.setTime(250);f.respond()
  assert.equal(f.results.length,1)
  f.driver.detectForVideo({},251);await tick();f.setTime(402);f.respond()
  assert.equal(f.results.length,1)
  assert.equal(f.driver.state.staleDiscarded,1)
  assert.equal(f.driver.state.busy,false)
})

test('diagnostics distinguish model misses from successful but stale detections', async () => {
  const f=fixture()
  f.driver.detectForVideo({},100);await tick();f.setTime(120);f.respond()
  assert.equal(f.driver.state.emptyReplies,1)
  f.driver.detectForVideo({},121);await tick();f.setTime(300)
  f.respond({result:{landmarks:[[{x:.5,y:.5}]]}})
  assert.equal(f.driver.state.handReplies,1)
  assert.equal(f.driver.state.staleHandReplies,1)
  assert.equal(f.driver.state.staleDiscarded,1)
  assert.equal(f.results.length,1)
})
test('closing the driver terminates its worker and releases a pending capture',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>resolve=r))
  f.driver.detectForVideo({},100);await tick();f.driver.close();resolve(f.bitmap);await tick()
  assert.equal(f.worker.terminated,true);assert.equal(f.worker.onmessage,null)
  assert.equal(f.bitmap.closed,1);assert.equal(f.sent.length,0)
  assert.equal(f.driver.detectForVideo({},200),false)
})
test('capture failure frees the slot and reports a contained error',async()=>{
  const f=fixture(()=>Promise.reject(Error('capture failed')))
  f.driver.detectForVideo({},100);await tick()
  assert.equal(f.driver.state.busy,false);assert.equal(f.errors.length,1);assert.equal(f.sent.length,0)
})
test('worker failures report errors once and unknown replies cannot complete a request',async()=>{
  const f=fixture();f.driver.detectForVideo({},100);await tick()
  f.respond({id:999});assert.equal(f.driver.state.busy,true)
  f.respond({type:'error',message:'inference failed'})
  assert.equal(f.driver.state.busy,false);assert.equal(f.errors.length,1);assert.equal(f.results.length,0)
})

test('worker uses GPU with the same model and falls back to CPU if unavailable', async () => {
  const source = readFileSync(new URL('../src/inference-worker.js', import.meta.url), 'utf8')
    .replace(/^import .*\r?\n/, '')
  for (const gpuAvailable of [true, false]) {
    const options = [], messages = []
    let closed = 0
    const self = { postMessage: message => messages.push(message) }
    const model = new Uint8Array([1, 2, 3])
    runInNewContext(source, {
      self, OffscreenCanvas: class {}, performance: { now: () => 100 },
      FilesetResolver: { forVisionTasks: async () => ({}) },
      HandLandmarker: { createFromOptions: async (_, config) => {
        options.push({ ...config, baseOptions: { ...config.baseOptions } })
        if (!gpuAvailable && config.baseOptions.delegate === 'GPU') throw Error('No GPU')
        return { detectForVideo: (_, at) => ({ landmarks: [], at }) }
      } },
    })
    await self.onmessage({ data: { type: 'init', wasmRoot: '/wasm', modelBuffer: model } })
    assert.equal(messages[0].type, 'ready')
    assert.deepEqual(options.map(option => option.baseOptions.delegate), gpuAvailable ? ['GPU'] : ['GPU', 'CPU'])
    for (const option of options) {
      assert.equal(option.baseOptions.modelAssetBuffer, model)
      assert.equal(option.numHands, 1)
      assert.equal(option.runningMode, 'VIDEO')
    }
    await self.onmessage({ data: { type: 'frame', id: 7, at: 123,
      bitmap: { close: () => closed++ } } })
    assert.equal(messages[1].id, 7)
    assert.equal(messages[1].result.at, 123)
    assert.equal(closed, 1, 'transferred frame resources are released')
  }
})
