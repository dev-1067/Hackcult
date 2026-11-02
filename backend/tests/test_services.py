import pytest

from app.services.geo import Point, _route_length, haversine_km, plan_order
from app.services.languages import ascii_fold, detect_script, searchable_ascii, transliterate
from app.services.search import query_variants


def test_script_detection():
    assert detect_script("धर्म") == "devanagari"
    assert detect_script("ધર્મ") == "gujarati"
    assert detect_script("dharma") == "latin"


def test_transliteration_round_trip():
    assert transliterate("धर्म", "iast") == "dharma"
    assert transliterate("धर्म", "gujarati") == "ધર્મ"
    assert ascii_fold("Rāmāyaṇa") == "ramayana"
    assert searchable_ascii("कर्मण्येव") == "karmanyeva"


def test_query_variants_cross_script():
    v = query_variants("dharma")
    assert "धर्म" in v.native
    assert "dharma" in v.ascii
    v2 = query_variants("धर्म")
    assert "ધર્મ" in v2.native


def test_haversine_ahmedabad_to_gandhinagar():
    assert haversine_km(23.0225, 72.5714, 23.2156, 72.6369) == pytest.approx(22.5, abs=1.5)


def test_two_opt_never_worse_than_input_order():
    start = (23.2135, 72.6847)
    pts = [Point("a", 23.0225, 72.5810), Point("b", 23.1667, 72.5803), Point("c", 23.0434, 72.6023), Point("d", 23.0362, 72.5480)]
    order = plan_order(start, pts)
    assert sorted(order) == [0, 1, 2, 3]
    all_pts = [start] + [(p.lat, p.lng) for p in pts]
    dist = [[haversine_km(*a, *b) for b in all_pts] for a in all_pts]
    planned = _route_length([0] + [i + 1 for i in order], dist)
    naive = _route_length([0, 1, 2, 3, 4], dist)
    assert planned <= naive + 1e-9
