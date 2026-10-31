# WeatherProof

**Was it really raining that day? Prove it, on-chain.**

🌐 **Live site:** https://xiaoyu7799.github.io/weatherproof-genlayer/
🔗 **Contract (Stable Studionet):** https://explorer-studio.genlayer.com/address/0x304ba2D879EaC48bB0030cB0A196499d34c15137

WeatherProof creates a neutral, shareable record of past weather. Pick a place
and a past date, and GenLayer validators independently fetch the same day
from the Open-Meteo Archive and must agree on the verdict before it is
stored on-chain. A screenshot of a weather app proves nothing — anyone can
edit it. This record cannot be edited by one person alone.

Typical uses: outdoor events, photo shoots, farm work, delivery and site
visits, sports fixtures — anywhere two people later disagree about whether
it rained.

## What GenLayer actually does here

This is not a frontend that calls a weather API and then writes the answer
to a chain. The **Intelligent Contract itself** fetches the web:

1. `request_attestation` (deterministic) stores the place, coordinates,
   past date, purpose and the exact Open-Meteo Archive URL to be fetched.
2. `verify_attestation` (non-deterministic) runs on the leader and on every
   validator. Each one fetches that URL, extracts daily precipitation,
   max/min temperature, wind and the WMO weather code, and derives a verdict
   from fixed thresholds in the contract — never from free-form LLM text.
3. A validator accepts the leader result **only if** it independently
   reproduced it: same verdict, same weather code, precipitation within
   max(0.5 mm, 10%), temperatures within 1 °C, wind within 2 km/h, and the
   same latitude, longitude and date as the stored request. Checking only
   the shape of the leader output would not be consensus, so the contract
   never does that.
4. Only after agreement is the verified record written. A failed fetch
   writes nothing, so the attestation stays `pending` and can be retried.
   A verified attestation can never be overwritten.

Verdict rules (daily aggregates, GMT): thunderstorm if WMO code is 95/96/99;
otherwise heavy rain at ≥ 10 mm precipitation, rain at ≥ 2.5 mm, light rain
at ≥ 0.1 mm, snow for WMO snow codes, otherwise dry.

## Network — Stable Studionet only

| Item | Value |
| --- | --- |
| Network | Stable Studionet |
| Chain ID | 61999 |
| RPC | https://studio.genlayer.com/api |
| Explorer | https://explorer-studio.genlayer.com |
| Cost | 0 GEN on Studionet (gasless); no API key, no server, no purchases |

No other network is used. Do not point this project at another chain.

## Contract

- Source: [`contracts/weatherproof.py`](contracts/weatherproof.py)
- Deployed address, deploy tx and evidence: see [`deployment.json`](deployment.json)
  and [`evidence.json`](evidence.json) once deployment has run.
- Studio: `https://studio.genlayer.com/?import-contract=<address>`
- Explorer: `https://explorer-studio.genlayer.com/address/<address>`

### API

Writes:

| Method | Inputs | Result |
| --- | --- | --- |
| `request_attestation` | `location_name`, `latitude`, `longitude` (strings), `date` (YYYY-MM-DD), `purpose` | new attestation id (`u256`) |
| `verify_attestation` | `attestation_id` | verified record as JSON (only after validator agreement) |

Views:

| Method | Inputs | Result |
| --- | --- | --- |
| `get_attestation` | `attestation_id` | record as JSON |
| `get_count` | — | number of attestations |
| `list_attestations` | `offset`, `limit` (1–20) | records as JSON, oldest first |

Input bounds: location 2–80 chars, purpose 2–120 chars, latitude −90…90,
longitude −180…180, date 1940-01-01…2100-12-31 in YYYY-MM-DD form. The
frontend additionally restricts dates to yesterday or earlier, because the
Archive API is for past days; a future date will fail verification and stay
pending.

## Frontend

The frontend is a static Vite + React app in [`frontend/`](frontend/).
It handles wallet connection, network checking (adds/switches to Studionet
61999), transaction submission, waiting for `FINALIZED`, reading the
result back, and error feedback.

