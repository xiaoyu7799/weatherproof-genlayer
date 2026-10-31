# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""WeatherProof: on-chain weather attestation for a past date.

Problem
-------
A screenshot of a weather app proves nothing. Anyone can edit it, and a
weather provider's page for a past date can be re-rendered or disputed.
Event organisers, photographers, farmers and delivery teams still need a
neutral, shareable record of one simple fact: what was the weather, at this
place, on that day?

What this contract does
-----------------------
1. Anyone requests an attestation: a place name, coordinates, a past date
   (YYYY-MM-DD) and a short purpose, e.g. "outdoor shoot" or "market day".
2. Anyone verifies it. Validators independently fetch the same day from the
   Open-Meteo Archive API (ERA5 reanalysis, no API key), extract the daily
   numbers, and derive a verdict from fixed thresholds in this contract.
   The verdict is never free-form LLM text.
3. Only if validators agree on the verdict and on the numbers (within the
   tolerances below) is the verified record written on-chain, together with
   the exact source URL that was fetched.

Consensus design (the part that matters)
----------------------------------------
* Leader and every validator run the same fetch-and-classify function.
* A validator accepts the leader result only if:
    - the verdict matches exactly,
    - the WMO weather code matches exactly,
    - precipitation agrees within max(0.5 mm, 10% of the validator value),
    - max/min temperature each agree within 1.0 C,
    - max wind speed agrees within 2.0 km/h,
    - the echoed latitude, longitude and date match the stored request.
* Checking only the shape of the leader output would not be consensus, so
  the validator never accepts a result it did not independently reproduce.
* A failed fetch raises a UserError before any state is written, so the
  attestation stays "pending" and can be retried. A verified attestation
  can never be overwritten.

Limits, stated honestly
-----------------------
* Open-Meteo Archive data is reanalysis/model data, not a station
  observation. It is the best free global historical source, but it is not
  a legal weather certificate and it cannot prove conditions at a precise
  street address or hour; daily values are for the grid cell around the
  coordinates and the day in GMT.
* The verdict is a coarse, documented classification of daily aggregates,
  not a forecast and not an insurance decision.
