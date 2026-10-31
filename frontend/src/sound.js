// Ambient rain sound generated with the Web Audio API — no audio file,
// no download, no autoplay. It only starts after the user taps the sound
// toggle, and it stops when toggled off. A short chime plays on FINALIZED
// when the sound is on, so a long consensus wait has an audible payoff.
export function createRainEngine() {
  let ctx = null
  let master = null
  let nodes = []
  let on = false

  function noiseBuffer(seconds, brown) {
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      if (brown) { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.5 }
      else data[i] = white
    }
    return buf
  }

  function start() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
      if (ctx.state === 'suspended') void ctx.resume()
      if (on) return true
      master = ctx.createGain()
      master.gain.setValueAtTime(0.0001, ctx.currentTime)
      master.connect(ctx.destination)
      // Low rumble: brown noise through a lowpass.
      const low = ctx.createBufferSource()
      low.buffer = noiseBuffer(2, true); low.loop = true
      const lowFilter = ctx.createBiquadFilter()
      lowFilter.type = 'lowpass'; lowFilter.frequency.value = 420
      const lowGain = ctx.createGain(); lowGain.gain.value = 0.5
      low.connect(lowFilter); lowFilter.connect(lowGain); lowGain.connect(master); low.start()
      // Rain patter: white noise through a bandpass, gently wandering.
      const pat = ctx.createBufferSource()
      pat.buffer = noiseBuffer(2, false); pat.loop = true
      const patFilter = ctx.createBiquadFilter()
      patFilter.type = 'bandpass'; patFilter.frequency.value = 2400; patFilter.Q.value = 0.6
      const patGain = ctx.createGain(); patGain.gain.value = 0.12
      pat.connect(patFilter); patFilter.connect(patGain); patGain.connect(master); pat.start()
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 600
      lfo.connect(lfoGain); lfoGain.connect(patFilter.frequency); lfo.start()
      nodes = [low, pat, lfo]
      master.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 1.5)
      on = true
      return true
    } catch { return false }
  }

  function stop() {
    try {
      if (!ctx || !on) { on = false; return }
      on = false
      const t = ctx.currentTime
      master.gain.cancelScheduledValues(t)
      master.gain.setValueAtTime(master.gain.value, t)
      master.gain.exponentialRampToValueAtTime(0.0001, t + 0.8)
      const toStop = nodes
      setTimeout(() => { toStop.forEach(n => { try { n.stop() } catch {} }); nodes = [] }, 900)
    } catch {}
  }

  function chime() {
    try {
      if (!ctx || !on) return
      const t = ctx.currentTime
      ;[523.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t + i * 0.14)
        g.gain.exponentialRampToValueAtTime(0.08, t + i * 0.14 + 0.05)
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.7)
        osc.connect(g); g.connect(ctx.destination)
        osc.start(t + i * 0.14); osc.stop(t + i * 0.14 + 0.75)
      })
    } catch {}
  }

  return { start, stop, chime, get isOn() { return on } }
}
