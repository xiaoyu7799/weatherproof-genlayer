# GenLayer Projects submission copy — WeatherProof

Fill the live values from `deployment.json` / `evidence.json` before
pasting. Do not paste this file's placeholders.

## Title

WeatherProof — On-chain proof of past weather

## Short description

WeatherProof turns a disputed past-weather claim into a neutral on-chain
record. Pick a place and a past date; GenLayer validators independently
fetch the same day from the Open-Meteo Archive and must agree on the
verdict before it is stored. A screenshot can be edited — this record
cannot be invented by one party.

## What it does

- Request an attestation: place, coordinates, past date, purpose
  (outdoor event, photo shoot, farm work, delivery/site visit, sports).
- Verify it on-chain: validators re-fetch the archive day and compare
  verdict, weather code and numbers within documented tolerances.
- Browse verified and pending attestations, open the exact source URL
  for any record, and share the explorer link.
- Browser preview (clearly labelled, not on-chain) shows what the
  archive returns before you spend a wallet signature.

## How GenLayer is used (not decorative)

The Intelligent Contract itself fetches the web — a traditional smart
contract cannot do this. The leader's fetch is worthless alone: every
validator re-fetches the same Open-Meteo Archive URL, re-derives the
verdict from fixed contract thresholds, and only accepts the result if
verdict and weather code match exactly and numbers agree within
tolerance. If validators disagree, nothing is stored. The core business
result — the verified weather verdict — is therefore produced by
GenLayer consensus, not by the frontend, not by one server, and not by
an LLM (there is none in the verdict path, deliberately).

## Main tag

- Other (weather attestation) — if the form only allows the listed tags,
  use the closest fit and state “weather attestation” in the title and
  description. Do not mislabel it as a prediction market, DeFi or game.

## Links

- Website: (GitHub Pages URL from the Pages workflow, after the repo is created and pushed)
- Repository: https://github.com/xiaoyu7799/weatherproof-genlayer (to be created by the user; see README)
- Contract: https://explorer-studio.genlayer.com/address/0x304ba2D879EaC48bB0030cB0A196499d34c15137
- Deploy tx: 0xbb0e84abee4ac80da88c72bbc02c428c2770a1eaa525bf6ab245e85e410638cd (FINALIZED, Stable Studionet)
- Request tx: 0x38a9ebe346b80e7e3a12b27e4ef81ce5a2f17bfa8afec4e443b0b8d55764608e (FINALIZED)
- Verify tx: 0x48bb2eae76491e9746f36e8f3cd06d011891ade16ca26fdd1e9369f983a68381 (FINALIZED)
- Verified record #0: London, 2025-10-01, light_rain, 0.1 mm, 9.9–17.9 °C, WMO 51, wind 8.8 km/h
- Logo: assets/logo.svg
