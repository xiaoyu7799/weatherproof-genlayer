"""Tests for contracts/weatherproof_v2.py (claims + v1 regression).

Runs with plain python3 (no pytest, no GenVM). A minimal `genlayer`
stub is injected into sys.modules before the contract is imported: it
provides the host surface the contract uses (gl.Contract, gl.public
decorators, gl.vm.UserError/Return/run_nondet_unsafe, gl.nondet.web.get,
gl.message.sender_address, TreeMap, DynArray, u256). The stub's
run_nondet_unsafe mirrors consensus honestly: the fetch runs once for
the leader, then validate() re-fetches for the validator; agreement
returns the result, disagreement or a shared fetch failure raises
(fail-closed, state unchanged).
"""
import importlib.util
import json
import sys
import types
import unittest

# --- minimal genlayer stub -------------------------------------------------


class UserError(Exception):
    pass


class Return:
    def __init__(self, calldata):
        self.calldata = calldata


class _VM:
    UserError = UserError
    Return = Return

    @staticmethod
    def run_nondet_unsafe(fn, validate):
        try:
            result = fn()
        except UserError as err:
            if validate(err):
                raise
            raise AssertionError("nondet disagreement on error")
        if validate(Return(result)):
            return result
        raise AssertionError("nondet disagreement")


class _Web:
    get = None  # replaced per test


class _Nondet:
    web = _Web()


class _Message:
    sender_address = "0x0000000000000000000000000000000000000000"


class _Public:
    @staticmethod
    def write(fn):
        return fn

    @staticmethod
    def view(fn):
        return fn


class _GL:
    vm = _VM()
    nondet = _Nondet()
    message = _Message()
    public = _Public()

    class Contract:
        # GenVM turns class-level annotations into storage automatically;
        # the stub mirrors that by pre-initialising TreeMap/DynArray fields
        # before the contract's own __init__ runs.
        def __init_subclass__(cls, **kw):
            super().__init_subclass__(**kw)
            orig_init = cls.__init__

            def wrapped(self, *a, **k):
                for name, typ in getattr(cls, "__annotations__", {}).items():
                    origin = getattr(typ, "__origin__", typ)
                    if origin is TreeMap:
                        setattr(self, name, TreeMap())
                    elif origin is DynArray:
                        setattr(self, name, DynArray())
                orig_init(self, *a, **k)

            cls.__init__ = wrapped


class u256(int):
    pass


class TreeMap(dict):
    pass


class DynArray(list):
    pass


def _load_contract():
    mod = types.ModuleType("genlayer")
    gl = _GL()
    mod.gl = gl
    mod.TreeMap = TreeMap
    mod.DynArray = DynArray
    mod.u256 = u256
    sys.modules["genlayer"] = mod
    spec = importlib.util.spec_from_file_location(
        "weatherproof_v2", "contracts/weatherproof_v2.py"
    )
    contract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(contract)
    return contract, gl


CONTRACT, GL = _load_contract()


class Response:
    def __init__(self, body, status=200):
        self.body = body
        self.status = status


def london_day(**overrides):
    """Open-Meteo daily payload shaped like London 2025-10-01."""
    daily = {
        "temperature_2m_max": [17.9],
        "temperature_2m_min": [9.9],
        "precipitation_sum": [0.1],
        "weather_code": [51],
        "wind_speed_10m_max": [8.8],
    }
    daily.update(overrides)
    return json.dumps({"daily": daily})


def fresh():
    c = CONTRACT.WeatherProof()
    GL.message.sender_address = "0x1111111111111111111111111111111111111111"
    return c


def make_claim(c, metric="precipitation_sum", operator=">=", threshold="0.1"):
    return c.create_claim(
        "London", "51.5074", "-0.1278", "2025-10-01",
        metric, operator, threshold, "milestone demo",
    )


class TestVerdicts(unittest.TestCase):
    def test_thresholds(self):
        v = CONTRACT._verdict
        self.assertEqual(v(0.0, 95), "thunderstorm")
        self.assertEqual(v(0.0, 99), "thunderstorm")
        self.assertEqual(v(12.0, 3), "heavy_rain")
        self.assertEqual(v(10.0, 3), "heavy_rain")
        self.assertEqual(v(5.0, 3), "rain")
        self.assertEqual(v(2.5, 3), "rain")
        self.assertEqual(v(0.1, 51), "light_rain")
        self.assertEqual(v(0.0, 71), "snow")
        self.assertEqual(v(0.0, 85), "snow")
        self.assertEqual(v(0.0, 0), "dry")


class TestClaimValidation(unittest.TestCase):
    def test_bad_metric(self):
        with self.assertRaises(UserError) as ctx:
            make_claim(fresh(), metric="humidity")
        self.assertIn("claim_metric_unknown", str(ctx.exception))

    def test_bad_operator(self):
        with self.assertRaises(UserError) as ctx:
            make_claim(fresh(), operator=">")
        self.assertIn("claim_operator_unknown", str(ctx.exception))

    def test_bad_threshold(self):
        with self.assertRaises(UserError) as ctx:
            make_claim(fresh(), threshold="about ten")
        self.assertIn("threshold_not_a_number", str(ctx.exception))

    def test_bad_date_and_coords_reuse_v1(self):
        c = fresh()
        with self.assertRaises(UserError):
            c.create_claim("London", "51.5074", "-0.1278", "01-10-2025",
                           "precipitation_sum", ">=", "0.1", "x")
        with self.assertRaises(UserError):
            c.create_claim("London", "999", "-0.1278", "2025-10-01",
                           "precipitation_sum", ">=", "0.1", "x")

    def test_owner_cap_32(self):
        c = fresh()
        for _ in range(32):
            make_claim(c)
        with self.assertRaises(UserError) as ctx:
            make_claim(c)
        self.assertIn("claim_owner_cap_reached", str(ctx.exception))
        self.assertEqual(int(c.get_claim_count()), 32)

    def test_record_shape_and_source_url(self):
        c = fresh()
        cid = make_claim(c)
        rec = json.loads(c.get_claim(cid))
        self.assertEqual(rec["status"], "pending")
        self.assertIsNone(rec["measured_value"])
        self.assertEqual(rec["metric"], "precipitation_sum")
        self.assertEqual(rec["operator"], ">=")
        self.assertEqual(rec["threshold"], "0.1")
        self.assertIn("archive-api.open-meteo.com/v1/archive", rec["source_url"])
        self.assertIn("start_date=2025-10-01&end_date=2025-10-01", rec["source_url"])


