import test from 'node:test'
import assert from 'node:assert/strict'
import { createCameraSession, FINISHED_CAMERA_RELEASE_MS } from '../src/camera.js'
import { createReplayFlow } from '../src/replay.js'
import { createDeveloperUi } from '../src/developer-ui.js'
import { resetPlayerTracking } from '../src/player-state.js'
import { createFingerProcessor } from '../src/tracking.js'
import { createHandMotionProcessor } from '../src/hand.js'
import { createSlashTracker } from '../src/slash.js'
import { createGameSession, COUNTDOWN_MS, GAME_DURATION_MS } from '../src/game.js'
import { createTargetSystem } from '../src/targets.js'
import { createAudioSystem } from '../src/audio.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fakeStream(trackCount = 2) {
  const tracks = Array.from({ length: trackCount }, () => {
    const listeners = new Set()
    return {
      stops: 0,
      stop() { this.stops += 1 },
      addEventListener(type, listener) { if (type === 'ended') listeners.add(listener) },
      removeEventListener(type, listener) { if (type === 'ended') listeners.delete(listener) },
      end() { for (const listener of listeners) listener() },
    }
  })
  return { tracks, getTracks: () => tracks, getVideoTracks: () => tracks.slice(0, 1) }
}

function fakeVideo() {
  return { srcObject: null, pauses: 0, pause() { this.pauses += 1 } }
}

test('FINISHED release waits 700 ms, stops every track, and is safe to repeat', async () => {
  const stream = fakeStream(3)
  const video = fakeVideo()
  let timer
  const camera = createCameraSession({ video, getUserMedia: async () => stream,
    setTimer: (callback, delay) => { timer = { callback, delay }; return 1 },
    clearTimer: () => { timer = null } })
  assert.equal(await camera.acquire({ video: true }, async () => {}), true)
  assert.equal(camera.state.active, true)
  assert.equal(video.srcObject, stream)
  assert.equal(camera.scheduleRelease(() => camera.release()), true)
  assert.equal(timer.delay, FINISHED_CAMERA_RELEASE_MS)
  assert.equal(camera.state.releaseScheduled, true)
  assert.ok(stream.tracks.every((track) => track.stops === 0))
  timer.callback()
  assert.ok(stream.tracks.every((track) => track.stops === 1))
  assert.equal(video.srcObject, null)
  assert.equal(camera.state.stream, null)
  assert.equal(camera.state.active, false)
  assert.equal(camera.state.releaseScheduled, false)
  assert.equal(camera.release(), false)
  assert.ok(stream.tracks.every((track) => track.stops === 1))
})

test('concurrent starts share one request; releasing during startup stops a late stream', async () => {
  const request = deferred()
  const video = fakeVideo()
  let requests = 0
  const camera = createCameraSession({ video, getUserMedia: () => { requests += 1; return request.promise } })
  const first = camera.acquire({ video: true }, async () => {})
  const second = camera.acquire({ video: true }, async () => {})
  assert.equal(first, second)
  assert.equal(requests, 1)
  camera.release()
  const stream = fakeStream()
  request.resolve(stream)
  assert.equal(await first, false)
  assert.equal(camera.state.active, false)
  assert.equal(video.srcObject, null)
  assert.ok(stream.tracks.every((track) => track.stops === 1))
})

test('failed camera acquisition is retryable and unexpected track end is distinct', async () => {
  const video = fakeVideo()
  const stream = fakeStream()
  let requests = 0
  let ended = 0
  const camera = createCameraSession({ video,
    getUserMedia: async () => { requests += 1; if (requests === 1) throw new Error('denied'); return stream },
    onUnexpectedEnd: () => { ended += 1; camera.release() } })
  await assert.rejects(camera.acquire({ video: true }, async () => {}), /denied/)
  assert.equal(camera.state.pending, false)
  assert.equal(camera.state.active, false)
  assert.equal(await camera.acquire({ video: true }, async () => {}), true)
  stream.tracks[0].end()
  assert.equal(ended, 1)
  assert.equal(camera.state.active, false)
  assert.equal(video.srcObject, null)
})

test('a camera track ending before video readiness cancels startup', async () => {
  const ready = deferred()
  const stream = fakeStream()
  const camera = createCameraSession({ video: fakeVideo(), getUserMedia: async () => stream,
    onUnexpectedEnd: () => camera.release() })
  const startup = camera.acquire({ video: true }, () => ready.promise)
  await Promise.resolve()
  stream.tracks[0].end()
  ready.resolve()
  assert.equal(await startup, false)
  assert.equal(camera.state.active, false)
  assert.ok(stream.tracks.every((track) => track.stops === 1))
})

