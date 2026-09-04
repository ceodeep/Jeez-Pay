#!/usr/bin/env python3
"""Synchronize authoritative public sanctions lists into JeezPay.

Sources: OFAC SDN, OFAC consolidated non-SDN, UN Security Council consolidated,
and the UK Sanctions List. Uses Python stdlib only; no API keys or paid provider.
"""

import argparse
import csv
import hashlib
import io
import json
import os
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

USER_AGENT = "JeezPay-Sanctions-Sync/1.0 compliance@jeezpay.co"
UUID_NS = uuid.UUID("fb5fa812-e2b7-4a8a-86a4-7af54e126a97")

SOURCES = {
    "OFAC_SDN": {
        "name": "U.S. OFAC SDN List",
        "url": "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML",
        "kind": "ofac",
    },
    "OFAC_NON_SDN": {
        "name": "U.S. OFAC Consolidated Non-SDN List",
        "url": "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/CONSOLIDATED.XML",
        "kind": "ofac",
    },
    "UN_SC": {
        "name": "UN Security Council Consolidated List",
        "url": "https://scsanctions.un.org/resources/xml/en/consolidated.xml",
        "kind": "un",
    },
    "UK": {
        "name": "UK Sanctions List",
        "url": "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv",
        "kind": "uk",
    },
}