"""

import json

from genlayer import *


def _verdict(precip_mm: float, weather_code: int) -> str:
    if weather_code in (95, 96, 99):
        return "thunderstorm"
    if precip_mm >= 10.0:
        return "heavy_rain"
    if precip_mm >= 2.5:
        return "rain"
    if precip_mm >= 0.1:
        return "light_rain"
    if weather_code in (71, 73, 75, 77, 85, 86):
        return "snow"
    return "dry"


class WeatherProof(gl.Contract):
    attestations: TreeMap[u256, str]
    ids: DynArray[u256]
    next_id: u256

    def __init__(self):
        self.next_id = u256(0)

    # -- deterministic helpers -------------------------------------------

    def _load(self, attestation_id: u256) -> dict:
        if attestation_id not in self.attestations:
            raise gl.vm.UserError("EXPECTED: attestation_not_found")
        return json.loads(self.attestations[attestation_id])

    def _check_date(self, date: str) -> None:
        if len(date) != 10 or date[4] != "-" or date[7] != "-":
            raise gl.vm.UserError("EXPECTED: date_must_be_YYYY-MM-DD")
        year = date[0:4]
        month = date[5:7]
        day = date[8:10]
        for part in (year, month, day):
            for ch in part:
                if ch < "0" or ch > "9":
                    raise gl.vm.UserError("EXPECTED: date_must_be_YYYY-MM-DD")
        if int(year) < 1940 or int(year) > 2100:
            raise gl.vm.UserError("EXPECTED: date_out_of_range")
        if int(month) < 1 or int(month) > 12:
            raise gl.vm.UserError("EXPECTED: date_out_of_range")
        if int(day) < 1 or int(day) > 31:
            raise gl.vm.UserError("EXPECTED: date_out_of_range")

    def _check_coord(self, text: str, low: float, high: float) -> float:
        try:
            value = float(text)
        except Exception:
            raise gl.vm.UserError("EXPECTED: coordinate_not_a_number")
        if value < low or value > high:
            raise gl.vm.UserError("EXPECTED: coordinate_out_of_range")
        return value

    # -- writes ------------------------------------------------------------

    @gl.public.write
    def request_attestation(
        self,
        location_name: str,
        latitude: str,
        longitude: str,
        date: str,
        purpose: str,
    ) -> u256:
        location_name = location_name.strip()
        latitude = latitude.strip()
        longitude = longitude.strip()
        date = date.strip()
        purpose = purpose.strip()
        if len(location_name) < 2 or len(location_name) > 80:
            raise gl.vm.UserError("EXPECTED: location_name_length")
        if len(purpose) < 2 or len(purpose) > 120:
            raise gl.vm.UserError("EXPECTED: purpose_length")
        self._check_coord(latitude, -90.0, 90.0)
        self._check_coord(longitude, -180.0, 180.0)
        self._check_date(date)
        source_url = (
            "https://archive-api.open-meteo.com/v1/archive"
            f"?latitude={latitude}&longitude={longitude}"
            f"&start_date={date}&end_date={date}"
            "&daily=temperature_2m_max,temperature_2m_min,"
            "precipitation_sum,weather_code,wind_speed_10m_max"
            "&timezone=GMT"
        )
        attestation_id = self.next_id
        self.next_id = attestation_id + u256(1)
        record = {
            "id": int(attestation_id),
            "location_name": location_name,
            "latitude": latitude,
            "longitude": longitude,
            "date": date,
            "purpose": purpose,
            "requester": str(gl.message.sender_address),
            "status": "pending",
            "verdict": None,
            "precip_mm": None,
            "temp_max_c": None,
            "temp_min_c": None,
            "weather_code": None,
            "wind_max_kmh": None,
            "source_url": source_url,
        }
        self.attestations[attestation_id] = json.dumps(record)
        self.ids.append(attestation_id)
        return attestation_id

    @gl.public.write
    def verify_attestation(self, attestation_id: u256) -> str:
        record = self._load(attestation_id)
        if record["status"] != "pending":
            raise gl.vm.UserError("EXPECTED: attestation_already_verified")
        url = record["source_url"]

        def fetch_and_classify() -> dict:
            response = gl.nondet.web.get(url)
            status = getattr(response, "status", 200)
            if status != 200:
                raise gl.vm.UserError(f"EXTERNAL: open_meteo_status_{status}")
            body = response.body
            if isinstance(body, bytes):
                text = body.decode("utf-8")
            else:
                text = str(body)
            try:
                data = json.loads(text)
            except Exception:
                raise gl.vm.UserError("EXTERNAL: open_meteo_bad_json")
            daily = data.get("daily") if isinstance(data, dict) else None
            if not isinstance(daily, dict):
                raise gl.vm.UserError("EXTERNAL: open_meteo_no_daily")
            try:
                precip = float(daily["precipitation_sum"][0])
                temp_max = float(daily["temperature_2m_max"][0])
                temp_min = float(daily["temperature_2m_min"][0])
                code = int(daily["weather_code"][0])
                wind = float(daily["wind_speed_10m_max"][0])
            except Exception:
                raise gl.vm.UserError("EXTERNAL: open_meteo_missing_daily_value")
            # GenVM calldata cannot encode floats, so the nondet result
            # carries numbers as strings (and the weather code as an int).
            # The validator parses them back; only after consensus are
            # they converted to JSON numbers for storage. Returning a
            # float here crashed the leader with
            # "not calldata encodable ...: float" and left the record
            # pending despite FINALIZED.
            return {
                "latitude": record["latitude"],
                "longitude": record["longitude"],
                "date": record["date"],
                "precip_mm": f"{precip:.2f}",
                "temp_max_c": f"{temp_max:.2f}",
                "temp_min_c": f"{temp_min:.2f}",
                "weather_code": code,
                "wind_max_kmh": f"{wind:.2f}",
                "verdict": _verdict(precip, code),
            }

        def validate(leader_result) -> bool:
            if isinstance(leader_result, gl.vm.UserError):
                try:
                    fetch_and_classify()
                except gl.vm.UserError:
                    return True
                except Exception:
                    return False
                return False
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader = leader_result.calldata
            if not isinstance(leader, dict):
                return False
            try:
                own = fetch_and_classify()
            except Exception:
                return False
            if (
                leader.get("latitude") != record["latitude"]
                or leader.get("longitude") != record["longitude"]
                or leader.get("date") != record["date"]
            ):
                return False
            if leader.get("verdict") != own["verdict"]:
                return False
            if leader.get("weather_code") != own["weather_code"]:
                return False
            try:
                leader_precip = float(leader["precip_mm"])
                own_precip = float(own["precip_mm"])
                leader_tmax = float(leader["temp_max_c"])
                own_tmax = float(own["temp_max_c"])
                leader_tmin = float(leader["temp_min_c"])
                own_tmin = float(own["temp_min_c"])
                leader_wind = float(leader["wind_max_kmh"])
                own_wind = float(own["wind_max_kmh"])
            except Exception:
                return False
            precip_tol = 0.5
            if own_precip >= 5.0:
                precip_tol = 0.1 * own_precip
            if abs(leader_precip - own_precip) > precip_tol:
                return False
            if abs(leader_tmax - own_tmax) > 1.0:
                return False
            if abs(leader_tmin - own_tmin) > 1.0:
                return False
            if abs(leader_wind - own_wind) > 2.0:
                return False
            return True

        result = gl.vm.run_nondet_unsafe(fetch_and_classify, validate)
        record["status"] = "verified"
        record["verdict"] = result["verdict"]
        record["precip_mm"] = float(result["precip_mm"])
        record["temp_max_c"] = float(result["temp_max_c"])
        record["temp_min_c"] = float(result["temp_min_c"])
        record["weather_code"] = result["weather_code"]
        record["wind_max_kmh"] = float(result["wind_max_kmh"])
        self.attestations[attestation_id] = json.dumps(record)
        return json.dumps(record)

    # -- views -------------------------------------------------------------

    @gl.public.view
    def get_attestation(self, attestation_id: u256) -> str:
        return json.dumps(self._load(attestation_id))

    @gl.public.view
    def get_count(self) -> u256:
        return u256(len(self.ids))

    @gl.public.view
    def list_attestations(self, offset: u256, limit: u256) -> str:
        if limit < 1 or limit > 20:
            raise gl.vm.UserError("EXPECTED: limit_must_be_1_to_20")
        total = len(self.ids)
        start = int(offset)
        if start >= total:
            return json.dumps([])
        end = start + int(limit)
        if end > total:
            end = total
        out = []
        index = start
        while index < end:
            out.append(json.loads(self.attestations[self.ids[index]]))
            index += 1
        return json.dumps(out)