test('camera release preserves loaded tracker and sound preference', async () => {
  const tracker = { loaded: true, closes: 0, close() { this.closes += 1 } }
  const audio = createAudioSystem()
  audio.setEnabled(false)
  const camera = createCameraSession({ video: fakeVideo(), getUserMedia: async () => fakeStream() })
  await camera.acquire({ video: true }, async () => {})
  camera.release()
  assert.equal(tracker.loaded, true)
  assert.equal(tracker.closes, 0)
  assert.equal(audio.state.enabled, false)
})

test('PLAY AGAIN waits for camera, blocks duplicate clicks, and retries after failure', async () => {
  const request = deferred()
  const calls = []
  let attempts = 0
  const flow = createReplayFlow({
    canReplay: () => true,
    prepareCamera: () => { attempts += 1; calls.push('camera'); return attempts === 1 ? request.promise : true },
    resetRound: () => calls.push('reset'),
    beginRound: () => calls.push('countdown'),
    onLoading: (loading) => calls.push(loading ? 'loading' : 'ready'),
  })
  const first = flow.replay()
  assert.equal(flow.state.pending, true)
  assert.equal(await flow.replay(), false)
  assert.equal(attempts, 1)
  assert.deepEqual(calls, ['loading', 'camera'])
  request.resolve(false)
  assert.equal(await first, false)
  assert.deepEqual(calls, ['loading', 'camera', 'ready'])
  assert.equal(await flow.replay(), true)
  assert.deepEqual(calls.slice(-5), ['loading', 'camera', 'reset', 'countdown', 'ready'])
  assert.equal(flow.state.pending, false)
})

test('fresh player tracking resets histories without clearing session high score', () => {
  const finger = createFingerProcessor()
  const hand = createHandMotionProcessor()
  const slash = createSlashTracker()
  const targets = createTargetSystem(() => 0)
  const game = createGameSession()
  game.startCountdown(0)
  game.update(COUNTDOWN_MS)
  game.scoreTarget(targets.spawn(500, 400, 0, { kind: 'golden' }), COUNTDOWN_MS + 10)
  game.update(COUNTDOWN_MS + GAME_DURATION_MS)
  const highScore = game.state.highScore
  finger.sample({ x: 100, y: 100 }, 0, 500)
  hand.sample({ x: 80, y: 80 }, { x: 100, y: 100 }, 0, 500)
  slash.detected({ x: 100, y: 100 }, 0, 500)
  slash.detected({ x: 140, y: 100 }, 40, 500)
  resetPlayerTracking({ finger, hand, slash })
  assert.equal(finger.state.raw, null)
  assert.equal(finger.state.smooth, null)
  assert.equal(finger.state.rejected, 0)
  assert.equal(hand.state.rawHandAnchor, null)
  assert.equal(hand.state.smoothedFingerOffset, null)
  assert.equal(hand.state.velocity, null)
  assert.equal(slash.state.lastReliablePoint, null)
  assert.equal(slash.state.tracking, 'LOST')
  assert.equal(slash.state.missingForMs, 0)
  assert.equal(slash.state.predictionActive, false)
  assert.equal(slash.state.velocity, null)
  assert.equal(slash.state.segments.length, 0)
  game.reset()
  targets.reset()
  assert.equal(game.state.score, 0)
  assert.equal(game.state.combo, 1)
  assert.equal(game.state.remainingMs, GAME_DURATION_MS)
  assert.equal(targets.activeCount(), 0)
  assert.equal(game.state.highScore, highScore)
})

test('Debug starts hidden, Ctrl+Shift+D toggles only its panel, and reload starts hidden', () => {
  const panel = { hidden: false }
  const game = createGameSession()
  const firstLoad = createDeveloperUi(panel)
  assert.equal(panel.hidden, true)
  const event = { ctrlKey: true, shiftKey: true, code: 'KeyD', repeat: false,
    prevented: 0, preventDefault() { this.prevented += 1 } }
  assert.equal(firstLoad.handleKeydown(event), true)
  assert.equal(panel.hidden, false)
  assert.equal(firstLoad.handleKeydown(event), true)
  assert.equal(panel.hidden, true)
  assert.equal(game.state.phase, 'READY')
  firstLoad.handleKeydown(event)
  assert.equal(createDeveloperUi({ hidden: false }).state.visible, false)
  assert.equal(event.prevented, 3)
})

