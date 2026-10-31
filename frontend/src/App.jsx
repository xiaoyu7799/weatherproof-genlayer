import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CITIES, CONTRACT_ADDRESS, CHAIN_ID, RPC_URL, PURPOSES, classify, connectWalletAddress,
  explorerAddress, explorerTx, parseRecord, readClient, reviewerClient, sourceUrlFor,
  waitFinal, writeClient,
} from './genlayer.js'
import { LANGS, STRINGS, purposeLabelFor, verdictLabelFor } from './i18n.js'
import { createRainEngine } from './sound.js'

function yesterdayISO() {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

// Scroll-reveal: content pops out (rises + scales in) when it enters view.
function Reveal({ children, delay = 0 }) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect() }
    }, { threshold: 0.12 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return <div ref={ref} className={`reveal ${inView ? 'in' : ''}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>
}

function RecordCard({ r, onVerify, verifying, canWrite, t, lang }) {
  const verified = r.status === 'verified'
  return (
    <article className={`card ${verified ? 'verified' : 'pending'}`}>
      <div className="card-top">
        <div>
          <div className="card-place">{r.location_name}</div>
          <div className="card-meta">{r.date} · {purposeLabelFor(lang, r.purpose)} · #{r.id}</div>
        </div>
        <span className={`badge ${verified ? 'badge-' + r.verdict : 'badge-pending'}`}>
          {verified ? verdictLabelFor(lang, r.verdict) : t.pending}
        </span>
      </div>
      {verified ? (
        <div className="numbers">
          <div><b>{r.precip_mm} mm</b><span>{t.precip}</span></div>
          <div><b>{r.temp_min_c}° – {r.temp_max_c}°C</b><span>{t.tempRange}</span></div>
          <div><b>{r.wind_max_kmh} km/h</b><span>{t.wind}</span></div>
          <div><b>WMO {r.weather_code}</b><span>{t.wmo}</span></div>
        </div>
      ) : (
        <p className="muted">{t.recordsSub}</p>
      )}
      <div className="card-foot">
        <a href={sourceUrlFor(r.latitude, r.longitude, r.date)} target="_blank" rel="noreferrer">{t.sourceData}</a>
        <span className="mono">by {r.requester?.slice(0, 6)}…{r.requester?.slice(-4)}</span>
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
  if (!soundRef.current) soundRef.current = createRainEngine()
  const [intro, setIntro] = useState(() => {
    try {
      if (sessionStorage.getItem('wp-intro-seen')) return false
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
      return true
    } catch { return false }
  })
  const [introLeaving, setIntroLeaving] = useState(false)

  const [city, setCity] = useState(CITIES[0])
  const [custom, setCustom] = useState(false)
  const [lat, setLat] = useState(CITIES[0].lat)
  const [lon, setLon] = useState(CITIES[0].lon)
  const [date, setDate] = useState('2025-10-01')
  const [purpose, setPurpose] = useState(PURPOSES[0])
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
  const [records, setRecords] = useState([])
  const [listBusy, setListBusy] = useState(false)
  const [verifyingId, setVerifyingId] = useState(null)
  const [createdId, setCreatedId] = useState(null)
  const maxDate = yesterdayISO()
  const configured = Boolean(CONTRACT_ADDRESS)

  useEffect(() => {
    try { localStorage.setItem('wp-lang', lang) } catch {}
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    if (!intro) return
    const t1 = setTimeout(() => setIntroLeaving(true), 2100)
    const t2 = setTimeout(() => {
      setIntro(false)
      try { sessionStorage.setItem('wp-intro-seen', '1') } catch {}
    }, 2800)
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

  useEffect(() => {
    if (soundOn && /finalized/i.test(status)) soundRef.current.chime()
  }, [status, soundOn])

  useEffect(() => () => { soundRef.current.stop() }, [])

  function toggleSound() {
    if (soundOn) { soundRef.current.stop(); setSoundOn(false) }
    else if (soundRef.current.start()) setSoundOn(true)
  }

  const pickCity = (c) => { setCity(c); setLat(c.lat); setLon(c.lon); setCustom(false) }

  async function loadRecords() {
    if (!configured) return
    setListBusy(true)
    try {
      const c = readClient()
      const raw = await c.readContract({ address: CONTRACT_ADDRESS, functionName: 'list_attestations', args: [0n, 20n] })
      const list = parseRecord(raw)
      setRecords(Array.isArray(list) ? list.slice().reverse() : [])
    } catch (e) {
      setError('Could not load attestations: ' + (e?.message || e))
    } finally { setListBusy(false) }
  }
  useEffect(() => { loadRecords() }, [])

  async function doPreview() {
    setError(''); setPreview(null); setPreviewBusy(true)
    try {
      const res = await fetch(sourceUrlFor(lat, lon, date))
      const data = await res.json()
      const d = data.daily
      if (!d) throw new Error('No daily data returned for that date.')
      const precip = d.precipitation_sum[0], tmax = d.temperature_2m_max[0], tmin = d.temperature_2m_min[0], code = d.weather_code[0], wind = d.wind_speed_10m_max[0]
      setPreview({ precip, tmax, tmin, code, wind, verdict: classify(precip, code) })
    } catch (e) { setError('Preview failed: ' + (e?.message || e)) }
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
          : 'GenLayer Snap could not be installed in this wallet (' + msg + '). You can still continue with the reviewer test account below.')
      }
    } catch (e) { setError(e?.message || String(e)) }
  }

  function doUseReviewerAccount() {
    const { address, client } = reviewerClient()
    setEphemeralAddress(address); setClient(client); setWalletMode('ephemeral'); setSnapFailed(false); setError('')
    setStatus('Reviewer test account ready. Writes will be signed by this ephemeral Studionet account, not by your wallet.')
  }

  async function doRequest() {
    if (!wallet || !client) { setError('Connect a wallet first.'); return }
    setError(''); setTx(null); setStatus('Submitting request…')
    try {
      const hash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName: 'request_attestation', args: [city.name && !custom ? city.name : 'Custom location', String(lat), String(lon), date, purpose], value: 0n, leaderOnly: false })
      setTx({ kind: 'Request', hash }); setStatus('Request submitted — waiting for GenLayer finalization…')
      await waitFinal(readClient(), hash, (s) => setStatus(s === 'finalized' ? 'Request finalized.' : 'Request submitted — waiting for GenLayer finalization…'))
      const countRaw = await readClient().readContract({ address: CONTRACT_ADDRESS, functionName: 'get_count', args: [] })
      const id = Number(countRaw) - 1
      setCreatedId(id); setStatus(`Request finalized as attestation #${id}. Now verify it on-chain.`)
      await loadRecords()
    } catch (e) { setError('Request failed: ' + (e?.message || e)); setStatus('') }
  }

  async function doVerify(id) {
    if (!wallet || !client) { setError('Connect a wallet first.'); return }
    setError(''); setVerifyingId(id); setTx(null); setStatus(`Verifying #${id} — validators are independently fetching the archive day…`)
    try {
      const hash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName: 'verify_attestation', args: [BigInt(id)], value: 0n, leaderOnly: false })
      setTx({ kind: 'Verify', hash }); setStatus(`Verify submitted — waiting for validator consensus and finalization…`)
      await waitFinal(readClient(), hash, (s) => setStatus(s === 'finalized' ? `Attestation #${id} finalized.` : `Verify submitted — waiting for validator consensus…`))
      await loadRecords()
    } catch (e) { setError('Verification failed (the attestation stays pending and can be retried): ' + (e?.message || e)); setStatus('') }
    finally { setVerifyingId(null) }
  }

  const locationName = useMemo(() => custom ? 'Custom location' : city.name, [custom, city])
  const featured = records.find(r => r.status === 'verified') || records[0]
  const verifiedCount = records.filter(r => r.status === 'verified').length
  const statusBusy = /waiting|submitting|verifying|loading/i.test(status)

  return (
    <div className="page">
      {intro && (
        <div className={`intro ${introLeaving ? 'leaving' : ''}`} onClick={dismissIntro} role="button" aria-label={t.skipIntro}>
          <div className="intro-sky">
            <div className="intro-sun" />
            <div className="intro-cloud intro-cloud-a" />
            <div className="intro-cloud intro-cloud-b" />
            <div className="intro-rain"><i /><i /><i /><i /><i /><i /></div>
          </div>
          <img className="intro-logo" src="./logo.svg" alt="WeatherProof logo" />
          <div className="intro-title">WeatherProof</div>
          <div className="intro-tag">{t.introTag}</div>
          <div className="intro-bar"><i /></div>
          <div className="intro-skip">{t.skipIntro}</div>
        </div>
      )}

      <header className="top">
        <div className="brand"><img src="./logo.svg" alt="WeatherProof logo" /><div><b>WeatherProof</b><span>{t.brandTag}</span></div></div>
        <div className="top-right">
          <div className="langswitch" role="group" aria-label="Language">
            {LANGS.map(l => <button key={l.id} className={lang === l.id ? 'lang active' : 'lang'} onClick={() => setLang(l.id)}>{l.label}</button>)}
          </div>
          <button className={`soundbtn ${soundOn ? 'on' : ''}`} onClick={toggleSound} aria-pressed={soundOn} title={soundOn ? t.soundOff : t.soundOn}>
            {soundOn ? '♪ ' + t.soundOn : '♪ ' + t.soundOff}
          </button>
          <span className="net">Stable Studionet · {CHAIN_ID}</span>
          {wallet ? <span className="wallet mono">{wallet.slice(0, 6)}…{wallet.slice(-4)}{walletMode === 'ephemeral' && ephemeralAddress ? ` · test acct ${ephemeralAddress.slice(0, 6)}…${ephemeralAddress.slice(-4)}` : ''}</span> : <button className="btn" onClick={doConnect}>{t.connectWallet}</button>}
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="kicker"><i>●</i> {t.kicker}</p>
          <h1>{t.heroPre}<em>{t.heroEm}</em>{t.heroPost}</h1>
          <p className="lede">{t.lede}</p>
          <div className="hero-actions">
            <a className="btn primary-large" href="#create" style={{ textDecoration: 'none' }}>{t.ctaCreate}</a>
            <a className="btn secondary" href="#records" style={{ textDecoration: 'none' }}>{t.ctaRecords}</a>
          </div>
          <p className="hero-note">{t.heroNote}</p>
          {!configured && <div className="warn">This build has no contract address configured yet. Set <code>VITE_CONTRACT_ADDRESS</code> and rebuild — browsing and the browser preview still work.</div>}
        </div>
        <div className="sky" aria-hidden="true">
          <div className="sun" />
          <div className="cloud cloud-a" />
          <div className="cloud cloud-b" />
          <div className="rain"><i /><i /><i /><i /><i /><i /></div>
          <div className="sky-card">
            {featured ? (
              <>
                <div className="eyebrow">{t.liveFromChain} · {featured.status === 'verified' ? t.verified : t.pending} · #{featured.id}</div>
                <div className="sky-place">{featured.location_name} · {featured.date}</div>
                <div className="sky-meta">{purposeLabelFor(lang, featured.purpose)}{featured.status === 'verified' ? ` · ${verdictLabelFor(lang, featured.verdict)}` : ''}</div>
                {featured.status === 'verified' && (
                  <div className="sky-numbers">
                    <div><b>{featured.precip_mm} mm</b><span>{t.rain}</span></div>
                    <div><b>{featured.temp_min_c}°–{featured.temp_max_c}°C</b><span>{t.temp}</span></div>
                    <div><b>{featured.wind_max_kmh} km/h</b><span>{t.wind}</span></div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="eyebrow">{t.liveFromChain}</div>
                <div className="sky-place">{t.loadingRecord}</div>
                <div className="skeleton" style={{ marginTop: 12 }} />
              </>
            )}
          </div>
        </div>
      </section>

      <Reveal>
        <section className="stats" aria-label="Live stats">
          <div className="stat"><b>{records.length}</b><span>{t.statTotal}</span></div>
          <div className="stat"><b>{verifiedCount}</b><span>{t.statVerified}</span></div>
          <div className="stat"><b>61999</b><span>{t.statChain}</span></div>
          <div className="stat"><b>ERA5</b><span>{t.statSource}</span></div>
        </section>
      </Reveal>

      <Reveal delay={80}>
        <ol className="steps">
          <li><div className="step-no">01</div><b>{t.step1Title}</b><span>{t.step1Desc}</span></li>
          <li><div className="step-no">02</div><b>{t.step2Title}</b><span>{t.step2Desc}</span></li>
          <li><div className="step-no">03</div><b>{t.step3Title}</b><span>{t.step3Desc}</span></li>
        </ol>
      </Reveal>

      <main className="grid">
        <Reveal>
          <section className="panel" id="create">
            <h2>{t.createTitle}</h2>
            <p className="panel-sub">{t.createSub}</p>
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
            <div className="actions">
              <button className="btn primary-large" onClick={doRequest} disabled={!configured || !wallet}>{t.btnRequest}</button>
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
            {createdId !== null && <p className="status">Next step: <button className="linkbtn" onClick={() => doVerify(createdId)}>verify attestation #{createdId} on-chain</button></p>}
          </section>
        </Reveal>

        <Reveal delay={120}>
          <section className="panel" id="records">
            <div className="panel-head"><h2>{t.recordsTitle}</h2><button className="btn small secondary" onClick={loadRecords} disabled={listBusy}>{listBusy ? t.loading : t.refresh}</button></div>
            <p className="panel-sub">{t.recordsSub}</p>
            {!configured && <p className="muted">No contract configured in this build.</p>}
            {configured && records.length === 0 && !listBusy && <p className="muted">{t.noRecords}</p>}
            <div className="list">
              {records.map((r, i) => <Reveal key={r.id} delay={i * 80}><RecordCard r={r} canWrite={Boolean(wallet)} verifying={verifyingId === r.id} onVerify={doVerify} t={t} lang={lang} /></Reveal>)}
            </div>
            <p className="muted small">Network: Stable Studionet ({CHAIN_ID}), RPC {RPC_URL}. Contract: {configured ? <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="mono">{CONTRACT_ADDRESS.slice(0, 10)}… ↗</a> : 'not configured'}.</p>
          </section>
        </Reveal>
      </main>

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