**Two modes, never confused:**

- **Browser preview** — fetches Open-Meteo directly in your browser. It is
  labelled “Browser preview only — not on-chain” everywhere it appears.
  It never pretends to be an on-chain result.
- **On-chain mode** — requests and verifies through the contract above.
  Writes are signed through the official GenLayer MetaMask Snap, the
  documented Studionet path in `genlayer-js` 1.1.8, when the connected
  wallet supports it.

**Wallet compatibility — not MetaMask-only.** Any injected EVM wallet
(MetaMask, OKX, Rabby, Coinbase, …) can connect and read. If a wallet
cannot install the GenLayer Snap (e.g. OKX, which has no
`wallet_getSnaps`), the app does not block the reviewer: it offers a
clearly labelled **reviewer test account** — an ephemeral account
generated in the browser, on gasless Studionet only, whose key never
leaves the browser and is discarded on refresh. Transactions signed this
way are real on-chain transactions, but the requester shown on-chain is
the test account, not the reviewer's wallet address, and the UI says so.
It never presents a test-account transaction as wallet-signed, and it
never fakes a result. Reading existing attestations still works without
any wallet.

**Experience.** The site is designed to be browsed, not just used:
four languages (English, 中文, 日本語, 한국어) switchable in the header
and remembered; an ambient rain sound generated in the browser with the
Web Audio API, off by default and only started by the user's toggle,
with a short chime when a transaction reaches FINALIZED; an opening
splash animation once per session (click anywhere to skip); content
that pops in as you scroll; and mouse playfulness on fine pointers —
a cursor glow, hero parallax, card tilt and magnetic buttons — all
disabled for touch devices and reduced-motion users.

### Run it locally

```bash
cd frontend
npm install
VITE_CONTRACT_ADDRESS=0xYourDeployedAddress npm run build
npm run preview
```

Or, for development (contract address still read from the same env var):

```bash
VITE_CONTRACT_ADDRESS=0xYourDeployedAddress npm run dev
```

### Deploy the contract

```bash
npm install
# Studionet is gasless; a key is only needed to identify the deployer.
# Omit it for an ephemeral deployer (the contract is permissionless).
GENLAYER_PRIVATE_KEY=0x... npm run deploy
```

Then run the full on-chain flow (request → verify → read back) and save
the evidence:

```bash
npm run flow
# writes evidence.json: request tx, verify tx, final status, verified record
```

The private key is never written to `deployment.json` or `evidence.json`.

## Repository layout

```
contracts/weatherproof.py   Intelligent Contract (GenVM, Python)
frontend/                   Vite + React app (genlayer-js 1.1.8, Studionet only)
scripts/deploy.mjs          Deploy to Studionet, write deployment.json
scripts/flow.mjs            Request → verify → read back, write evidence.json
docs/                       Consensus design, limits, submission copy
assets/logo.svg             Project logo
deployment.json             Filled in by scripts/deploy.mjs (not hand-edited)
evidence.json               Filled in by scripts/flow.mjs (not hand-edited)
```

## Honest limits

- Open-Meteo Archive data is ERA5 reanalysis for the grid cell around the
  coordinates, aggregated over the day in GMT. It is not a station
  observation for a precise street address or hour, and it is not a legal
  weather certificate.
- A verified record means “GenLayer validators agreed on this archive
  day under the thresholds above”. It does not prove what happened at a
  single doorstep, and it is not an insurance decision.
- Verification needs validator consensus and can take a minute or more.
  If consensus is not reached, the attestation stays pending — the app
  says so, and retrying is safe.

## Tests / checks done

- Python syntax check: `python3 -m py_compile contracts/weatherproof.py`
- Frontend build: `cd frontend && npm run build`
- Live flow on Stable Studionet: `npm run deploy && npm run flow`
  (see `evidence.json` for the recorded hashes and final status)

## License

MIT.
