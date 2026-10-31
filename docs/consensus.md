# Consensus design

## Why validators must re-fetch

A weather attestation is only useful if no single party can invent it.
WeatherProof therefore stores nothing from a single fetch. The leader
fetches the Open-Meteo Archive day, but the record is written only after
validators independently fetch the same URL and agree.

## What is compared

| Field | Rule |
| --- | --- |
| Verdict | Must match exactly. Derived from fixed thresholds, not LLM text. |
| WMO weather code | Must match exactly. |
| Precipitation | Within max(0.5 mm, 10% of the validator value). |
| Max / min temperature | Within 1.0 °C each. |
| Max wind speed | Within 2.0 km/h. |
| Latitude / longitude / date | Must equal the stored request (prevents swapping the place or day). |

Free-form text is never compared and never stored as evidence, because
wording differences are not a decision. There is no LLM in the verdict
path at all, deliberately: this is a factual archive lookup, and adding
an LLM would make consensus noisier without making the fact truer.

## Failure modes

- **Archive unavailable / bad JSON / missing daily value**: the leader
  raises `EXTERNAL: …` before any write. The attestation stays `pending`
  and can be retried. A validator that also fails with a `UserError`
  agrees with that outcome; a validator that succeeds does not.
- **Validator disagreement**: no record is written. The transaction does
  not silently store the leader's numbers.
- **Already verified**: re-verification is rejected deterministically
  (`EXPECTED: attestation_already_verified`), so a verified record is
  never overwritten.
- **Bad input**: location, purpose, coordinates and date are validated
  deterministically in `request_attestation`, before any web work.

## Source

One source, stated in every record: the Open-Meteo Archive API
(`archive-api.open-meteo.com/v1/archive`), ERA5 reanalysis, daily
variables `temperature_2m_max`, `temperature_2m_min`, `precipitation_sum`,
`weather_code`, `wind_speed_10m_max`, timezone GMT, one day
(`start_date == end_date`). No API key. The exact URL is stored in the
record and linked from the frontend, so anyone can re-open it.

## What a verified record does not prove

It proves validators agreed on that archive day for that grid cell. It
does not prove a station reading, a street-level condition, an hourly
condition, or a legal fact. The frontend and README say this in the same
words.
