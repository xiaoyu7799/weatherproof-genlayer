import React, { useEffect, useMemo, useState } from 'react'
import {
  CITIES, CONTRACT_ADDRESS, CHAIN_ID, RPC_URL, PURPOSES, classify, connectWallet,
  explorerAddress, explorerTx, parseRecord, readClient, sourceUrlFor, verdictLabel,
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
    <article className="card">
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
    setError('')
    try {
      const { address, client } = await connectWallet()
      setWallet(address); setClient(client); setStatus('Wallet connected on Stable Studionet.')
    } catch (e) { setError(e?.message || String(e)) }
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

  return (
    <div className="page">
      <header className="top">
        <div className="brand"><img src="./logo.svg" alt="WeatherProof logo" /><div><b>WeatherProof</b><span>Past-weather proof, on-chain</span></div></div>
        <div className="top-right">
          <span className="net">Stable Studionet · {CHAIN_ID}</span>
          {wallet ? <span className="wallet mono">{wallet.slice(0, 6)}…{wallet.slice(-4)}</span> : <button className="btn" onClick={doConnect}>Connect wallet</button>}
        </div>
      </header>

      <section className="hero">
        <p className="kicker">A screenshot proves nothing. This does.</p>
        <h1>Was it really<br />raining that day?</h1>
        <p className="lede">Pick a place and a past date. GenLayer validators independently fetch the same day from the Open-Meteo Archive and must agree on the verdict before it is stored on-chain — a neutral record you can share instead of a screenshot.</p>
        <ol className="steps">
          <li><b>1 · Request</b><span>Place, date, purpose</span></li>
          <li><b>2 · Verify</b><span>Validators re-fetch &amp; agree</span></li>
          <li><b>3 · Share</b><span>Verified card + source URL</span></li>
        </ol>
        {!configured && <div className="warn">This build has no contract address configured yet. Set <code>VITE_CONTRACT_ADDRESS</code> and rebuild — browsing and the browser preview still work.</div>}
      </section>

      <main className="grid">
        <section className="panel">
          <h2>Create an attestation</h2>
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
            <button className="btn secondary" onClick={doPreview} disabled={previewBusy}>{previewBusy ? 'Loading…' : 'Browser preview (not on-chain)'}</button>
            <button className="btn" onClick={doRequest} disabled={!configured || !wallet}>Request on-chain</button>
          </div>
          {!wallet && <p className="muted">On-chain requests need a wallet. The browser preview below is free and needs no wallet — but it is <b>not</b> an on-chain attestation.</p>}
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
          {status && <p className="status">{status}</p>}
          {error && <p className="error">{error}</p>}
          {tx && <p className="txline">{tx.kind} tx: <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer" className="mono">{tx.hash.slice(0, 18)}… ↗</a></p>}
          {createdId !== null && <p className="status">Next step: <button className="linkbtn" onClick={() => doVerify(createdId)}>verify attestation #{createdId} on-chain</button></p>}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Attestations on-chain</h2><button className="btn small secondary" onClick={loadRecords} disabled={listBusy}>{listBusy ? 'Loading…' : 'Refresh'}</button></div>
          {!configured && <p className="muted">No contract configured in this build.</p>}
          {configured && records.length === 0 && !listBusy && <p className="muted">No attestations yet. Be the first: request one, then verify it.</p>}
          <div className="list">
            {records.map(r => <RecordCard key={r.id} r={r} canWrite={Boolean(wallet)} verifying={verifyingId === r.id} onVerify={doVerify} />)}
          </div>
          <p className="muted small">Network: Stable Studionet ({CHAIN_ID}), RPC {RPC_URL}. Contract: {configured ? <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="mono">{CONTRACT_ADDRESS.slice(0, 10)}… ↗</a> : 'not configured'}.</p>
        </section>
      </main>

      <section className="trust">
        <h2>How consensus actually works here</h2>
        <p>The contract does not trust one fetch. The leader fetches the archive day, extracts precipitation, temperatures, wind and the WMO code, and derives a verdict from fixed thresholds. Each validator re-fetches the same URL and only accepts the result if the verdict and weather code match exactly and the numbers agree within tolerance (precipitation max 0.5 mm / 10%, temperatures 1 °C, wind 2 km/h). If they disagree, nothing is stored and the request stays pending.</p>
        <p className="muted small">Honest limits: Open-Meteo Archive data is reanalysis for the grid cell around the coordinates, in GMT, for the whole day — not a station reading for a street address or an hour, and not a legal certificate. A verified record means “these validators agreed on this archive day”, nothing more.</p>
      </section>

      <footer>WeatherProof · GenLayer Intelligent Contract · Source: Open-Meteo Archive (ERA5) · No API key, no server, no funds on Studionet.</footer>
    </div>
  )
}
