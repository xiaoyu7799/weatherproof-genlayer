# Weather claims (v2)

v1 answered "what was the weather, at this place, on that day?" and stored
the verified record. v2 answers the question people actually dispute:
"did the weather condition hold?" — a claim with a threshold, settled
on-chain to a single TRUE or FALSE.

## Lifecycle

1. `create_claim` (deterministic) stores the place, coordinates, past date,
   metric, operator, threshold and purpose, together with the exact
   Open-Meteo Archive URL to be fetched. Status starts `pending`.
2. `settle_claim` (non-deterministic) runs on the leader and on every
   validator. Each one fetches the stored URL and must reproduce the same
   day within the v1 tolerances (see below). Only then does the contract
   compare the agreed measured metric value against the threshold and
   settle deterministically: `settled_true` or `settled_false`.
3. A settled claim is never overwritten or re-settled. `get_claim`,
   `list_claims` and `get_claim_count` read claims; the v1 attestation
   functions keep working unchanged on the same contract.

## Claim fields

| Field | Rule |
| --- | --- |
| metric | One of `precipitation_sum`, `temperature_2m_max`, `temperature_2m_min`, `wind_speed_10m_max` — the daily variables of the archive URL. Anything else is rejected deterministically. |
| operator | `>=` or `<=` only. |
| threshold | A string, parsed with the same number handling as v1. Anything unparseable is rejected deterministically. |
| purpose | 2–120 characters, like v1. |
| per-owner cap | 32 claims per owner, enforced deterministically. |
| measured_value | `null` while pending; the consensus value (rounded to 2 decimals, the same rounding v1 records use) once settled. |

## Consensus and tolerances

Claims reuse v1's fetch and agreement code path exactly — the same URL
construction, the same daily variables, the same string-number handling in
nondet results (GenVM calldata cannot encode floats), and the same
validator checks:

| Check | Rule |
| --- | --- |
| Verdict and WMO weather code | Must match exactly. |
| Precipitation | Within max(0.5 mm, 10% of the validator value). |
| Max / min temperature | Within 1.0 °C each. |
| Max wind speed | Within 2.0 km/h. |
| Latitude / longitude / date | Must equal the stored claim (prevents swapping the place or day). |

Checking only the shape of the leader output would not be consensus, so
the contract never does that. There is no LLM in the settlement path, by
the same deliberate choice as v1: a threshold comparison is a fact check,
and free-form text would only make consensus noisier.

## Failure modes (fail-closed)

- **Archive unavailable / bad JSON / missing daily value**: the leader
  raises before any write. The claim stays `pending` and can be retried.
  A validator that also fails agrees with that outcome; a validator that
  succeeds does not.
- **Validator disagreement**: nothing is settled. The transaction does
  not silently store the leader's numbers.
- **Already settled**: re-settlement is rejected deterministically, so a
  settled claim is never overwritten.
- **Bad input**: location, purpose, coordinates, date, metric, operator
  and threshold are validated deterministically in `create_claim`,
  before any web work.

## What a settled claim does and does not prove

A settled claim proves that validators agreed on that archive day for that
grid cell, and that the agreed metric value stood on the stated side of
the threshold. It does not prove a station reading, a street-level or
hourly condition, or a legal fact — the same limits as a v1 record (see
`docs/consensus.md`). The archive data is ERA5 reanalysis for the grid
cell around the coordinates, in GMT, for the whole day. A settled claim
is a neutral answer to a stated condition, not an insurance decision:
whether a payout or a refund follows from TRUE or FALSE is a separate
agreement between the parties, outside this contract.
