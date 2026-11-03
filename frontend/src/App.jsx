import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CITIES, CONTRACT_ADDRESS, V1_CONTRACT_ADDRESS, CHAIN_ID, RPC_URL, PURPOSES, METRICS,
  classify, connectWalletAddress, explorerAddress, explorerTx, parseRecord,
  readClient, reviewerClient, sourceUrlFor, waitFinal, writeClient,
} from './genlayer.js'
import { LANGS, STRINGS, METRIC_UNITS, metricLabelFor, purposeLabelFor, verdictLabelFor } from './i18n.js'
import { createRainEngine } from './sound.js'

function yesterdayISO() {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function short(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : ''
}

// Friendly error text: map known on-chain codes, strip machine prefixes,
// never dump a raw SDK object at the reader.
function friendlyError(e) {
  const msg = (e && (e.message || e.shortMessage)) ? (e.message || e.shortMessage) : String(e || '')
  const m = msg.match(/EXPECTED:\s*([a-z_]+)/) || msg.match(/EXTERNAL:\s*([a-z_0-9]+)/)
  const code = m ? m[1] : ''
  const map = {
    attestation_already_verified: 'That attestation is already verified and cannot be verified again.',
    claim_already_settled: 'That case is already settled and cannot be settled again.',
    claim_owner_cap_reached: 'You already have 32 claim cases — the per-owner cap. Settle or use another account for new cases.',
    claim_metric_unknown: 'Unknown metric. Pick one of the four daily archive variables.',
    claim_operator_unknown: 'Operator must be ≥ or ≤.',
    threshold_not_a_number: 'Threshold must be a number.',
    limit_must_be_1_to_20: 'List limit must be between 1 and 20.',
    attestation_not_found: 'No such record on this contract.',
    claim_not_found: 'No such case on this contract.',
  }
  if (code && map[code]) return map[code]
  if (/user rejected|rejected/i.test(msg)) return 'The wallet request was rejected.'
  if (/insufficient|funds/i.test(msg)) return 'Not enough funds — but Studionet is gasless, so this usually means the wallet is on the wrong network.'
  const clean = msg.replace(/^Error:\s*/i, '').replace(/\s+/g, ' ').trim()
  return clean.length > 220 ? clean.slice(0, 220) + '…' : (clean || 'Something went wrong.')
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

// Scroll-reveal: sections rise in when they enter view. Reduced-motion
// users get everything visible immediately (see styles.css).
function Reveal({ children, delay = 0 }) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setInView(true); return }
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect() }
    }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return <div ref={ref} className={`reveal ${inView ? 'in' : ''}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>
}

function Stamp({ status, t }) {
  if (status === 'settled_true') return <span className="stamp stamp-true">{t.settledTrue}</span>
  if (status === 'settled_false') return <span className="stamp stamp-false">{t.settledFalse}</span>
  if (status === 'verified') return <span className="stamp stamp-true">{t.verified}</span>
  return <span className="stamp stamp-pending">{t.pending}</span>
}

function ClaimCard({ c, onSettle, settling, canWrite, t, lang }) {
  const settled = c.status === 'settled_true' || c.status === 'settled_false'
  const unit = METRIC_UNITS[c.metric] || ''
  return (
    <article className={`filecard tilt ${settled ? 'stamped' : ''}`}>
      <div className="filecard-top">
        <div>
          <div className="filecard-place">{c.location_name}</div>
          <div className="filecard-meta">{t.caseNo} #{c.id} · {c.date} · {purposeLabelFor(lang, c.purpose)}</div>
        </div>
        <Stamp status={c.status} t={t} />
      </div>
      <div className="claim-question">
        <span className="mono">{metricLabelFor(lang, c.metric)} {c.operator} {c.threshold} {unit}</span>
      </div>
      {settled && (
        <div className="claim-answer">
          <div><b>{c.measured_value} {unit}</b><span>{t.measured}</span></div>
          <div><b>{c.operator} {c.threshold} {unit}</b><span>{t.thresholdIs}</span></div>
        </div>
      )}
      <div className="filecard-foot">
        <a href={sourceUrlFor(c.latitude, c.longitude, c.date)} target="_blank" rel="noreferrer">{t.sourceData}</a>
        <span className="mono">{t.filedBy} {short(c.requester)}</span>
        {!settled && canWrite && (
          <button className="btn small" disabled={settling} onClick={() => onSettle(c.id)}>
            {settling ? t.settling : t.settleBtn}
          </button>
        )}
      </div>
    </article>
  )
}

function RecordCard({ r, onVerify, verifying, canWrite, t, lang }) {
  const verified = r.status === 'verified'
  return (
    <article className={`filecard tilt ${verified ? 'stamped' : ''}`}>
      <div className="filecard-top">
        <div>
          <div className="filecard-place">{r.location_name}</div>
          <div className="filecard-meta">{t.recordNo} #{r.id} · {r.date} · {purposeLabelFor(lang, r.purpose)}</div>
        </div>
        <Stamp status={r.status} t={t} />
      </div>
      {verified ? (
        <div className="numbers">
          <div><b>{r.precip_mm} mm</b><span>{t.precip}</span></div>
          <div><b>{r.temp_min_c}° – {r.temp_max_c}°C</b><span>{t.tempRange}</span></div>
          <div><b>{r.wind_max_kmh} km/h</b><span>{t.wind}</span></div>
          <div><b>WMO {r.weather_code}</b><span>{t.wmo}</span></div>
        </div>
      ) : (
        <p className="muted">{t.attestLedgerSub}</p>
      )}
      <div className="filecard-foot">
        <a href={sourceUrlFor(r.latitude, r.longitude, r.date)} target="_blank" rel="noreferrer">{t.sourceData}</a>
        <span className="mono">{t.filedBy} {short(r.requester)}</span>
        {!verified && canWrite && (
          <button className="btn small" disabled={verifying} onClick={() => onVerify(r.id)}>
            {verifying ? t.verifying : t.verifyBtn}
          </button>
        )}
      </div>
    </article>
  )
}

export default function App() {
  const [lang, setLang] = useState(() => {
    try {
      const saved = localStorage.getItem('wp-lang')
      return LANGS.some(l => l.id === saved) ? saved : 'en'
    } catch { return 'en' }
  })
  const t = STRINGS[lang] || STRINGS.en
  const [soundOn, setSoundOn] = useState(false)
  const soundRef = useRef(null)
  const soundClosedRef = useRef(false)
  if (!soundRef.current) soundRef.current = createRainEngine()
  const [intro, setIntro] = useState(() => {
    try {
      if (sessionStorage.getItem('wp-intro-seen')) return false
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
      return true
    } catch { return false }
  })
  const [introLeaving, setIntroLeaving] = useState(false)

  // Shared filing form state (claims + attestations share place/date).
  const [city, setCity] = useState(CITIES[0])
  const [custom, setCustom] = useState(false)
  const [lat, setLat] = useState(CITIES[0].lat)
  const [lon, setLon] = useState(CITIES[0].lon)
  const [date, setDate] = useState('2025-10-01')
  const [purpose, setPurpose] = useState(PURPOSES[0])
  const [metric, setMetric] = useState(METRICS[0].id)
  const [operator, setOperator] = useState('>=')
  const [threshold, setThreshold] = useState('0.1')

  const [wallet, setWallet] = useState(null)
  const [client, setClient] = useState(null)
  const [snapFailed, setSnapFailed] = useState(false)
  const [walletMode, setWalletMode] = useState(null)
  const [ephemeralAddress, setEphemeralAddress] = useState(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [tx, setTx] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [claims, setClaims] = useState([])
  const [records, setRecords] = useState([])
  const [listBusy, setListBusy] = useState(false)
  const [verifyingId, setVerifyingId] = useState(null)
  const [settlingId, setSettlingId] = useState(null)
  const [createdClaimId, setCreatedClaimId] = useState(null)
  const [createdAttestId, setCreatedAttestId] = useState(null)
  const [v1Count, setV1Count] = useState(null)
  const [v1Record, setV1Record] = useState(null)
  const maxDate = yesterdayISO()
  const configured = Boolean(CONTRACT_ADDRESS)

  useEffect(() => {
    try { localStorage.setItem('wp-lang', lang) } catch {}
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    if (!intro) return
    const t1 = setTimeout(() => setIntroLeaving(true), 2200)
    const t2 = setTimeout(() => {
      setIntro(false)
      try { sessionStorage.setItem('wp-intro-seen', '1') } catch {}
    }, 2900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [intro])

  function dismissIntro() {
    if (!intro || introLeaving) return
    setIntroLeaving(true)
    setTimeout(() => {
      setIntro(false)
      try { sessionStorage.setItem('wp-intro-seen', '1') } catch {}
    }, 450)
  }

  // Sound rule: never autoplay on load. The first click anywhere EXCEPT
  // the sound button auto-enables the rain sound (button state synced);
  // once the user manually closes it, it never auto-re-enables.
  useEffect(() => {
    function onFirstClick(e) {
      if (soundClosedRef.current) return
      if (e.target.closest && e.target.closest('[data-audio-control="true"]')) return
      if (soundRef.current.start()) setSoundOn(true)
      document.removeEventListener('pointerdown', onFirstClick)
    }
    document.addEventListener('pointerdown', onFirstClick)
    return () => document.removeEventListener('pointerdown', onFirstClick)
  }, [])

  function toggleSound() {
    if (soundOn) {
      soundRef.current.stop(); setSoundOn(false); soundClosedRef.current = true
    } else {
      soundClosedRef.current = false
      if (soundRef.current.start()) setSoundOn(true)
    }
  }

  useEffect(() => {
    if (soundOn && /finalized/i.test(status)) soundRef.current.chime()
  }, [status, soundOn])

  useEffect(() => () => { soundRef.current.stop() }, [])

  // Mouse playfulness (fine pointers only): cursor glow follows the
  // pointer and swells over interactive elements; dossier cards tilt
  // subtly; primary actions are magnetic. Nothing sticks after leave.
  const glowRef = useRef(null)
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return
    const glow = glowRef.current
    if (!glow) return
    let tx = window.innerWidth / 2, ty = window.innerHeight / 2, cx = tx, cy = ty
    let raf = 0, shown = false, lastTilt = null, lastMag = null
    const loop = () => {
      cx += (tx - cx) * 0.16; cy += (ty - cy) * 0.16
      glow.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    function onMove(e) {
      tx = e.clientX; ty = e.clientY
      if (!shown) { glow.classList.add('visible'); shown = true }
      glow.classList.toggle('big', Boolean(e.target.closest('a,button,.chip,input,select,.filecard,.panel')))
      const tiltEl = e.target.closest('.tilt')
      if (tiltEl !== lastTilt) { if (lastTilt) lastTilt.style.transform = ''; lastTilt = tiltEl }
      if (tiltEl) {
        const r = tiltEl.getBoundingClientRect()
        const rx = (0.5 - (e.clientY - r.top) / r.height) * 5
        const ry = ((e.clientX - r.left) / r.width - 0.5) * 5
        tiltEl.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-2px)`
      }
      const magEl = e.target.closest('.magnetic')
      if (magEl !== lastMag) { if (lastMag) lastMag.style.transform = ''; lastMag = magEl }
      if (magEl) {
        const r = magEl.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
        magEl.style.transform = `translate(${(dx * 0.16).toFixed(1)}px, ${(dy * 0.16).toFixed(1)}px)`
      }
    }
    function onLeave() { glow.classList.remove('visible'); shown = false }
    document.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  const pickCity = (c) => { setCity(c); setLat(c.lat); setLon(c.lon); setCustom(false) }

  async function loadLedger() {
    if (!configured) return
    setListBusy(true)
    try {
      const c = readClient()
      const [rawClaims, rawRecords] = await Promise.all([
        c.readContract({ address: CONTRACT_ADDRESS, functionName: 'list_claims', args: [0n, 20n] }),
        c.readContract({ address: CONTRACT_ADDRESS, functionName: 'list_attestations', args: [0n, 20n] }),
      ])
      const cl = parseRecord(rawClaims)
      const rc = parseRecord(rawRecords)
      setClaims(Array.isArray(cl) ? cl.slice().reverse() : [])
      setRecords(Array.isArray(rc) ? rc.slice().reverse() : [])
    } catch (e) {
      setError(friendlyError(e))
    } finally { setListBusy(false) }
  }

  async function loadV1Archive() {
    try {
      const c = readClient()
      const countRaw = await c.readContract({ address: V1_CONTRACT_ADDRESS, functionName: 'get_count', args: [] })
      const count = Number(countRaw)
      setV1Count(count)
      if (count > 0) {
        const raw = await c.readContract({ address: V1_CONTRACT_ADDRESS, functionName: 'get_attestation', args: [0n] })
        setV1Record(parseRecord(raw))
      }
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  useEffect(() => { loadLedger(); loadV1Archive() }, [])

  async function doPreview() {
    setError(''); setPreview(null); setPreviewBusy(true)
    try {
      const res = await fetch(sourceUrlFor(lat, lon, date))
      const data = await res.json()
      const d = data.daily
      if (!d) throw new Error('No daily data returned for that date.')
      const precip = d.precipitation_sum[0], tmax = d.temperature_2m_max[0], tmin = d.temperature_2m_min[0], code = d.weather_code[0], wind = d.wind_speed_10m_max[0]
      const metricValues = { precipitation_sum: precip, temperature_2m_max: tmax, temperature_2m_min: tmin, wind_speed_10m_max: wind }
      const measured = metricValues[metric]
      const thr = parseFloat(threshold)
      const would = Number.isFinite(thr) ? (operator === '>=' ? measured >= thr : measured <= thr) : null
      setPreview({ precip, tmax, tmin, code, wind, verdict: classify(precip, code), measured, would })
    } catch (e) { setError(friendlyError(e)) }
    finally { setPreviewBusy(false) }
  }

  async function doConnect() {
    setError(''); setSnapFailed(false)
    try {
      const address = await connectWalletAddress()
      setWallet(address)
      const client = writeClient(address)
      try {
        await client.connect('studionet')
        setClient(client); setWalletMode('snap'); setStatus('Wallet connected on Stable Studionet (GenLayer Snap ready).')
      } catch (snapErr) {
        setSnapFailed(true)
        const msg = snapErr?.message || String(snapErr)
        setError(/wallet_getSnaps|wallet_requestSnaps|32601|method not found/i.test(msg)
          ? 'This wallet does not support MetaMask Snaps (wallet_getSnaps not found). GenLayer writes need desktop MetaMask with Snaps — or use the reviewer test account below, which works with any wallet.'
          : 'GenLayer Snap could not be installed in this wallet (' + friendlyError(snapErr) + '). You can still continue with the reviewer test account below.')
      }
    } catch (e) { setError(friendlyError(e)) }
  }

  function doUseReviewerAccount() {
    const { address, client } = reviewerClient()
    setEphemeralAddress(address); setClient(client); setWalletMode('ephemeral'); setSnapFailed(false); setError('')
    setStatus('Reviewer test account ready. Writes will be signed by this ephemeral Studionet account, not by your wallet.')
  }

  function requireWallet() {
    if (!wallet || !client) { setError(t.errConnectFirst); return false }
    return true
  }

  async function doRequest() {
    if (!requireWallet()) return
    setError(''); setTx(null); setStatus('Submitting request…')
    try {
      const hash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName: 'request_attestation', args: [city.name && !custom ? city.name : 'Custom location', String(lat), String(lon), date, purpose], value: 0n, leaderOnly: false })
      setTx({ kind: 'Request', hash }); setStatus(t.txPending)
      await waitFinal(readClient(), hash, (s) => setStatus(s === 'finalized' ? t.txFinalized : t.txPending))
      const countRaw = await readClient().readContract({ address: CONTRACT_ADDRESS, functionName: 'get_count', args: [] })
      const id = Number(countRaw) - 1
      setCreatedAttestId(id); setStatus(`Request finalized as attestation #${id}. Now verify it on-chain.`)
      await loadLedger()
    } catch (e) { setError(friendlyError(e)); setStatus('') }
  }

  async function doVerify(id) {
    if (!requireWallet()) return
    setError(''); setVerifyingId(id); setTx(null); setStatus(`Verifying #${id} — validators are independently fetching the archive day…`)
    try {
      const hash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName: 'verify_attestation', args: [BigInt(id)], value: 0n, leaderOnly: false })
      setTx({ kind: 'Verify', hash }); setStatus(t.txPending)
      await waitFinal(readClient(), hash, (s) => setStatus(s === 'finalized' ? t.txFinalized : t.txPending))
      await loadLedger()
    } catch (e) { setError(friendlyError(e)); setStatus('') }
    finally { setVerifyingId(null) }
  }

  async function doClaim() {
    if (!requireWallet()) return
    setError(''); setTx(null); setStatus('Filing claim…')
    try {
      const hash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName: 'create_claim', args: [city.name && !custom ? city.name : 'Custom location', String(lat), String(lon), date, metric, operator, String(threshold), purpose], value: 0n, leaderOnly: false })
      setTx({ kind: 'Claim', hash }); setStatus(t.txPending)
      await waitFinal(readClient(), hash, (s) => setStatus(s === 'finalized' ? t.txFinalized : t.txPending))
      const countRaw = await readClient().readContract({ address: CONTRACT_ADDRESS, functionName: 'get_claim_count', args: [] })
      const id = Number(countRaw) - 1
      setCreatedClaimId(id); setStatus(`Claim filed as case #${id}. Now settle it on-chain.`)
      await loadLedger()
    } catch (e) { setError(friendlyError(e)); setStatus('') }
  }

  async function pollClaimUntilSettled(id) {
    for (let i = 0; i < 12; i++) {
      try {
        const raw = await readClient().readContract({ address: CONTRACT_ADDRESS, functionName: 'get_claim', args: [BigInt(id)] })
        const claim = parseRecord(raw)
        if (claim && claim.status !== 'pending') return claim
      } catch {}
      await new Promise(r => setTimeout(r, 5000))
    }
    return null
  }

  async function doSettle(id) {
    if (!requireWallet()) return
    setError(''); setSettlingId(id); setTx(null); setStatus(`Settling case #${id} — validators are independently fetching the archive day…`)
    try {
      const hash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName: 'settle_claim', args: [BigInt(id)], value: 0n, leaderOnly: false })
      setTx({ kind: 'Settle', hash }); setStatus(t.txPending)
      await waitFinal(readClient(), hash, (s) => setStatus(s === 'finalized' ? t.txFinalized : t.txPending))
      const settled = await pollClaimUntilSettled(id)
      if (settled) setStatus(`Case #${id} settled: ${settled.status === 'settled_true' ? t.settledTrue : t.settledFalse} (measured ${settled.measured_value}).`)
      else setStatus(`Case #${id} finalized — if the stamp is not visible yet, press Refresh.`)
      await loadLedger()
    } catch (e) { setError(friendlyError(e)); setStatus('') }
    finally { setSettlingId(null) }
  }

  const locationName = useMemo(() => custom ? 'Custom location' : city.name, [custom, city])
  const featuredClaim = claims.find(c => c.status !== 'pending') || claims[0]
  const featuredRecord = records.find(r => r.status === 'verified') || records[0]
  const featured = featuredClaim || featuredRecord
  const settledCount = claims.filter(c => c.status !== 'pending').length
  const verifiedCount = records.filter(r => r.status === 'verified').length
  const statusBusy = /waiting|submitting|filing|settling|verifying|loading/i.test(status)

  return (
    <div className="page">
      <div className="cursor-glow" ref={glowRef} aria-hidden="true" />
      {intro && (
        <div className={`intro ${introLeaving ? 'leaving' : ''}`} onClick={dismissIntro} role="button" aria-label={t.skipIntro}>
          <div className="intro-sheet">
            <div className="intro-eyebrow">{t.ledgerNo}</div>
            <img className="intro-logo" src="./logo.svg" alt="WeatherProof logo" />
            <div className="intro-title">WeatherProof</div>
            <div className="intro-tag">{t.introTag}</div>
            <div className="intro-stamp">{t.settledTrue}</div>
            <div className="intro-bar"><i /></div>
            <div className="intro-skip">{t.skipIntro}</div>
          </div>
        </div>
      )}

      <header className="masthead">
        <div className="brand"><img src="./logo.svg" alt="WeatherProof logo" /><div><b>WeatherProof</b><span>{t.brandTag}</span></div></div>
        <div className="top-right">
          <span className="ledger-no">{t.ledgerNo}</span>
          <div className="langswitch" role="group" aria-label="Language">
            {LANGS.map(l => <button key={l.id} className={lang === l.id ? 'lang active' : 'lang'} onClick={() => setLang(l.id)}>{l.label}</button>)}
          </div>
          <button data-audio-control="true" className={`soundbtn ${soundOn ? 'on' : ''}`} onClick={toggleSound} aria-pressed={soundOn} title={soundOn ? t.soundOff : t.soundOn}>
            {soundOn ? '♪ ' + t.soundOn : '♪ ' + t.soundOff}
          </button>
          <span className="net">Stable Studionet · {CHAIN_ID}</span>
          {wallet ? <span className="wallet mono">{short(wallet)}{walletMode === 'ephemeral' && ephemeralAddress ? ` · test acct ${short(ephemeralAddress)}` : ''}</span> : <button className="btn" onClick={doConnect}>{t.connectWallet}</button>}
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="kicker"><i>●</i> {t.kicker}</p>
          <h1>{t.heroPre}<em>{t.heroEm}</em>{t.heroPost}</h1>
          <p className="lede">{t.heroSub}</p>
          <div className="hero-actions">
            <a className="btn primary-large magnetic" href="#claim" style={{ textDecoration: 'none' }}>{t.ctaClaim}</a>
            <a className="btn secondary magnetic" href="#claims" style={{ textDecoration: 'none' }}>{t.ctaBrowse}</a>
          </div>
          <p className="hero-note">{t.heroNote}</p>
          {!configured && <div className="warn">This build has no contract address configured yet. Set <code>VITE_CONTRACT_ADDRESS</code> and rebuild — browsing and the browser preview still work.</div>}
        </div>
        <div className="hero-file" aria-hidden="false">
          {featured ? (
            <div className="hero-card tilt">
              <div className="hero-card-head">
                <span className="eyebrow">{t.liveFromChain}</span>
                <Stamp status={featured.status} t={t} />
              </div>
              <div className="hero-place">{featured.location_name} · {featured.date}</div>
              <div className="hero-meta mono">
                {featured.metric ? `${metricLabelFor(lang, featured.metric)} ${featured.operator} ${featured.threshold} ${METRIC_UNITS[featured.metric] || ''}` : `${purposeLabelFor(lang, featured.purpose)}${featured.status === 'verified' ? ` · ${verdictLabelFor(lang, featured.verdict)}` : ''}`}
              </div>
              {featured.status === 'verified' && (
                <div className="hero-numbers">
                  <div><b>{featured.precip_mm} mm</b><span>{t.rain}</span></div>
                  <div><b>{featured.temp_min_c}°–{featured.temp_max_c}°C</b><span>{t.temp}</span></div>
                  <div><b>{featured.wind_max_kmh} km/h</b><span>{t.wind}</span></div>
                </div>
              )}
              {featured.measured_value !== undefined && featured.measured_value !== null && (
                <div className="hero-numbers">
                  <div><b>{featured.measured_value} {METRIC_UNITS[featured.metric] || ''}</b><span>{t.measured}</span></div>
                  <div><b>{featured.operator} {featured.threshold} {METRIC_UNITS[featured.metric] || ''}</b><span>{t.thresholdIs}</span></div>
                </div>
              )}
              <div className="hero-file-no mono">{featured.metric ? `${t.caseNo} #${featured.id}` : `${t.recordNo} #${featured.id}`} · {short(featured.requester)}</div>
            </div>
          ) : (
            <div className="hero-card">
              <div className="eyebrow">{t.liveFromChain}</div>
              <div className="hero-place">{t.loadingRecord}</div>
              <div className="skeleton" style={{ marginTop: 12 }} />
            </div>
          )}
        </div>
      </section>

      <Reveal>
        <section className="stats" aria-label="Live stats">
          <div className="stat"><b>{claims.length}</b><span>{t.statCases}</span></div>
          <div className="stat"><b>{settledCount}</b><span>{t.statSettled}</span></div>
          <div className="stat"><b>{records.length}</b><span>{t.statAttest}</span></div>
          <div className="stat"><b>ERA5</b><span>{t.statSource}</span></div>
        </section>
      </Reveal>

      <Reveal delay={80}>
        <section className="how">
          <h2>{t.howTitle}</h2>
          <ol className="steps">
            <li><div className="step-no">01</div><b>{t.how1Title}</b><span>{t.how1Desc}</span></li>
            <li><div className="step-no">02</div><b>{t.how2Title}</b><span>{t.how2Desc}</span></li>
            <li><div className="step-no">03</div><b>{t.how3Title}</b><span>{t.how3Desc}</span></li>
          </ol>
        </section>
      </Reveal>

      <main className="grid">
        <Reveal>
          <section className="panel tilt" id="claim">
            <div className="panel-kicker mono">v2 · {t.claimTitle}</div>
            <h2>{t.claimTitle}</h2>
            <p className="panel-sub">{t.claimSub}</p>
            <div className="chips">
              {CITIES.map(c => <button key={c.name} className={!custom && city.name === c.name ? 'chip active' : 'chip'} onClick={() => pickCity(c)}>{c.name}</button>)}
              <button className={custom ? 'chip active' : 'chip'} onClick={() => setCustom(true)}>{t.customCoords}</button>
            </div>
            {custom && (
              <div className="row">
                <Field label="Latitude"><input value={lat} onChange={e => setLat(e.target.value)} inputMode="decimal" /></Field>
                <Field label="Longitude"><input value={lon} onChange={e => setLon(e.target.value)} inputMode="decimal" /></Field>
              </div>
            )}
            {!custom && <p className="muted">{t.coords}: {lat}, {lon} — {locationName}</p>}
            <div className="row">
              <Field label={t.fieldDate}><input type="date" value={date} min="1940-01-01" max={maxDate} onChange={e => setDate(e.target.value)} /></Field>
              <Field label={t.fieldPurpose}><select value={purpose} onChange={e => setPurpose(e.target.value)}>{PURPOSES.map(p => <option key={p} value={p}>{purposeLabelFor(lang, p)}</option>)}</select></Field>
            </div>
            <div className="row row-3">
              <Field label={t.fieldMetric}><select value={metric} onChange={e => setMetric(e.target.value)}>{METRICS.map(m => <option key={m.id} value={m.id}>{metricLabelFor(lang, m.id)} ({m.unit})</option>)}</select></Field>
              <Field label={t.fieldOperator}><select value={operator} onChange={e => setOperator(e.target.value)}><option value=">=">≥</option><option value="<=">≤</option></select></Field>
              <Field label={`${t.fieldThreshold} (${METRIC_UNITS[metric] || ''})`}><input value={threshold} onChange={e => setThreshold(e.target.value)} inputMode="decimal" placeholder="0.1" /></Field>
            </div>
            <div className="actions">
              <button className="btn primary-large" onClick={doClaim} disabled={!configured || !wallet}>{t.btnClaim}</button>
              <button className="btn secondary" onClick={doPreview} disabled={previewBusy}>{previewBusy ? t.previewBusy : t.btnPreview}</button>
            </div>
            {!wallet && <p className="muted">{t.needWallet}<b>{t.needWalletEm}</b>{t.needWalletEnd}</p>}
            {preview && (
              <div className="preview">
                <span className="preview-tag">{t.previewTag}</span>
                <div className="numbers">
                  <div><b>{preview.precip} mm</b><span>{t.precip}</span></div>
                  <div><b>{preview.tmin}° – {preview.tmax}°C</b><span>{t.tempRange}</span></div>
                  <div><b>{preview.wind} km/h</b><span>{t.wind}</span></div>
                  <div><b>{verdictLabelFor(lang, preview.verdict)}</b><span>{t.wouldBeVerdict}</span></div>
                </div>
                {preview.would !== null && (
                  <p className="claim-preview-line">
                    {t.wouldBeClaim} <b className={preview.would ? 'ok' : 'bad'}>{preview.would ? t.settledTrue : t.settledFalse}</b>
                    {' '}({t.measured} {preview.measured} {METRIC_UNITS[metric] || ''} {operator} {threshold} {METRIC_UNITS[metric] || ''})
                  </p>
                )}
                <a href={sourceUrlFor(lat, lon, date)} target="_blank" rel="noreferrer">{t.openArchive}</a>
              </div>
            )}
            {status && <p className={`status ${statusBusy ? 'busy' : ''}`}><span className="dot" />{status}</p>}
            {error && <p className="error">{error}</p>}
            {snapFailed && (
              <div className="preview">
                <span className="preview-tag">{t.reviewerTag}</span>
                <p className="muted">{t.reviewerText}<b>{t.reviewerTextEm}</b>{t.reviewerTextEnd}</p>
                <button className="btn" onClick={doUseReviewerAccount}>{t.reviewerBtn}</button>
              </div>
            )}
            {walletMode === 'ephemeral' && ephemeralAddress && <p className="muted small">{t.writingAsPre}{ephemeralAddress}{t.writingAsMid}{wallet}{t.writingAsEnd}</p>}
            {tx && <p className="txline">{tx.kind} tx: <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer" className="mono">{tx.hash.slice(0, 18)}… ↗</a></p>}
            {createdClaimId !== null && <p className="status">Next step: <button className="linkbtn" onClick={() => doSettle(createdClaimId)}>settle case #{createdClaimId} on-chain</button></p>}
          </section>
        </Reveal>

        <Reveal delay={120}>
          <section className="panel tilt" id="attest">
            <div className="panel-kicker mono">v1 flow · {t.attestTitle}</div>
            <h2>{t.attestTitle}</h2>
            <p className="panel-sub">{t.attestSub}</p>
            <div className="actions">
              <button className="btn primary-large" onClick={doRequest} disabled={!configured || !wallet}>{t.btnRequest}</button>
            </div>
            {!wallet && <p className="muted">{t.needWallet}<b>{t.needWalletEm}</b>{t.needWalletEnd}</p>}
            {createdAttestId !== null && <p className="status">Next step: <button className="linkbtn" onClick={() => doVerify(createdAttestId)}>verify attestation #{createdAttestId} on-chain</button></p>}
            <p className="muted small">{t.attestLedgerSub}</p>
          </section>
        </Reveal>
      </main>

      <Reveal>
        <section className="ledger" id="claims">
          <div className="panel-head"><h2>{t.claimsTitle}</h2><button className="btn small secondary" onClick={loadLedger} disabled={listBusy}>{listBusy ? t.loading : t.refresh}</button></div>
          <p className="panel-sub">{t.claimsSub}</p>
          {!configured && <p className="muted">No contract configured in this build.</p>}
          {configured && claims.length === 0 && !listBusy && <p className="muted">{t.noClaims}</p>}
          <div className="list">
            {claims.map((c, i) => <Reveal key={c.id} delay={i * 60}><ClaimCard c={c} canWrite={Boolean(wallet)} settling={settlingId === c.id} onSettle={doSettle} t={t} lang={lang} /></Reveal>)}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="ledger" id="records">
          <div className="panel-head"><h2>{t.attestLedgerTitle}</h2><button className="btn small secondary" onClick={loadLedger} disabled={listBusy}>{listBusy ? t.loading : t.refresh}</button></div>
          <p className="panel-sub">{t.attestLedgerSub}</p>
          {configured && records.length === 0 && !listBusy && <p className="muted">{t.noRecords}</p>}
          <div className="list">
            {records.map((r, i) => <Reveal key={r.id} delay={i * 60}><RecordCard r={r} canWrite={Boolean(wallet)} verifying={verifyingId === r.id} onVerify={doVerify} t={t} lang={lang} /></Reveal>)}
          </div>
          <p className="muted small">Network: Stable Studionet ({CHAIN_ID}), RPC {RPC_URL}. Contract (v2): {configured ? <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="mono">{CONTRACT_ADDRESS.slice(0, 10)}… ↗</a> : 'not configured'}.</p>
        </section>
      </Reveal>

      <Reveal>
        <section className="ledger archive">
          <h2>{t.archiveTitle}</h2>
          <p className="panel-sub">{t.archiveSub}</p>
          {v1Record ? (
            <div className="filecard">
              <div className="filecard-top">
                <div>
                  <div className="filecard-place">{v1Record.location_name}</div>
                  <div className="filecard-meta">{t.recordNo} #{v1Record.id} · {v1Record.date} · {purposeLabelFor(lang, v1Record.purpose)}</div>
                </div>
                <Stamp status={v1Record.status} t={t} />
              </div>
              <div className="numbers">
                <div><b>{v1Record.precip_mm} mm</b><span>{t.precip}</span></div>
                <div><b>{v1Record.temp_min_c}° – {v1Record.temp_max_c}°C</b><span>{t.tempRange}</span></div>
                <div><b>{v1Record.wind_max_kmh} km/h</b><span>{t.wind}</span></div>
                <div><b>WMO {v1Record.weather_code}</b><span>{t.wmo}</span></div>
              </div>
              <div className="filecard-foot">
                <a href={sourceUrlFor(v1Record.latitude, v1Record.longitude, v1Record.date)} target="_blank" rel="noreferrer">{t.sourceData}</a>
                <a href={explorerAddress(V1_CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="mono">v1 contract ↗</a>
              </div>
            </div>
          ) : (
            <p className="muted">{v1Count === null ? t.loading : t.noRecords}</p>
          )}
          <p className="muted small">v1 records on-chain: {v1Count === null ? '…' : v1Count} · v1 contract: <a href={explorerAddress(V1_CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="mono">{V1_CONTRACT_ADDRESS.slice(0, 10)}… ↗</a></p>
        </section>
      </Reveal>

      <Reveal>
        <section className="trust">
          <div>
            <h2>{t.trustTitle}</h2>
            <p>{t.trustP1}</p>
            <p className="muted small">{t.trustLimits}</p>
          </div>
          <ul className="tolerance">
            <li><span>{t.tolVerdict}</span><b>{t.tolExact}</b></li>
            <li><span>{t.tolPrecip}</span><b>{t.tolPrecipVal}</b></li>
            <li><span>{t.tolTemp}</span><b>{t.tolTempVal}</b></li>
            <li><span>{t.tolWind}</span><b>{t.tolWindVal}</b></li>
            <li><span>{t.tolPlace}</span><b>{t.tolExact}</b></li>
          </ul>
        </section>
      </Reveal>

      <footer>{t.footer}</footer>
    </div>
  )
}