test('camera reports actual settings without device identifiers and measures presented frames', async () => {
  const stream=fakeStream(),video=fakeVideo()
  stream.tracks[0].getSettings=()=>({width:1280,height:720,frameRate:24,facingMode:'user',
    deviceId:'private-device',groupId:'private-group'})
  let callback,requests=0,canceled=null
  video.requestVideoFrameCallback=fn=>{callback=fn;return ++requests}
  video.cancelVideoFrameCallback=id=>{canceled=id}
  const camera=createCameraSession({video,getUserMedia:async()=>stream})
  await camera.acquire({video:{width:{ideal:640},frameRate:{ideal:30}}},async()=>{})
  assert.deepEqual(camera.state.settings,{width:1280,height:720,frameRate:24,facingMode:'user'})
  callback(0,{presentedFrames:1})
  callback(1000,{presentedFrames:25})
  assert.equal(camera.state.freshFrames,24)
  assert.equal(camera.state.freshFrameRate,24)
  assert.equal(camera.state.frameRateSource,'PRESENTED_FRAMES')
  camera.observeDecodedFrames(2000)
  assert.equal(camera.state.freshFrameRate,0,'a stalled camera is not reported as still producing frames')
  const lastRequest=requests
  camera.release()
  assert.equal(canceled,lastRequest)
  callback(2100,{presentedFrames:30})
  assert.equal(camera.state.freshFrames,24,'late callbacks cannot revive a released camera')
})

test('decoded-frame fallback counts frames independently of inference, skipping duplicate polls', async () => {
  const video=fakeVideo(),stream=fakeStream()
  let frames=10
  video.getVideoPlaybackQuality=()=>({totalVideoFrames:frames})
  const camera=createCameraSession({video,getUserMedia:async()=>stream})
  await camera.acquire({video:true},async()=>{})
  camera.observeDecodedFrames(0)
  for(let at=10;at<1000;at+=10)camera.observeDecodedFrames(at)
  frames=40;camera.observeDecodedFrames(1000)
  assert.equal(camera.state.freshFrames,30)
  assert.equal(camera.state.freshFrameRate,30)
  camera.observeDecodedFrames(2000)
  assert.equal(camera.state.freshFrameRate,0)
  camera.release()
})

test('video callbacks are rearmed before delivery, identify image PTS and independently audit decoded frames', async () => {
  const video = fakeVideo(), deliveries = []
  let callback, decoded = 0, armed = 0
  video.requestVideoFrameCallback = fn => { callback = fn; return ++armed }
  video.getVideoPlaybackQuality = () => ({ totalVideoFrames: decoded })
  const camera = createCameraSession({ video, getUserMedia: async () => fakeStream(), now: () => 1100,
    onFrame: (at, metadata) => deliveries.push({ at, metadata, armed }) })
  await camera.acquire({ video: true }, async () => {})
  callback(0, { presentedFrames: 1, mediaTime: 0, presentationTime: 0 })
  assert.equal(deliveries[0].armed, 2)
  camera.observeDecodedFrames(0)
  decoded = 30
  callback(1000, { presentedFrames: 31, mediaTime: 1, presentationTime: 995, captureTime: 990 })
  camera.observeDecodedFrames(1000)
  assert.equal(camera.state.decodedFrameRate, 30)
  assert.equal(camera.state.missedCallbacks, 29)
  assert.equal(camera.state.frameId, 1)
  assert.equal(camera.state.presentationDelayMs, 105)
  assert.equal(camera.state.sourceCaptureAgeMs, 110)
  callback(1010, { presentedFrames: 32, mediaTime: 1 })
  assert.equal(deliveries.length, 2, 'same image PTS must not start duplicate inference')
  camera.release()
})

test('last-resort media-clock rate is explicitly estimated and quantized, rather than sensor FPS', async () => {
  const video=fakeVideo(),stream=fakeStream()
  video.currentTime=0
  const camera=createCameraSession({video,getUserMedia:async()=>stream})
  await camera.acquire({video:true},async()=>{})
  camera.observeDecodedFrames(0)
  for(let i=1;i<=10;i++) {
    video.currentTime=i/10
    camera.observeDecodedFrames(i*100)
    camera.observeDecodedFrames(i*100)
  }
  assert.equal(camera.state.freshFrames,30)
  assert.equal(camera.state.freshFrameRate,30)
  assert.equal(camera.state.frameRateSource,'ESTIMATED_MEDIA_TIME')
  camera.release()
})

test('a canceled frame callback cannot affect a restarted camera or hide its cancellation handle', async () => {
  const video=fakeVideo()
  const callbacks=[],canceled=[]
  video.requestVideoFrameCallback=fn=>{callbacks.push(fn);return callbacks.length}
  video.cancelVideoFrameCallback=id=>canceled.push(id)
  const camera=createCameraSession({video,getUserMedia:async()=>fakeStream()})
  await camera.acquire({video:true},async()=>{})
  const oldCallback=callbacks[0]
  camera.release()
  await camera.acquire({video:true},async()=>{})
  oldCallback(1000,{presentedFrames:99})
  assert.equal(callbacks.length,2)
  assert.equal(camera.state.frameRateSource,'UNAVAILABLE')
  camera.release()
  assert.deepEqual(canceled,[1,2])
})
