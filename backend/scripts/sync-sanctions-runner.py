#!/usr/bin/env python3
"""Compatibility entrypoint for JeezPay sanctions sync.

The current UK sanctions CSV may include metadata lines (for example a
"Report Date:" line) before the actual CSV header. This runner locates the
real header and delegates all parsing/sync behavior to sync-sanctions.py.
"""

import csv
import importlib.util
import pathlib
import sys

CORE_PATH = pathlib.Path(__file__).with_name("sync-sanctions.py")

spec = importlib.util.spec_from_file_location("jeezpay_sanctions_core", CORE_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("Unable to load sanctions sync core")

core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
ORIGINAL_PARSE_UK = core.parse_uk


def parse_uk_compatible(data):
    text = data.decode("utf-8-sig", errors="replace")
    lines = text.splitlines()
    header_index = None
    required = {"Unique ID", "Name 1", "Name type", "Regime Name"}

    for index, line in enumerate(lines[:25]):
        try:
            fields = next(csv.reader([line]))
        except (csv.Error, StopIteration):
            continue
        if required.issubset({field.strip() for field in fields}):
            header_index = index
            break

    if header_index is None:
        raise RuntimeError("UK CSV header not found")

    normalized = "\n".join(lines[header_index:]).encode("utf-8")
    return ORIGINAL_PARSE_UK(normalized)


core.parse_uk = parse_uk_compatible


def self_test():
    sample = (
        "Report Date: 03-Sep-2026\n"
        'Last Updated,Unique ID,Name 6,Name 1,Name 2,Name 3,Name 4,Name 5,Name type,'
        '"Individual, Entity, Ship",D.O.B,Nationality(/ies),Regime Name,Other Information\n'
        '04/08/2026,AFG0001,TEST ENTITY,,,,,,,Primary Name,Entity,,Afghanistan,Test Regime,Example\n'
    )
    records = parse_uk_compatible(sample.encode("utf-8"))
    if len(records) != 1:
        raise SystemExit(f"UK parser compatibility self-test failed: records={len(records)}")
    entity, names = records[0]
    if entity["source_ref"] != "AFG0001" or entity["primary_name"] != "TEST ENTITY" or not names:
        raise SystemExit("UK parser compatibility self-test failed: parsed fields mismatch")
    print("UK parser compatibility self-test: OK")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    else:
        core.main()
