<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Hypothesis Deck & investigator memory

- Machine-derived leads are aggregated in `src/lib/intelligence.functions.ts` and rendered only through `src/components/HypothesisDeck.tsx` — why: one roll-up keeps millions of `learned_patterns` / `mission_hypotheses` rows presentable as a handful of reviewable leads.
- Investigator verdicts live in `investigator_reviews` (unique on `item_kind,item_key`); only CONFIRMED / NOT_USEFUL propagate into `josiah_memory` — why: "needs review" is a holding state and must not bias generated briefs.
- Every AI generation path (`askInvestigator`, case briefs, daily narrative) injects `fetchInvestigatorMemory()` as a binding prompt section — why: human verdicts must override model output everywhere, not just in chat.

## Research-derived detectors
- Orbit / impossible-movement / identity-swap checks live in `src/lib/detection-upgrades.server.ts`, computed live from `detections` (anchored to MAX(captured_at)) and surfaced via the Hypothesis Deck kinds `orbit`/`kinematic`/`idswap` — why: each lead cites its published method, and live queries run in ~2s so no cache table is needed.
- Signal-layer check (`signalFor`, deck kind `signal`) compares FIRST_PARTY_RTL_SDR positions to same-5-second `adsb_icao` feed positions plus `soda_phy_fingerprints` ghost flags — why: raw_hex holds only the address (no full frames/I-Q), so our own antenna is the only independent signal witness; antenna/feed gaps stay WEAK because they are currently systemic.
