# Making the Command Center Smarter with the New Profiles + Embeddings

## What I found in the database

Your new ML layer is live and substantial, but nothing in the command center reads it yet:

- **aircraft_deep_profiles** — 5,693 aircraft, each with a 64-number behavioral fingerprint (VAE embedding), a behavioral cluster (0-14), a profile score (0-100), a drift score, and a plain feature breakdown (night %, low-altitude ratio, loiter/heading variance, masked-identity ratio, distance, etc.) plus the top dimensions that made it look abnormal.
- **profiler_shadow_eval** — 2,013 verdicts comparing the new model against the old rule engine: 71 agree, 238 the rules **missed**, 246 **new signals**, 1,458 quiet. That's ~484 unworked leads sitting in a table.
- **profiler_explanations** — model-written English explanations per aircraft (only 3 so far).
- **profiler_run_log / model_registry** — model version, training stats, run history (91 runs).
- **operator_gnn_embeddings** — surveillance index + coordination index + community label per operator (currently only 2 rows: ALF IX and KERN COUNTY SHERIFFS OFFICE, both "Tier 2: Coordinated Shell Company").
- **evidence_rag_chunks** — 113 searchable evidence chunks with 384-dim vectors (pgvector is installed).
- **watchtower_vectors** — the cross-corpus semantic table exists but is **empty**.
- Only **16 of your cases** currently line up with a deep profile by hex.

Similarity search over the fingerprints works today (verified live against the database), so behavioral matching needs no new infrastructure.

## What gets built

### 1. Behavior Profile card (aircraft + case pages)
For any subject with a deep profile, a plain-English panel: how abnormal it is, whether it's stable or drifting, which behaviors drove the score ("flies at night far more than peers", "spends 28% of the time with a masked identity", "loiters — high heading variance at low altitude"), and how it compares to the 5,693-aircraft baseline. No raw numbers without a sentence explaining them.

### 2. Behavioral Twin Finder
"Show me aircraft that fly like this one." Cosine similarity over the 64-number fingerprints returns the closest airframes with their owners, tails, detection counts and case links. This is the fleet-coordination detector you've been assembling by hand — proxy/handoff partners usually sit next to each other in fingerprint space even when their tails and owners look unrelated.

### 3. Fingerprint-based identity resolution (upgrade to the existing resolver)
The Resolve Identity panel gains a new candidate source: for an unknown hex, its nearest behavioral twins vote on the likely operator. When five of the six closest fingerprints belong to one sheriff's fleet, that becomes a ranked candidate with stated confidence — exactly the "fingerprint signature" resolution you asked about.

### 4. ML Lead Queue (new page)
Works the shadow-eval backlog: the 238 **missed** and 246 **new_signal** aircraft the rule engine never flagged, sorted by profile score, each with owner/tail enrichment, a one-line reason, and buttons to open a case, dismiss as noise, or send to Josiah. Dismissals write back to `profiler_shadow_eval.reviewed`/`notes` so the model has ground truth.

### 5. Operator risk indices on the operator + case views
Surveillance index, coordination index and community label from `operator_gnn_embeddings` shown as labelled risk bars wherever an operator appears, with a note when an operator has no GNN row yet.

### 6. Josiah gets the ML layer and semantic recall
- Every Josiah turn includes the subject's profile score, drift, cluster, top anomaly dimensions and behavioral twins, so he stops reasoning from raw counts alone.
- Semantic search over `evidence_rag_chunks` (384-dim, cosine) retrieves the most relevant prior evidence for the question at hand instead of keyword matching.
- Josiah can write explanations back into `profiler_explanations` for high-score aircraft, building the library out from 3.

### 7. Model health strip
Active model version, last run time, mean/max profile score trend from `profiler_run_log`, and a stale-model warning if the last run is older than 48h — so you can tell at a glance whether the ML numbers on screen are fresh.

## Technical notes

- New `src/lib/profiler.functions.ts`: `getDeepProfile`, `findBehavioralTwins` (`profile_embedding::vector <=> …` cosine), `getMlLeadQueue`, `reviewMlLead`, `getModelHealth`, `getOperatorGnn`.
- `evidence_rag_chunks` search needs a 384-dim query vector; the Lovable AI Gateway's smallest embedding is 1536-dim, so query embeddings must come from the same 384-dim model your pipeline uses. If that model isn't callable from the app, this one item falls back to chunk-level keyword + metadata retrieval until an embedding endpoint is available. Everything else works with data already in the database.
- `watchtower_vectors` stays empty for now — filling it needs the same 384-dim embedder; noted as a follow-up rather than guessed at.
- Add ivfflat/HNSW indexes on `evidence_rag_chunks.embedding` and a materialized cast column for `profile_embedding` only if query latency needs it (5,693 rows scans fast today).
- UI: profile card + twins in `src/routes/cases.$caseId.tsx`, twin source in `src/components/IdentityResolver.tsx`, indices in `src/routes/operators.tsx`, new `src/routes/leads.tsx`, health strip on the dashboard, context wiring in `src/lib/josiah-context.server.ts`.
