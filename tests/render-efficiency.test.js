import test from 'node:test'
import assert from 'node:assert/strict'
import { createGlowCache, drawGlow } from '../src/glow-cache.js'
import { createTargetSystem } from '../src/targets.js'

test('glow textures are bounded and reused without per-frame gradient creation',()=>{
  let gradients=0
  const cache=createGlowCache(()=>({getContext:()=>({
    createRadialGradient(){gradients++;return{addColorStop(){}}},fillRect(){},
  })}))
  assert.equal(cache.size,6);assert.equal(gradients,6)
  const calls=[],context={globalAlpha:.7,drawImage:(...args)=>calls.push(args)}
  for(let i=0;i<1000;i++)drawGlow(context,cache,'bug-base',200,150,59,.8)
  assert.equal(gradients,6);assert.equal(context.globalAlpha,.7)
  assert.ok(calls.every(c=>c[0]===cache.get('bug-base')))
  assert.deepEqual(calls[0].slice(1),[141,91,118,118])
  drawGlow(context,cache,'bug-hit',200,150,59,0)
  assert.equal(calls.length,1000)
})

function simulate(fps) {
  const system=createTargetSystem(()=>.5)
  const t=system.spawn(1000,1000,0,{predictable:true,catalogId:'bug'})
  Object.assign(t,{x:100,y:500,vx:20,vy:-600,rotation:0,angularVelocity:.2})
  for(let i=1;i<=fps;i++)system.update(1/fps,i*1000/fps,1000,1000)
  return t
}
test('target motion matches the calibrated 60Hz trajectory at 15/30/60/120 FPS',()=>{
  const reference=simulate(60)
  assert.ok(Math.abs(reference.y-(500-600+1050*(1-1/60)/2))<1e-8)
  for(const fps of [15,30,120]) {
    const t=simulate(fps)
    for(const field of ['x','y','vy','rotation'])assert.ok(Math.abs(t[field]-reference[field])<1e-8,`${field} at ${fps} FPS`)
  }
})
test('brief stalls no longer discard target motion beyond 50ms',()=>{
  const system=createTargetSystem(()=>.5),t=system.spawn(1000,1000,0,{predictable:true,catalogId:'python'})
  Object.assign(t,{x:100,y:500,vx:100,vy:0,gravity:0})
  system.update(.1,100,1000,1000)
  assert.equal(t.x,110)
})
