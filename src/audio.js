export const MASTER_VOLUME = 0.52
const COMBO_SEMITONES = [0, 2, 4, 5, 7]

export function comboPitch(combo, base = 250) {
  const index = Math.max(0, Math.min(4, Math.round(combo) - 1))
  return base * 2 ** (COMBO_SEMITONES[index] / 12)
}

export function countdownPitch(number) {
  return [0, 605, 515, 440][number] ?? 440
}

export function soundCueForEvent(event) {
  switch (event.type) {
    case 'countdown-tick': return { name: 'countdown-tick', detail: { number: event.number } }
    case 'round-start': return { name: 'round-start' }
    case 'target-sliced': return { name: event.kind === 'golden' ? 'golden-slice' : 'normal-slice',
      detail: { combo: event.combo } }
    case 'combo-increase': return { name: 'combo-increase', detail: { combo: event.combo } }
    case 'bug-hit': return { name: 'bug-hit' }
    case 'web-rush-start': return { name: 'web-rush-start' }
    case 'final-15': return { name: 'final-15' }
    case 'final-ten-tick': return { name: 'final-ten-tick', detail: { second: event.second } }
    case 'round-finished': return { name: 'round-finished' }
    case 'new-high-score': return { name: 'new-high-score', detail: { delay: 0.94 } }
    default: return null
  }
}

export function createAudioSystem({
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  volume = MASTER_VOLUME,
} = {}) {
  const state = { enabled: true, failed: false, unlocked: false, volume, cuesPlayed: 0 }
  let context = null
  let master = null
  let noiseBuffer = null

  async function unlock() {
    if (!state.enabled || state.failed) return false
    try {
      if (!context) {
        if (!AudioContextClass) throw new Error('Web Audio is unavailable')
        context = new AudioContextClass()
        master = context.createGain()
        master.gain.value = state.volume
        master.connect(context.destination)
      }
      if (context.state !== 'running') await context.resume()
      state.unlocked = context.state === 'running'
      return state.unlocked
    } catch (error) {
      state.failed = true
      state.unlocked = false
      console.warn('Nawras Slasher audio is unavailable:', error)
      return false
    }
  }

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled)
    if (master) master.gain.value = state.enabled ? state.volume : 0
    return state.enabled
  }

  function tone(frequency, duration, type, amplitude, delay = 0, endFrequency = frequency) {
    const at = context.currentTime + delay
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, at)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), at + duration)
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.linearRampToValueAtTime(amplitude, at + Math.min(0.018, duration * 0.25))
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    oscillator.connect(envelope)
    envelope.connect(master)
    oscillator.onended = () => {
      oscillator.disconnect()
      envelope.disconnect()
      oscillator.onended = null
    }
    oscillator.start(at)
    oscillator.stop(at + duration + 0.01)
  }

  function noise(duration, amplitude, delay = 0, startHz = 1800, endHz = 900) {
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.24), context.sampleRate)
      const samples = noiseBuffer.getChannelData(0)
      for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1
    }
    const at = context.currentTime + delay
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const envelope = context.createGain()
    source.buffer = noiseBuffer
    filter.type = 'bandpass'
    filter.Q.value = 0.65
    filter.frequency.setValueAtTime(startHz, at)
    filter.frequency.exponentialRampToValueAtTime(endHz, at + duration)
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.linearRampToValueAtTime(amplitude, at + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(master)
    source.onended = () => {
      source.disconnect()
      filter.disconnect()
      envelope.disconnect()
      source.onended = null
    }
    source.start(at)
    source.stop(at + duration + 0.01)
  }

  function cue(name, detail = {}) {
    if (!state.enabled || state.failed || !state.unlocked || context?.state !== 'running') return false
    try {
      switch (name) {
        case 'countdown-tick':
          tone(countdownPitch(detail.number), 0.10, 'triangle', 0.075)
          noise(0.045, 0.025, 0, 2200, 1300)
          break
        case 'round-start':
          noise(0.19, 0.10, 0, 550, 4200)
          tone(380, 0.23, 'triangle', 0.11, 0, 900)
          tone(790, 0.13, 'sine', 0.075, 0.13, 980)
          break
        case 'normal-slice':
          noise(0.13, 0.075, 0, 900, 3700)
          tone(comboPitch(detail.combo ?? 1), 0.15, 'triangle', 0.09, 0.018,
            comboPitch(detail.combo ?? 1) * 0.68)
          break
        case 'golden-slice':
          noise(0.17, 0.085, 0, 850, 3900)
          tone(comboPitch(detail.combo ?? 1, 560), 0.22, 'triangle', 0.095, 0.015,
            comboPitch(detail.combo ?? 1, 720))
          tone(comboPitch(detail.combo ?? 1, 860), 0.29, 'sine', 0.07, 0.065,
            comboPitch(detail.combo ?? 1, 1080))
          break
        case 'combo-increase':
          tone(comboPitch(detail.combo ?? 2, 520), 0.12, 'sine', 0.045, 0.07)
          break
        case 'bug-hit':
          tone(330, 0.13, 'triangle', 0.065, 0, 165)
          tone(190, 0.10, 'sine', 0.045, 0.08, 110)
          break
        case 'web-rush-start':
          noise(0.18, 0.045, 0, 700, 3600)
          tone(310, 0.38, 'sawtooth', 0.055, 0, 860)
          tone(760, 0.18, 'sine', 0.06, 0.24, 1120)
          break
        case 'final-15':
          noise(0.21, 0.06, 0, 450, 2100)
          tone(390, 0.21, 'triangle', 0.10)
          tone(590, 0.26, 'triangle', 0.085, 0.15, 780)
          break
        case 'final-ten-tick':
          tone(detail.second <= 3 ? 720 : 560, 0.075, 'triangle', detail.second <= 3 ? 0.085 : 0.052)
          noise(0.04, detail.second <= 3 ? 0.032 : 0.018, 0, 1800, 1000)
          break
        case 'round-finished':
          tone(510, 0.22, 'sine', 0.12, 0, 400)
          tone(360, 0.35, 'sine', 0.10, 0.19, 270)
          break
        case 'new-high-score':
          tone(650, 0.18, 'sine', 0.075, detail.delay ?? 0)
          tone(820, 0.2, 'sine', 0.075, (detail.delay ?? 0) + 0.14)
          tone(1100, 0.34, 'sine', 0.09, (detail.delay ?? 0) + 0.29)
          break
        default:
          return false
      }
      state.cuesPlayed += 1
      return true
    } catch (error) {
      state.failed = true
      state.unlocked = false
      console.warn(`Nawras Slasher audio cue failed (${name}):`, error)
      return false
    }
  }

  return { state, unlock, setEnabled, cue }
}
