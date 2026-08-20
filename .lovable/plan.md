# Fixing the false zeros and wiring in the live ML tables

## What's actually wrong

The three zeros are real counts of the wrong table. Verified live in the database:

- The dashboard reads Spoofing / Masked Altitude / Impossible Physics from **`ml_anomaly_detections`**. That pipeline **stopped writing on 20 Jul 2026** — 31 days ago. Its last-24h window (19–20 July) contains only newer-style labels (`INTL_SPOOF`, `negative_altitude_physics`, `STALL_BELOW_50KTS_CAT_C`, lowercase comma-joined tags), so the uppercase labels the dashboard asks for return zero. Accurate arithmetic, wrong source.
- The **live** anomaly table is `anomaly_events`, written continuously (latest entries today, 20 Aug). It contains exactly the categories you track:
  - SPOOFING_SIGNAL — 16,928 total, latest today
  - MASKED_ALTITUDE — 789 total, latest yesterday
  - IMPOSSIBLE_PHYSICS — 3,324 total, latest today
  - plus SUSTAINED_MASKING, CROSS_FEED_INCONSISTENCY_SPOOFING, HEX_CASE_SPOOF, GNSS_INS_SPOOFING_INNOVATION_SPIKE, GHOST_VECTOR_UNMASKED, KINEMATIC_ANOMALY, SUB_STALL, LOITER_PATTERN, GRAPH_HANDOFF, NIGHT_LOW_OPS
- **`ensemble_anomaly_scores`** is the freshest ML surface in the whole database — 1,348,577 scored detections, last write **minutes ago** — and nothing in the command center reads it. It carries per-detection isolation-forest, LOF, temporal, neural, GCN, kinematic and GNSS/INS scores with a written explanation and a SHA-256 hash.
- The "ML Anomaly Brain 31.2d stale" badge is therefore measuring a retired pipeline, not your live one.

## What gets fixed and built

### 1. Point the anomaly counters at the live table
Spoofing, Masked Altitude and Impossible Physics move to `anomaly_events`, counted over the last 24 hours anchored to that table's latest record. Each family is counted by group, not by one exact label, so related labels stop being invisible:
- Spoofing = SPOOFING_SIGNAL + CROSS_FEED_INCONSISTENCY_SPOOFING + HEX_CASE_SPOOF(_INJECTION) + GNSS_INS_SPOOFING_INNOVATION_SPIKE
- Masking = MASKED_ALTITUDE + SUSTAINED_MASKING + GHOST_VECTOR_UNMASKED
- Impossible physics = IMPOSSIBLE_PHYSICS + KINEMATIC_ANOMALY + SUB_STALL
Each tile keeps a hover/hint line naming which labels it rolls up, so nothing is hidden behind a single number.

### 2. Honest pipeline freshness
"ML Anomaly Brain" reports the live `anomaly_events` age (currently minutes, not 31 days). The retired `ml_anomaly_detections` feed is shown separately as "Legacy anomaly feed (retired 20 Jul)" so it stops raising a false stale alarm. Incursion Detector stays flagged — that one genuinely hasn't run in 69 days.

### 3. New "Ensemble ML Scoring" tile row
From `ensemble_anomaly_scores`: detections scored in the last 24h, count above the high-score threshold, count where the models disagree (worth a human look), and how many are still unvalidated. Clicking through opens a triage list of the top-scoring recent detections with their plain-English `explanation`, aircraft, county and altitude.

### 4. Behaviour model strip stays but tells the truth
The strip already warns the profiles are 154 hours old. It gains the profile window dates (`window_start`/`window_end`) so you can see exactly what period the 5,693 fingerprints describe, and stops implying the scores are live.

### 5. Spoofing page realignment
`/spoofing` currently queries the retired table too. It moves to `anomaly_events` with the same grouped label families, so the page fills with the thousands of real spoofing and masking events instead of an empty window.

## Technical notes

- `getKpis` in `src/lib/watchtower.functions.ts`: swap the three `ml_anomaly_detections` subqueries to `anomaly_events` with `anomaly_type IN (...)` groups, anchored to `MAX(detected_at)` of that table; add `ensemble_*` aggregates and `legacy_ml_age_hours` alongside a new live `anomaly_age_hours`.
- `getSpoofingEvents` / spoofing rollups repointed to `anomaly_events`; `ml_anomaly_detections` kept read-only for historical case evidence already attached to it.
- New `getEnsembleTriage` server function (score-ordered, indexed on `scored_at`, LIMIT-first CTE) plus a tile group in `src/routes/index.tsx` and a triage list.
- `ModelHealthStrip` reads `window_start`/`window_end` from `aircraft_deep_profiles`.
- No schema changes and no writes — read-path corrections only.
