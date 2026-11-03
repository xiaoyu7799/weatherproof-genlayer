# WeatherProof

**Was it really raining that day? Prove it, on-chain.**

🌐 **Live site:** https://xiaoyu7799.github.io/weatherproof-genlayer/
🔗 **Contract v2 (Stable Studionet):** https://explorer-studio.genlayer.com/address/0x8dd15ee51a226C459d95c9a7Bbb4f73d6f8e38B9

WeatherProof creates a neutral, shareable record of past weather. Pick a place
and a past date, and GenLayer validators independently fetch the same day
from the Open-Meteo Archive and must agree on the verdict before it is
stored on-chain. A screenshot of a weather app proves nothing — anyone can
edit it. This record cannot be edited by one person alone.

## What's new in v2: weather claims

v1 answered "what was the weather?" v2 answers the question people
actually dispute: **"did the weather condition hold?"** A claim states a
metric, an operator and a threshold — e.g. "precipitation in London on
2025-10-01 was ≥ 0.1 mm" — and validators settle it on-chain to a single
`settled_true` or `settled_false`. Claims reuse v1's fetch and tolerance
agreement exactly; the only new step is a deterministic comparison of the
agreed measured value against the threshold. A failed fetch or validator
disagreement leaves the claim `pending` (fail-closed, retryable), and a
settled claim is never overwritten. See [`docs/claims.md`](docs/claims.md)
for the full mechanism.

The v2 contract also keeps the whole v1 attestation flow working
unchanged, and the v1 contract's records remain readable (see
"Contract" below).

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

- Current contract (v2): source [`contracts/weatherproof_v2.py`](contracts/weatherproof_v2.py),
  address `0x8dd15ee51a226C459d95c9a7Bbb4f73d6f8e38B9`, deploy tx
  `0x49fe439b8f7363777b7e9e96925f5bba0cbb213240dfb0add3cff5b561366387` (FINALIZED).
  Deploy record: [`deployment.json`](deployment.json); claims loop evidence:
  [`evidence-v2.json`](evidence-v2.json).
- Earlier contract (v1): source [`contracts/weatherproof.py`](contracts/weatherproof.py),
  address `0x304ba2D879EaC48bB0030cB0A196499d34c15137`. Its records remain
  readable; v2 never rewrites them. v1 deploy record:
  [`deployment-v1.json`](deployment-v1.json); v1 flow evidence:
  [`evidence.json`](evidence.json).
- Studio: `https://studio.genlayer.com/?import-contract=0x8dd15ee51a226C459d95c9a7Bbb4f73d6f8e38B9`
- Explorer: `https://explorer-studio.genlayer.com/address/0x8dd15ee51a226C459d95c9a7Bbb4f73d6f8e38B9`

File mapping: `deployment.json` always holds the CURRENT contract (the
GitHub Pages workflow reads the contract address from it at build time);
`deployment-v1.json` is the preserved v1 record. `evidence.json` is the v1
flow; `evidence-v2.json` is the v2 claims loop.

### API

Writes:

| Method | Inputs | Result |
| --- | --- | --- |
| `request_attestation` | `location_name`, `latitude`, `longitude` (strings), `date` (YYYY-MM-DD), `purpose` | new attestation id (`u256`) |
| `verify_attestation` | `attestation_id` | verified record as JSON (only after validator agreement) |
| `create_claim` (v2) | `location_name`, `latitude`, `longitude`, `date`, `metric` (one of `precipitation_sum`, `temperature_2m_max`, `temperature_2m_min`, `wind_speed_10m_max`), `operator` (`>=` or `<=`), `threshold` (string), `purpose` | new claim id (`u256`); per-owner cap 32 |
| `settle_claim` (v2) | `claim_id` | settled claim as JSON (`settled_true` / `settled_false` with `measured_value`), only after validator agreement |

Views:

| Method | Inputs | Result |
| --- | --- | --- |
| `get_attestation` | `attestation_id` | record as JSON |
| `get_count` | — | number of attestations |
| `list_attestations` | `offset`, `limit` (1–20) | records as JSON, oldest first |
| `get_claim` (v2) | `claim_id` | claim as JSON |
| `get_claim_count` (v2) | — | number of claims |
| `list_claims` (v2) | `offset`, `limit` (1–20) | claims as JSON, oldest first |

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

**Experience.** The site is a meteorological evidence ledger: archival
paper and ink, stamped verdicts (TRUE in verdigris, FALSE in iron red,
pending in ochre), tabular ledgers, monospaced coordinates and dates.
Two languages (English, 中文) switchable in the header and remembered;
an ambient rain sound generated in the browser with the Web Audio API,
never autoplaying on load, auto-enabled on the first click anywhere
except the sound button, never auto-re-enabled after a manual close,
with a short chime when a transaction reaches FINALIZED; an opening
splash once per session (click anywhere to skip); scroll-reveal content;
claim lifecycle animation (file → pending → settling → stamped verdict);
and mouse playfulness on fine pointers — a cursor glow, card tilt and
magnetic actions — all disabled for touch devices and reduced-motion
users.

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

For v2 (deploy + claims loop, TRUE and FALSE from the same known day):

```bash
node scripts/deploy-v2.mjs
# writes deployment.json (v2), preserving the v1 record as deployment-v1.json
node scripts/flow-v2.mjs
# writes evidence-v2.json: create/settle txs, final statuses, settled claims
```

The private key is never written to `deployment.json` or `evidence.json`.

## Repository layout

```
contracts/weatherproof.py     v1 Intelligent Contract (GenVM, Python)
contracts/weatherproof_v2.py  v2 contract: v1 flow + weather claims
tests/test_weatherproof_v2.py v2 tests (16 tests, plain python3)
frontend/                     Vite + React app (genlayer-js 1.1.8, Studionet only)
scripts/deploy.mjs            Deploy v1 to Studionet, write deployment.json
scripts/flow.mjs              Request → verify → read back, write evidence.json
scripts/deploy-v2.mjs         Deploy v2, preserve v1 record, write deployment.json
scripts/flow-v2.mjs           Claims loop (TRUE + FALSE), write evidence-v2.json
docs/                         Consensus design, claims mechanism, limits
assets/logo.svg               Project logo
deployment.json               CURRENT contract record (v2; read by the Pages workflow)
deployment-v1.json            Preserved v1 record
evidence.json                 v1 flow evidence
evidence-v2.json              v2 claims loop evidence
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

- Python syntax check: `python3 -m py_compile contracts/weatherproof_v2.py`
- v2 tests: `python3 tests/test_weatherproof_v2.py` (16 tests: claim
  validation, TRUE/FALSE settlement, fail-closed, disagreement, v1
  regression)
- Live flow on Stable Studionet (v1): `npm run deploy && npm run flow`
  (see `evidence.json` for the recorded hashes and final status)
- Live claims loop on Stable Studionet (v2): `node scripts/deploy-v2.mjs
  && node scripts/flow-v2.mjs` (see `evidence-v2.json`: deploy +
  create/settle TRUE + create/settle FALSE, all FINALIZED)

## License

MIT.