class TestSettlement(unittest.TestCase):
    def setUp(self):
        GL.nondet.web.get = lambda url: Response(london_day())

    def test_true_and_false(self):
        c = fresh()
        t = make_claim(c, threshold="0.1")
        out = json.loads(c.settle_claim(t))
        self.assertEqual(out["status"], "settled_true")
        self.assertEqual(out["measured_value"], 0.1)
        f = make_claim(c, threshold="10")
        out = json.loads(c.settle_claim(f))
        self.assertEqual(out["status"], "settled_false")
        self.assertEqual(out["measured_value"], 0.1)

    def test_other_metrics_and_operators(self):
        c = fresh()
        t = make_claim(c, metric="temperature_2m_max", operator="<=", threshold="18")
        self.assertEqual(json.loads(c.settle_claim(t))["status"], "settled_true")
        w = make_claim(c, metric="wind_speed_10m_max", operator=">=", threshold="100")
        out = json.loads(c.settle_claim(w))
        self.assertEqual(out["status"], "settled_false")
        self.assertEqual(out["measured_value"], 8.8)
        m = make_claim(c, metric="temperature_2m_min", operator=">=", threshold="9.9")
        self.assertEqual(json.loads(c.settle_claim(m))["status"], "settled_true")

    def test_settle_twice_and_unknown(self):
        c = fresh()
        t = make_claim(c)
        c.settle_claim(t)
        with self.assertRaises(UserError) as ctx:
            c.settle_claim(t)
        self.assertIn("claim_already_settled", str(ctx.exception))
        with self.assertRaises(UserError):
            c.settle_claim(u256(99))

    def test_fail_closed_missing_data_then_retry(self):
        c = fresh()
        t = make_claim(c)
        GL.nondet.web.get = lambda url: Response(json.dumps({"daily": {}}))
        with self.assertRaises(UserError):
            c.settle_claim(t)
        rec = json.loads(c.get_claim(t))
        self.assertEqual(rec["status"], "pending")
        self.assertIsNone(rec["measured_value"])
        GL.nondet.web.get = lambda url: Response(london_day())
        out = json.loads(c.settle_claim(t))
        self.assertEqual(out["status"], "settled_true")

    def test_fail_closed_http_error(self):
        c = fresh()
        t = make_claim(c)
        GL.nondet.web.get = lambda url: Response("nope", status=500)
        with self.assertRaises(UserError):
            c.settle_claim(t)
        self.assertEqual(json.loads(c.get_claim(t))["status"], "pending")

    def test_disagreement_leaves_pending(self):
        c = fresh()
        t = make_claim(c)
        calls = {"n": 0}

        def flaky(url):
            calls["n"] += 1
            # Leader sees 0.1 mm; validator re-fetch sees 5.0 mm.
            precip = 0.1 if calls["n"] == 1 else 5.0
            return Response(london_day(precipitation_sum=[precip]))

        GL.nondet.web.get = flaky
        with self.assertRaises(AssertionError):
            c.settle_claim(t)
        self.assertEqual(json.loads(c.get_claim(t))["status"], "pending")

    def test_list_claims_guard(self):
        c = fresh()
        make_claim(c)
        with self.assertRaises(UserError):
            c.list_claims(u256(0), u256(0))
        with self.assertRaises(UserError):
            c.list_claims(u256(0), u256(21))
        lst = json.loads(c.list_claims(u256(0), u256(20)))
        self.assertEqual(len(lst), 1)


class TestV1Regression(unittest.TestCase):
    def setUp(self):
        GL.nondet.web.get = lambda url: Response(london_day())

    def test_attestation_flow_unchanged(self):
        c = fresh()
        aid = c.request_attestation("London", "51.5074", "-0.1278",
                                    "2025-10-01", "outdoor event proof")
        rec = json.loads(c.verify_attestation(aid))
        self.assertEqual(rec["status"], "verified")
        self.assertEqual(rec["verdict"], "light_rain")
        self.assertEqual(rec["precip_mm"], 0.1)
        self.assertEqual(rec["temp_max_c"], 17.9)
        self.assertEqual(rec["temp_min_c"], 9.9)
        self.assertEqual(rec["weather_code"], 51)
        self.assertEqual(rec["wind_max_kmh"], 8.8)
        with self.assertRaises(UserError):
            c.verify_attestation(aid)
        self.assertEqual(int(c.get_count()), 1)
        self.assertEqual(len(json.loads(c.list_attestations(u256(0), u256(20)))), 1)

    def test_attestation_and_claim_ids_independent(self):
        c = fresh()
        aid = c.request_attestation("London", "51.5074", "-0.1278",
                                    "2025-10-01", "proof")
        cid = make_claim(c)
        self.assertEqual(int(aid), 0)
        self.assertEqual(int(cid), 0)
        self.assertEqual(int(c.get_count()), 1)
        self.assertEqual(int(c.get_claim_count()), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
