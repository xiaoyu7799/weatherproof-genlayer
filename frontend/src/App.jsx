import React, { useEffect, useMemo, useState } from 'react'
import {
  CITIES, CONTRACT_ADDRESS, CHAIN_ID, RPC_URL, PURPOSES, classify, connectWalletAddress,
  explorerAddress, explorerTx, parseRecord, readClient, reviewerClient, sourceUrlFor, verdictLabel,
  waitFinal, writeClient,
} from './genlayer.js'

function yesterdayISO() {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function RecordCard({ r, onVerify, verifying, canWrite }) {
  const verified = r.status === 'verified'
  return (
    <article className={`card ${verified ? 'verified' : 'pending'}`}>
      <div className="card-top">
        <div>
          <div className="card-place">{r.location_name}</div>
          <div className="card-meta">{r.date} · {r.purpose} · #{r.id}</div>
        </div>
        <span className={`badge ${verified ? 'badge-' + r.verdict : 'badge-pending'}`}>
          {verified ? verdictLabel(r.verdict) : 'Pending'}
        </span>
      </div>
      {verified ? (
        <div className="numbers">
          <div><b>{r.precip_mm} mm</b><span>precipitation</span></div>
          <div><b>{r.temp_min_c}° – {r.temp_max_c}°C</b><span>min – max</span></div>
          <div><b>{r.wind_max_kmh} km/h</b><span>max wind</span></div>
          <div><b>WMO {r.weather_code}</b><span>weather code</span></div>
        </div>
      ) : (
        <p className="muted">Requested, not yet verified. Verification makes GenLayer validators independently fetch the same archive day and agree on the verdict before anything is stored.</p>
      )}
      <div className="card-foot">
        <a href={sourceUrlFor(r.latitude, r.longitude, r.date)} target="_blank" rel="noreferrer">Source data ↗</a>
        <span className="mono">by {r.requester?.slice(0, 6)}…{r.requester?.slice(-4)}</span>
        {!verified && canWrite && (
          <button className="btn small" disabled={verifying} onClick={() => onVerify(r.id)}>
            {verifying ? 'Verifying…' : 'Verify on-chain'}
          </button>
        )}
      </div>
    </article>
  )
}

export default function App() {
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
      // Step 1: any injected wallet (MetaMask, OKX, Rabby, Coinbase, …)
      // can connect for address + chain. Step 2: try the GenLayer Snap.
      const address = await connectWalletAddress()
      setWallet(address)
      const client = writeClient(address)
      try {
        await client.connect('studionet')
        setClient(client); setWalletMode('snap'); setStatus('Wallet connected on Stable Studionet (GenLayer Snap ready).')
      } catch (snapErr) {
        // Snap-capable MetaMask is NOT required to proceed: the reviewer
        // can fall back to an ephemeral test account below. Keep the
        // wallet address connected for display; do not fake a Snap client.
        setSnapFailed(true)
        const msg = snapErr?.message || String(snapErr)
        setError(/wallet_getSnaps|wallet_requestSnaps|32601|method not found/i.test(msg)
          ? 'This wallet does not support MetaMask Snaps (wallet_getSnaps not found). GenLayer writes need desktop MetaMask with Snaps — or use the reviewer test account below, which works with any wallet.'
          : 'GenLayer Snap could not be installed in this wallet (' + msg + '). You can still continue with the reviewer test account below.')
      }
    } catch (e) { setError(e?.message || String(e)) }
  }

  function doUseReviewerAccount() {
    // Ephemeral, Studionet-only account generated in this browser.
    // The key never leaves the browser and is discarded on refresh.
    // On-chain requester will be this address, NOT the connected wallet —
    // shown honestly in the header and in the trust panel.
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
      <header className="top">
        <div className="brand"><img src="./logo.svg" alt="WeatherProof logo" /><div><b>WeatherProof</b><span>Past-weather proof, on-chain</span></div></div>
        <div className="top-right">
          <span className="net">Stable Studionet · {CHAIN_ID}</span>
          {wallet ? <span className="wallet mono">{wallet.slice(0, 6)}…{wallet.slice(-4)}{walletMode === 'ephemeral' && ephemeralAddress ? ` · test acct ${ephemeralAddress.slice(0, 6)}…${ephemeralAddress.slice(-4)}` : ''}</span> : <button className="btn" onClick={doConnect}>Connect wallet</button>}
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="kicker"><i>●</i> Neutral proof · Not a screenshot · GenLayer consensus</p>
          <h1>Was it really<br /><em>raining</em> that day?</h1>
          <p className="lede">Pick a place and a past date. GenLayer validators independently fetch the same day from the Open-Meteo Archive and must agree on the verdict before it is stored on-chain — a record you can share instead of an editable screenshot.</p>
          <div className="hero-actions">
            <a className="btn primary-large" href="#create" style={{ textDecoration: 'none' }}>Create an attestation →</a>
            <a className="btn secondary" href="#records" style={{ textDecoration: 'none' }}>See verified records</a>
          </div>
          <p className="hero-note">Free on gasless Stable Studionet. No server, no API key, no funds. The card on the right is a real record read live from the contract — not a mock.</p>
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
                <div className="eyebrow">Live from chain · {featured.status === 'verified' ? 'Verified' : 'Pending'} · #{featured.id}</div>
                <div className="sky-place">{featured.location_name} · {featured.date}</div>
                <div className="sky-meta">{featured.purpose}{featured.status === 'verified' ? ` · ${verdictLabel(featured.verdict)}` : ''}</div>
                {featured.status === 'verified' && (
                  <div className="sky-numbers">
                    <div><b>{featured.precip_mm} mm</b><span>rain</span></div>
                    <div><b>{featured.temp_min_c}°–{featured.temp_max_c}°C</b><span>temp</span></div>
                    <div><b>{featured.wind_max_kmh} km/h</b><span>wind</span></div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="eyebrow">Live from chain</div>
                <div className="sky-place">Loading the latest record…</div>
                <div className="skeleton" style={{ marginTop: 12 }} />
              </>
            )}
          </div>
        </div>
      </section>

      <section className="stats" aria-label="Live stats">
        <div className="stat"><b>{records.length}</b><span>Attestations on-chain</span></div>
        <div className="stat"><b>{verifiedCount}</b><span>Verified</span></div>
        <div className="stat"><b>61999</b><span>Studionet chain ID</span></div>
        <div className="stat"><b>ERA5</b><span>Open-Meteo Archive</span></div>
      </section>

      <ol className="steps">
        <li><div className="step-no">01</div><b>Request</b><span>Place, past date, purpose — stored with the exact archive URL to be fetched.</span></li>
        <li><div className="step-no">02</div><b>Verify</b><span>Every validator re-fetches the same day and must agree, or nothing is stored.</span></li>
        <li><div className="step-no">03</div><b>Share</b><span>A verified card with its verdict, numbers and source link — checkable by anyone.</span></li>
      </ol>

      <main className="grid">
        <section className="panel" id="create">
          <h2>Create an attestation</h2>
          <p className="panel-sub">Choose a preset city or custom coordinates, a past date and a purpose. Preview is free and needs no wallet — but only the on-chain flow creates a verified record.</p>
          <div className="chips">
            {CITIES.map(c => <button key={c.name} className={!custom && city.name === c.name ? 'chip active' : 'chip'} onClick={() => pickCity(c)}>{c.name}</button>)}
            <button className={custom ? 'chip active' : 'chip'} onClick={() => setCustom(true)}>Custom coords</button>
          </div>
          {custom && (
            <div className="row">
              <Field label="Latitude"><input value={lat} onChange={e => setLat(e.target.value)} inputMode="decimal" /></Field>
              <Field label="Longitude"><input value={lon} onChange={e => setLon(e.target.value)} inputMode="decimal" /></Field>
            </div>
          )}
          {!custom && <p className="muted">Coordinates: {lat}, {lon} — {locationName}</p>}
          <div className="row">
            <Field label="Past date"><input type="date" value={date} min="1940-01-01" max={maxDate} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Purpose"><select value={purpose} onChange={e => setPurpose(e.target.value)}>{PURPOSES.map(p => <option key={p}>{p}</option>)}</select></Field>
          </div>
          <div className="actions">
            <button className="btn primary-large" onClick={doRequest} disabled={!configured || !wallet}>Request on-chain</button>
            <button className="btn secondary" onClick={doPreview} disabled={previewBusy}>{previewBusy ? 'Loading…' : 'Browser preview (not on-chain)'}</button>
          </div>
          {!wallet && <p className="muted">On-chain requests need a wallet. The browser preview is free and needs no wallet — but it is <b>not</b> an on-chain attestation.</p>}
          {preview && (
            <div className="preview">
              <span className="preview-tag">Browser preview only — not on-chain</span>
              <div className="numbers">
                <div><b>{preview.precip} mm</b><span>precipitation</span></div>
                <div><b>{preview.tmin}° – {preview.tmax}°C</b><span>min – max</span></div>
                <div><b>{preview.wind} km/h</b><span>max wind</span></div>
                <div><b>{verdictLabel(preview.verdict)}</b><span>would-be verdict</span></div>
              </div>
              <a href={sourceUrlFor(lat, lon, date)} target="_blank" rel="noreferrer">Open the exact archive URL ↗</a>
            </div>
          )}
          {status && <p className={`status ${statusBusy ? 'busy' : ''}`}><span className="dot" />{status}</p>}
          {error && <p className="error">{error}</p>}
          {snapFailed && (
            <div className="preview">
              <span className="preview-tag">Works with any wallet — reviewer test account</span>
              <p className="muted">Your wallet (OKX, Rabby, mobile, …) cannot install the GenLayer Snap — that is a GenLayer limitation, not a bug in this app. You can still test the full on-chain flow: this generates a temporary test account in your browser, on gasless Studionet only. Its key never leaves your browser and is discarded on refresh. Transactions will be real on-chain transactions, but the requester shown on-chain will be this test account, <b>not</b> your wallet address.</p>
              <button className="btn" onClick={doUseReviewerAccount}>Continue with reviewer test account</button>
            </div>
          )}
          {walletMode === 'ephemeral' && ephemeralAddress && <p className="muted small">Writing as ephemeral test account {ephemeralAddress} (Studionet only, browser-only key, discarded on refresh) — not as your wallet {wallet}.</p>}
          {tx && <p className="txline">{tx.kind} tx: <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer" className="mono">{tx.hash.slice(0, 18)}… ↗</a></p>}
          {createdId !== null && <p className="status">Next step: <button className="linkbtn" onClick={() => doVerify(createdId)}>verify attestation #{createdId} on-chain</button></p>}
        </section>

        <section className="panel" id="records">
          <div className="panel-head"><h2>Attestations on-chain</h2><button className="btn small secondary" onClick={loadRecords} disabled={listBusy}>{listBusy ? 'Loading…' : 'Refresh'}</button></div>
          <p className="panel-sub">Newest first. Verified means validators agreed on that archive day; pending means it is waiting for verification.</p>
          {!configured && <p className="muted">No contract configured in this build.</p>}
          {configured && records.length === 0 && !listBusy && <p className="muted">No attestations yet. Be the first: request one, then verify it.</p>}
          <div className="list">
            {records.map(r => <RecordCard key={r.id} r={r} canWrite={Boolean(wallet)} verifying={verifyingId === r.id} onVerify={doVerify} />)}
          </div>
          <p className="muted small">Network: Stable Studionet ({CHAIN_ID}), RPC {RPC_URL}. Contract: {configured ? <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="mono">{CONTRACT_ADDRESS.slice(0, 10)}… ↗</a> : 'not configured'}.</p>
        </section>
      </main>

      <section className="trust">
        <div>
          <h2>How consensus actually works here</h2>
          <p>The contract does not trust one fetch. The leader fetches the archive day, extracts precipitation, temperatures, wind and the WMO code, and derives a verdict from fixed thresholds. Each validator re-fetches the same URL and only accepts the result if it matches — otherwise nothing is stored and the request stays pending.</p>
          <p className="muted small">Honest limits: Open-Meteo Archive data is reanalysis for the grid cell around the coordinates, in GMT, for the whole day — not a station reading for a street address or an hour, and not a legal certificate. A verified record means “these validators agreed on this archive day”, nothing more.</p>
        </div>
        <ul className="tolerance">
          <li><span>Verdict &amp; weather code</span><b>exact match</b></li>
          <li><span>Precipitation</span><b>max 0.5 mm / 10%</b></li>
          <li><span>Temperatures</span><b>± 1 °C</b></li>
          <li><span>Max wind</span><b>± 2 km/h</b></li>
          <li><span>Place &amp; date</span><b>exact match</b></li>
        </ul>
      </section>

      <footer>WeatherProof · GenLayer Intelligent Contract · Source: Open-Meteo Archive (ERA5) · No API key, no server, no funds on Studionet.</footer>
    </div>
  )
}
