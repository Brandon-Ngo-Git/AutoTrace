#!/usr/bin/env python3
"""Fetch public NHTSA complaints and recalls into the AutoTrace Supabase database."""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import date
from typing import Any

import pandas as pd
import requests
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import IsolationForest
from supabase import Client, create_client

API_ROOT = "https://api.nhtsa.gov"
USER_AGENT = "AutoTrace research data importer/1.0"
UPSERT_BATCH_SIZE = 200


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--make", required=True, help="NHTSA make, e.g. BMW")
    parser.add_argument("--model", required=True, help="NHTSA model label, e.g. 3 SERIES")
    parser.add_argument("--start-year", type=int, required=True)
    parser.add_argument("--end-year", type=int, required=True)
    return parser.parse_args()


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).upper()


def to_date(value: Any) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()) or pd.isna(value):
        return None
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.date().isoformat()


def as_bool(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def as_int(value: Any) -> int:
    try:
        return max(0, int(float(0 if value is None or pd.isna(value) else value)))
    except (TypeError, ValueError):
        return 0


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if hasattr(value, "item"):
        value = value.item()
    if pd.isna(value):
        return None
    return value


def get_results(session: requests.Session, path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    response = session.get(f"{API_ROOT}{path}", params=params, timeout=45)
    if response.status_code == 400:
        try:
            payload = response.json()
        except requests.exceptions.JSONDecodeError:
            response.raise_for_status()
        if (
            isinstance(payload, dict)
            and payload.get("Count") == 0
            and payload.get("Message") == "Results returned successfully"
            and payload.get("results") == []
        ):
            return []
    response.raise_for_status()
    payload = response.json()
    results = payload.get("results")
    if not isinstance(results, list):
        raise RuntimeError(f"NHTSA returned an unexpected response for {path}")
    return results


def cluster_categories(frame: pd.DataFrame) -> pd.Series:
    """Create reproducible narrative clusters; use NHTSA component labels for tiny datasets."""
    fallback = frame["component"].fillna("").replace("", "Uncategorized")
    texts = frame["summary"].fillna("").astype(str).str.strip()
    usable = texts.ne("")
    if int(usable.sum()) < 5:
        return fallback

    vectorizer = TfidfVectorizer(
        stop_words="english",
        max_features=1200,
        ngram_range=(1, 2),
        min_df=1,
    )
    try:
        matrix = vectorizer.fit_transform(texts[usable])
    except ValueError:
        return fallback
    if matrix.shape[1] < 2:
        return fallback

    cluster_count = min(5, max(2, round((int(usable.sum()) / 2) ** 0.5)))
    labels = KMeans(n_clusters=min(cluster_count, int(usable.sum())), random_state=42, n_init=10).fit_predict(matrix)
    terms = vectorizer.get_feature_names_out()
    names: dict[int, str] = {}
    for cluster in set(labels):
        members = matrix[labels == cluster]
        weights = members.mean(axis=0).A1
        top_terms = [terms[index] for index in weights.argsort()[::-1] if terms[index] not in {"vehicle", "car", "problem"}][:3]
        names[int(cluster)] = " · ".join(top_terms).title() or "Narrative cluster"

    result = fallback.copy()
    result.loc[usable] = pd.Series(labels, index=texts.index[usable]).map(names)
    return result.str.slice(0, 100)


def upsert_in_batches(client: Client, table: str, records: list[dict[str, Any]], conflict: str) -> int:
    for start in range(0, len(records), UPSERT_BATCH_SIZE):
        batch = records[start : start + UPSERT_BATCH_SIZE]
        client.table(table).upsert(batch, on_conflict=conflict).execute()
    return len(records)


def ingest(client: Client, make: str, model: str, start_year: int, end_year: int) -> None:
    normalized_make = normalize_name(make)
    normalized_model = normalize_name(model)
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
    complaint_frames: list[pd.DataFrame] = []
    recall_records: list[dict[str, Any]] = []
    yearly_patterns: list[dict[str, Any]] = []

    for year in range(start_year, end_year + 1):
        client.table("vehicles").upsert(
            {"make": normalized_make, "model": normalized_model, "model_year": year},
            on_conflict="make,model,model_year",
        ).execute()
        vehicle_response = (
            client.table("vehicles")
            .select("id")
            .eq("make", normalized_make)
            .eq("model", normalized_model)
            .eq("model_year", year)
            .single()
            .execute()
        )
        if not vehicle_response.data:
            raise RuntimeError(f"Could not create or retrieve vehicle row for {year} {make} {model}")
        vehicle_id = vehicle_response.data["id"]
        params = {"make": normalized_make, "model": normalized_model, "modelYear": year}
        complaints = get_results(session, "/complaints/complaintsByVehicle", params)
        yearly_patterns.append({"vehicle_id": vehicle_id, "model_year": year, "report_count": len(complaints)})
        if complaints:
            frame = pd.DataFrame(complaints)
            frame["raw_payload"] = frame.apply(
                lambda row: {key: json_safe(value) for key, value in row.items()},
                axis=1,
            )
            frame["vehicle_id"] = vehicle_id
            frame["model_year"] = year
            series = lambda name, default="": frame[name] if name in frame else pd.Series(default, index=frame.index)
            frame["report_number"] = series("odiNumber").astype(str)
            frame["summary"] = series("summary").fillna("").astype(str).str.strip()
            frame["component"] = series("components").fillna("").astype(str).str.strip()
            frame["report_date"] = series("dateComplaintFiled").map(to_date)
            frame["incident_date"] = series("dateOfIncident").map(to_date)
            frame["crash"] = series("crash", False).map(as_bool)
            frame["fire"] = series("fire", False).map(as_bool)
            frame["injuries"] = series("numberOfInjuries", 0).map(as_int)
            frame["deaths"] = series("numberOfDeaths", 0).map(as_int)
            complaint_frames.append(frame)

        for recall in get_results(session, "/recalls/recallsByVehicle", params):
            campaign = recall.get("NHTSACampaignNumber") or recall.get("campaignNumber")
            if not campaign:
                continue
            recall_records.append(
                {
                    "vehicle_id": vehicle_id,
                    "campaign_number": str(campaign),
                    "report_date": to_date(recall.get("ReportReceivedDate") or recall.get("reportDate")),
                    "component": str(recall.get("Component") or ""),
                    "summary": str(recall.get("Summary") or ""),
                    "consequence": str(recall.get("Consequence") or ""),
                    "remedy": str(recall.get("Remedy") or ""),
                    "raw_payload": recall,
                }
            )
        print(f"{year}: received {len(complaints)} complaint reports and recall records")
        time.sleep(0.15)

    complaint_records: list[dict[str, Any]] = []
    if complaint_frames:
        frame = pd.concat(complaint_frames, ignore_index=True)
        frame = frame[frame["report_number"].ne("")].drop_duplicates(["vehicle_id", "report_number"])
        frame["defect_category"] = cluster_categories(frame)
        for row in frame.to_dict(orient="records"):
            complaint_records.append(
                {
                    "vehicle_id": row["vehicle_id"],
                    "report_number": row["report_number"],
                    "report_date": row["report_date"],
                    "incident_date": row["incident_date"],
                    "component": row["component"] or None,
                    "summary": row["summary"],
                    "defect_category": row["defect_category"] or None,
                    "crash": row["crash"],
                    "fire": row["fire"],
                    "injuries": row["injuries"],
                    "deaths": row["deaths"],
                    "source": "NHTSA",
                    "raw_payload": row.get("raw_payload", {}),
                }
            )

    complaint_count = upsert_in_batches(client, "complaints", complaint_records, "vehicle_id,report_number")
    recall_count = upsert_in_batches(client, "recalls", recall_records, "vehicle_id,campaign_number")
    pattern_frame = pd.DataFrame(yearly_patterns)
    pattern_frame["anomaly_score"] = None
    pattern_frame["is_unusual"] = False
    if len(pattern_frame) >= 5 and pattern_frame["report_count"].nunique() > 1:
        anomaly_model = IsolationForest(random_state=42, n_estimators=100, contamination="auto")
        counts = pattern_frame[["report_count"]]
        pattern_frame["is_unusual"] = anomaly_model.fit_predict(counts) == -1
        pattern_frame["anomaly_score"] = anomaly_model.score_samples(counts)
    pattern_records = [
        {
            **row,
            "anomaly_score": None if pd.isna(row["anomaly_score"]) else float(row["anomaly_score"]),
            "is_unusual": bool(row["is_unusual"]),
            "model_version": "isolation-forest-v1",
        }
        for row in pattern_frame.to_dict(orient="records")
    ]
    pattern_count = upsert_in_batches(client, "yearly_report_patterns", pattern_records, "vehicle_id")
    print(f"Upserted {complaint_count} complaints, {recall_count} recalls, and {pattern_count} yearly patterns.")
    print("Complaint counts describe submitted reports, not vehicle failure rates.")


def main() -> int:
    args = parse_args()
    current_year = date.today().year + 1
    if args.start_year < 1980 or args.end_year > current_year or args.start_year > args.end_year:
        raise ValueError(f"Choose a valid year range between 1980 and {current_year}.")

    client = create_client(required_env("SUPABASE_URL"), required_env("SUPABASE_SECRET_KEY"))
    ingest(client, args.make, args.model, args.start_year, args.end_year)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (requests.RequestException, RuntimeError, ValueError) as error:
        print(f"AutoTrace ingestion failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
