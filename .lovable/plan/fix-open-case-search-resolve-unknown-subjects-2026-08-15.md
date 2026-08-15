# Fix Open-Case Search + Resolve Unknown Subjects

## What's wrong today (confirmed against the live database)

The "Investigate" search on the New Case page always returns zero because the roster query is broken, not because the data is missing:

- The query joins the aircraft registry on columns that do not exist (`code`, `mfr_name`, `model_name`). Running it returns `column far.code does not exist`.
- That error is silently swallowed by a fallback that returns an empty list, so the page shows "No aircraft matched" instead of an error.
- The underlying data is there: AIR METHODS alone has 332 registry rows and 62 operator profiles.

For unknown subjects, 16 of 26 cases are missing a tail number and/or an owner — but most can be resolved from data already in the database (example: case WTPR-2026-0014, hex `a17501`, resolves to N193TH / WINGSLEASING LLC via the registry, and 3,504 detections broadcast that same tail).

## What gets built

### 1. Operator / entity search that actually returns results
- Repair the roster query to join the registry on its real columns (mode-S hex and N-number) and pull manufacturer/model from the correct fields.
- Broaden matching so the box accepts an owner name, an N-number, or an ICAO hex — not just an owner name.
- Stop hiding failures: if a query errors, the panel shows a clear red message with a Retry button instead of a misleading "0 aircraft".
- Show a helpful empty state that suggests shorter spellings and offers nearby owner-name matches when nothing hits exactly.

### 2. Identity Resolver for unknown cases
A new "Resolve Identity" panel on any case missing a tail or owner. It gathers candidates from every available source, ranks them, and shows plain-English confidence:

- FAA master registry and FAA aircraft registry, matched on the case's ICAO hex
- The tail number actually broadcast in that aircraft's own detections (majority vote)
- Callsign fingerprint: repeated callsigns such as `COBRA67` or `TORCH61` flag military/agency operators, and hex-block ranges identify military allocations
- Canonical operator profiles and aircraft profiles (KCSO / medical flags)
- Tail numbers read off linked radar screenshots in the vault

Each candidate shows what it says, where it came from, and how strong it is. One click applies the chosen identity to the case (writes tail, owner, and an audit note into the case record), and there's a "Mark as genuinely unidentified" option for airframes that stay dark.

### 3. Unknown-subject sweep on the case list
A banner listing every case still missing an identity, with a one-click "Auto-resolve all high-confidence" action so the backlog clears in one pass.

## Technical notes

- `getFleetInvestigation` in `src/lib/casework.functions.ts`: fix the `faa_aircraft_registry` join (`mode_s_code_hex` / `n_number`, `aircraft_manufacturer`, `aircraft_model`), extend the WHERE to match reg/hex, and remove the `.catch(() => [])` swallows so real errors propagate to the UI.
- New server functions `resolveSubjectIdentity` (read-only candidate gathering) and `applySubjectIdentity` (updates `cases.subject_reg` / `subject_owner` / `subject_icao` plus a reviewer note).
- Sources queried: `faa_master`, `faa_aircraft_registry`, `detections` (registration + callsign majority), `canonical_operator_profiles`, `aircraft_profiles`, `radar_screenshots`.
- UI: error/retry handling in `src/routes/cases.new.tsx`, resolver panel in `src/routes/cases.$caseId.tsx`, sweep banner in `src/routes/cases.tsx`.
- Audit other `.catch(() => [])` fallbacks in the casework layer that could hide the same class of failure.