def load_env(path):
    if not path or not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if not key or key in os.environ:
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            os.environ[key] = value


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def normalize_name(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    out, last_space = [], False
    for ch in text:
        if ch.isalnum():
            out.append(ch)
            last_space = False
        elif not last_space:
            out.append(" ")
            last_space = True
    return " ".join("".join(out).split())


def local(tag):
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def child_text(node, wanted):
    for child in list(node):
        if local(child.tag) == wanted:
            return (child.text or "").strip()
    return ""


def descendants(node, wanted):
    return [el for el in node.iter() if local(el.tag) == wanted]


def fetch_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = resp.read()
    if not data:
        raise RuntimeError("empty response")
    return data


def map_entity_type(value):
    v = (value or "").lower()
    if "individual" in v:
        return "individual"
    if "vessel" in v or "ship" in v:
        return "vessel"
    if "aircraft" in v:
        return "aircraft"
    if "entity" in v or "organization" in v or "organisation" in v:
        return "entity"
    return "unknown"


def make_record(source_code, source_ref, entity_type, primary_name, aliases, dobs, nationalities, programs, remarks="", raw=None):
    primary_name = " ".join(str(primary_name or "").split()).strip()
    if not primary_name:
        return None
    source_ref = str(source_ref or "").strip()
    if not source_ref:
        source_ref = hashlib.sha256((source_code + ":" + primary_name).encode()).hexdigest()[:32]
    entity_id = str(uuid.uuid5(UUID_NS, source_code + ":" + source_ref))
    unique_names = []
    seen = set()
    for name_type, name in [("primary", primary_name)] + list(aliases):
        display = " ".join(str(name or "").split()).strip()
        norm = normalize_name(display)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        unique_names.append({
            "entity_id": entity_id,
            "source_code": source_code,
            "source_ref": source_ref,
            "name_type": name_type if name_type in {"primary", "alias", "variation", "fka"} else "alias",
            "display_name": display,
            "normalized_name": norm,
        })
    entity = {
        "id": entity_id,
        "source_code": source_code,
        "source_ref": source_ref,
        "entity_type": entity_type if entity_type in {"individual", "entity", "vessel", "aircraft", "ship", "unknown"} else "unknown",
        "primary_name": primary_name,
        "normalized_primary_name": normalize_name(primary_name),
        "dobs": sorted({str(x).strip() for x in dobs if str(x).strip()}),
        "nationalities": sorted({str(x).strip() for x in nationalities if str(x).strip()}),
        "programs": sorted({str(x).strip() for x in programs if str(x).strip()}),
        "remarks": str(remarks or "")[:5000] or None,
        "raw": raw if isinstance(raw, dict) else {},
    }
    return entity, unique_names


def parse_ofac(source_code, data):
    root = ET.fromstring(data)
    records = []
    for entry in (el for el in root.iter() if local(el.tag) == "sdnEntry"):
        ref = child_text(entry, "uid")
        first = child_text(entry, "firstName")
        last = child_text(entry, "lastName")
        primary = " ".join(x for x in (first, last) if x).strip() or last or first
        entity_type = map_entity_type(child_text(entry, "sdnType"))
        aliases = []
        for aka in descendants(entry, "aka"):
            af = child_text(aka, "firstName")
            al = child_text(aka, "lastName")
            name = " ".join(x for x in (af, al) if x).strip()
            if name:
                aliases.append(("alias", name))
        dobs = [(el.text or "").strip() for el in descendants(entry, "dateOfBirth")]
        nationalities = [child_text(el, "country") for el in descendants(entry, "nationality")]
        programs = [(el.text or "").strip() for el in descendants(entry, "program")]
        remarks = child_text(entry, "remarks")
        rec = make_record(source_code, ref, entity_type, primary, aliases, dobs, nationalities, programs, remarks)
        if rec:
            records.append(rec)
    return records


def parse_un(data):
    root = ET.fromstring(data)
    records = []
    for tag_name, entity_type in (("INDIVIDUAL", "individual"), ("ENTITY", "entity")):
        for entry in (el for el in root.iter() if local(el.tag) == tag_name):
            ref = child_text(entry, "REFERENCE_NUMBER") or child_text(entry, "DATAID")
            primary = " ".join(child_text(entry, n) for n in ("FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"))
            primary = " ".join(primary.split())
            alias_tag = "INDIVIDUAL_ALIAS" if tag_name == "INDIVIDUAL" else "ENTITY_ALIAS"
            aliases = []
            for alias in descendants(entry, alias_tag):
                name = child_text(alias, "ALIAS_NAME")
                if name:
                    quality = child_text(alias, "QUALITY").lower()
                    aliases.append(("alias", name))
            dobs = []
            for dob in descendants(entry, "INDIVIDUAL_DATE_OF_BIRTH"):
                exact = child_text(dob, "DATE")
                year = child_text(dob, "YEAR")
                from_year = child_text(dob, "FROM_YEAR")
                to_year = child_text(dob, "TO_YEAR")
                if exact:
                    dobs.append(exact)
                elif year:
                    dobs.append(year)
                elif from_year or to_year:
                    dobs.append("-".join(x for x in (from_year, to_year) if x))
            nationalities = [child_text(el, "VALUE") for el in descendants(entry, "NATIONALITY")]
            programs = [child_text(entry, "UN_LIST_TYPE")]
            remarks = child_text(entry, "COMMENTS1")
            rec = make_record("UN_SC", ref, entity_type, primary, aliases, dobs, nationalities, programs, remarks)
            if rec:
                records.append(rec)
    return records


def split_multi(value):
    text = str(value or "").strip()
    if not text:
        return []
    for sep in (";", "|"):
        if sep in text:
            return [x.strip() for x in text.split(sep) if x.strip()]
    return [text]


def parse_uk(data):
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    grouped = {}
    for row in reader:
        ref = (row.get("Unique ID") or "").strip()
        if not ref:
            continue
        item = grouped.setdefault(ref, {"rows": [], "dobs": set(), "nats": set(), "programs": set(), "type": "unknown", "remarks": []})
        item["rows"].append(row)
        item["type"] = map_entity_type(row.get("Individual, Entity, Ship") or item["type"])
        item["dobs"].update(split_multi(row.get("D.O.B")))
        item["nats"].update(split_multi(row.get("Nationality(/ies)")))
        item["programs"].update(split_multi(row.get("Regime Name")))
        if row.get("Other Information"):
            item["remarks"].append(row["Other Information"])
    records = []
    for ref, item in grouped.items():
        primary, aliases = "", []
        for row in item["rows"]:
            parts = [(row.get(f"Name {i}") or "").strip() for i in range(1, 7)]
            name = " ".join(x for x in parts if x).strip()
            if not name:
                continue
            ntype = (row.get("Name type") or "").strip().lower()
            if ntype == "primary name" and not primary:
                primary = name
            else:
                aliases.append(("variation" if "variation" in ntype else "alias", name))
        if not primary and aliases:
            primary = aliases.pop(0)[1]
        rec = make_record("UK", ref, item["type"], primary, aliases, item["dobs"], item["nats"], item["programs"], " | ".join(item["remarks"])[:5000])
        if rec:
            records.append(rec)
    return records


def api_request(base, key, method, path, payload=None, prefer=None):
    url = base.rstrip("/") + path
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = resp.read()
        return json.loads(raw.decode("utf-8")) if raw else None


def chunks(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def sync_source(base, key, source_code, cfg):
    sync_id = str(uuid.uuid4())
    source_path = "/rest/v1/sanctions_sources_v1?on_conflict=source_code"
    api_request(base, key, "POST", source_path, [{
        "source_code": source_code,
        "source_name": cfg["name"],
        "official_url": cfg["url"],
        "status": "syncing",
        "last_sync_id": sync_id,
        "last_attempt_at": now_iso(),
        "updated_at": now_iso(),
    }], "resolution=merge-duplicates")

    try:
        data = fetch_bytes(cfg["url"])
        sha = hashlib.sha256(data).hexdigest()
        if cfg["kind"] == "ofac":
            records = parse_ofac(source_code, data)
        elif cfg["kind"] == "un":
            records = parse_un(data)
        else:
            records = parse_uk(data)
        if not records:
            raise RuntimeError("parser produced zero records")

        entities, names = [], []
        for entity, entity_names in records:
            entity["last_seen_sync_id"] = sync_id
            entities.append(entity)
            names.extend(entity_names)

        encoded_source = urllib.parse.quote(source_code, safe="")
        api_request(base, key, "DELETE", f"/rest/v1/sanctions_names_v1?source_code=eq.{encoded_source}")

        for batch in chunks(entities, 250):
            api_request(base, key, "POST", "/rest/v1/sanctions_entities_v1?on_conflict=id", batch, "resolution=merge-duplicates")
        for batch in chunks(names, 500):
            api_request(base, key, "POST", "/rest/v1/sanctions_names_v1?on_conflict=entity_id,normalized_name", batch, "resolution=merge-duplicates")

        result = api_request(base, key, "POST", "/rest/v1/rpc/finalize_sanctions_source_sync_v1", {
            "p_source_code": source_code,
            "p_sync_id": sync_id,
            "p_source_name": cfg["name"],
            "p_official_url": cfg["url"],
            "p_snapshot_sha256": sha,
            "p_record_count": len(entities),
            "p_alias_count": max(0, len(names) - len(entities)),
            "p_data_date": None,
        })
        print(json.dumps({"source": source_code, "records": len(entities), "names": len(names), "result": result}, separators=(",", ":")))
    except Exception as exc:
        try:
            api_request(base, key, "POST", source_path, [{
                "source_code": source_code,
                "source_name": cfg["name"],
                "official_url": cfg["url"],
                "status": "error",
                "last_sync_id": sync_id,
                "last_attempt_at": now_iso(),
                "last_error": str(exc)[:1000],
                "updated_at": now_iso(),
            }], "resolution=merge-duplicates")
        except Exception:
            pass
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default=os.path.join(os.getcwd(), ".env"))
    parser.add_argument("--source", choices=["all"] + list(SOURCES), default="all")
    args = parser.parse_args()
    load_env(args.env)
    base = os.environ.get("SUPABASE_URL", "").strip()
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE") or "").strip()
    if not base or not key:
        raise SystemExit("Missing SUPABASE_URL or service-role key")
    selected = SOURCES.items() if args.source == "all" else [(args.source, SOURCES[args.source])]
    failures = []
    for code, cfg in selected:
        try:
            sync_source(base, key, code, cfg)
        except Exception as exc:
            failures.append(code)
            print(json.dumps({"source": code, "error": str(exc)[:500]}), file=sys.stderr)
    if failures:
        raise SystemExit("Sanctions sync failed for: " + ",".join(failures))


if __name__ == "__main__":
    main()
