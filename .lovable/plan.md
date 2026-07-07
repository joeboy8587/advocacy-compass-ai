## Goal

Add an OSINT enrichment layer that pulls from free public sources automatically and exposes paid/rate-limited sources as one-click buttons on the case page. All results are hashed, timestamped, and attached to the case as evidence Josiah can cite.

## Sources & wiring

### Auto (free, run on case open + nightly cron)
- **OpenSky Network REST** — historical tracks for subject tail/hex (last 30 days), fills gaps our scanner missed. No key needed.
- **OpenStreetMap Overpass + Nominatim** — for every low-altitude detection, resolve what is underneath (schools, hospitals, residential, prisons). Produces §91.119 proof-of-populated-area evidence rows.
- **Wayback Machine Save API** — archive every doctrine URL and every OSINT source URL we cite. Returns a permanent snapshot URL stored alongside the SHA-256 hash.
- **OpenCorporates public search** — resolve owner LLC → officers, jurisdiction, incorporation date, registered agent. Flags shell-company red flags (agent-only address, <12 months old, shared address with other fleet LLCs).
- **OpenSanctions** — screen every resolved owner + officer name against PEP / sanctions / law-enforcement watchlists.

### Manual (button per case, uses your key)
- **ADS-B RapidAPI (your key)** — "Deep pull" button: full flight history, receiver coverage, squawk history for subject aircraft. Stored in a new `osint_adsb_pulls` table.
- **OpenCorporates full record** (paid tier if key added later) — deeper officer/filing history.

## What the user sees

New **OSINT** tab on the case page (`/cases/$caseId`) with four stacked panels:

1. **Flight History** — OpenSky auto-pull + "Deep ADS-B pull (RapidAPI)" button. Table of flights with date, route, min altitude, duration.
2. **Ownership Web** — OpenCorporates card for subject owner: officers, agent, incorporation, sibling LLCs at same address. Red-flag badges.
3. **Watchlist Screening** — OpenSanctions hits for owner + every officer name. Green check or red flag with source citation.
4. **Ground Truth** — Overpass results for each low-alt detection: "1,650 ft over Ridgecrest Elementary School (34.6218, -117.6784) — 14 CFR §91.119(b) requires 1,000 ft."

Each panel has an **Archive to Wayback** button that snapshots the source URL and stores the archive link in the case's evidence chain.

A small **OSINT** badge appears on the case card in the main list when enrichment has run, with a count of red-flag findings.

## Josiah integration

`gatherContext()` in `src/lib/ai.functions.ts` gains an OSINT block for the bound case: OpenCorporates officer names, sanctions hits, Overpass ground-truth strings, OpenSky flight count. Josiah cites them by source ("per OpenCorporates filing dated…", "per OpenSanctions PEP list…") — never invents.

## Technical notes (for the record, not required reading)

- New table `osint_findings` (case_id, source, subject, payload jsonb, source_url, wayback_url, sha256, retrieved_at) with grants + RLS.
- New table `osint_adsb_pulls` for RapidAPI results (larger payloads, separate quota tracking).
- Secret `RAPIDAPI_ADSB_KEY` added via secrets tool (you'll paste the key).
- New server-function file `src/lib/osint.functions.ts` with `enrichCase`, `deepAdsbPull`, `archiveUrl`, `screenSanctions`, `resolveOwner`, `groundTruthDetection`.
- Nightly cron endpoint `/api/public/osint/nightly` re-runs free enrichers on all active cases (DRAFT/REVIEW/CONFIRMED).
- OpenSky and Overpass are rate-limited — the enricher batches and caches by (source, subject, day) so the same call in the same day is a cache hit.
- Wayback archives every source_url so the chain-of-custody survives even if the upstream page changes.

## Out of scope for this pass

- Sentinel Hub / NASA FIRMS satellite imagery (needs paid key + heavier UI; can add later).
- CourtListener/RECAP scraping (separate pass — belongs with a broader "legal filings" module).
- SerpAPI (needs paid key; skip until you decide).

## Deliverable checklist

1. `RAPIDAPI_ADSB_KEY` secret added (I'll prompt you for the value).
2. `osint_findings` + `osint_adsb_pulls` migrations with grants/RLS.
3. `src/lib/osint.functions.ts` server functions.
4. `/api/public/osint/nightly` cron endpoint (shared-secret auth).
5. OSINT tab on `/cases/$caseId` with the four panels + Wayback buttons.
6. OSINT badge on case list cards.
7. Josiah context updated to include OSINT findings for bound cases.
