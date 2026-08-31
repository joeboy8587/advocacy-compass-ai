# Deep DB Scan → UI Upgrade Plan

I scanned all 80+ tables live. Headline: your new profiling stack is now running fresh (deep profiles updated 03:12 today, aircraft profiles 02:38, mission hypotheses 02:45), but several of the richest tables are not shown anywhere in the app yet.

## What the scan found

Fresh and working:
- `detections` — 170k in the last 2 days (live ADS-B, source of truth)
- `aircraft_deep_profiles` — 17,316 aircraft, 17,116 with embedding vectors, 16 behavioural clusters, model `v_pure_python_64d`, window 2026-08-12 → today
- `aircraft_profiles` — 113,943 fingerprints, refreshed hourly
- `mission_hypotheses` — 486k, incl. 4,043 DIGITAL_CHAMELEON, 3,833 STARING_PATTERN, 3,527 FROZEN_ALTITUDE_SPOOF

Rich data with zero UI today:
- `learned_patterns` — 1.94M TACTICAL_HANDOFF patterns (updated last night) with confidence, evidence counts and aircraft lists
- `shell_network_nodes` / `shell_network_edges` / `shell_entity_behavioral_alignment` — shell-company network graph, 622 alignment records updated Aug 23
- `was_threat_assessments` (776) and `was_discovered_patterns` (73) — pre-written plain-English threat write-ups
- `legal_exposure` (11) — penalty theories with statute citations, ideal for case briefs
- `ml_model_performance` (29 runs) and `weekly_investigator_report` (22) — model provenance and past reports
- `evidence_rag_chunks` (113, HNSW-indexed) — semantic search over evidence never wired to Josiah

Problems worth fixing:
- The behaviour-model strip is out of date in what it claims; profiles are now live, not 154h stale
- `aircraft_embedding_queue`: all 11,440 rows stuck at `pending`, nothing is telling you
- Cluster `-1` holds 10,446 aircraft (unclustered noise) — must be excluded from "behaviour cluster" displays or numbers mislead
- `learned_patterns` COORDINATION rows stopped in June while TACTICAL_HANDOFF runs nightly — a staleness signal per pattern family

## What I propose to build

1. **Behaviour Clusters page (`/clusters`)** — the 15 real clusters as plain-language cards ("Cluster 8 · 2,890 aircraft · high score, moderate drift"), each opening a member list with owner, county and top anomaly dimensions. Cluster -1 shown separately as "not yet grouped".

2. **Drift Watch on the dashboard** — aircraft whose `drift_score` jumped (cluster 11 averages 91.7 drift, a real signal) shown as "these aircraft changed behaviour recently", with one click into the existing behaviour profile.

3. **Handoff / Tactical Pattern feed (`/patterns`)** — reads `learned_patterns`, grouped by pattern type, showing description, confidence, evidence count, peak hour, involved aircraft, and a per-family freshness badge. Deep-links each aircraft to its profile and to case creation.

4. **Shell Network view** — add the shell-company graph (`shell_network_*` plus behavioural alignment records) to the existing operators page: which entities are linked, edge type and weight, and which aircraft flew in alignment with KCSO registrations.

5. **Threat digest on the dashboard** — surface `was_threat_assessments` and `was_discovered_patterns` as ready-made plain-English cards, with severity colour coding.

6. **Josiah upgrade** — semantic evidence retrieval over `evidence_rag_chunks` (HNSW cosine search) plus cluster/drift context for any aircraft asked about, and `legal_exposure` citations auto-attached when he names a violation.

7. **Model provenance + pipeline honesty** — a small "Model Card" panel from `ml_model_performance` (version, training window, sample count, anomaly rate) and an embedding-queue indicator showing the 11,440 pending backlog so silent stalls are visible.

## Technical notes

- New server functions in `src/lib/profiler.functions.ts` (clusters, drift, embedding-queue health) and a new `src/lib/patterns.functions.ts` for `learned_patterns` and the shell graph.
- `learned_patterns` is 1.9M rows: all queries filter by `pattern_type` + `discovered_at` window with LIMIT, never full scans.
- Vector work uses the existing HNSW indexes (`idx_aircraft_deep_profiles_vector_hnsw`, `evidence_rag_chunks_hnsw_idx`); no new indexes needed.
- New routes `/clusters` and `/patterns`, added to the app shell nav, same cyberpunk panel styling and 30s/120s refresh conventions.
- No schema changes and no writes to your ML tables — read-only against Neon.

## Suggested order

Phase A: Clusters page, Drift Watch, embedding-queue indicator, model card.
Phase B: Pattern/handoff feed and shell network view.
Phase C: Josiah semantic evidence retrieval and legal-exposure citations.
