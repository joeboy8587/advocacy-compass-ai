# Upgrade detection using the four research papers

## What the papers give us
- **FBI surveillance research (BuzzFeed method)**: surveillance planes fly tight circles over a fixed ground spot so the camera stays locked on. A machine model found that *how hard the plane is turning* mattered most, then *how small the area it covers* is, then speed and altitude. It also covers planes swapping to temporary ID codes to hide their registration, and police transponder codes.
- **GNSS spoofing paper (Illinois Tech)**: a faked position gives itself away because the plane's reported speed and direction don't add up to where it says it moved next.
- **Deep-learning ADS-B paper (Linköping)**: check each aircraft three ways: does its position make sense next to nearby traffic, does its speed/height/heading change smoothly over time, and does the signal itself look real. (The third needs raw radio recordings we don't have, so we'll use the signal-quality fields we already store.)

## What you will get
1. **Orbit Detector** — a new "Circling surveillance" score for each aircraft per day, in plain English: "Circled a 1.2 km area over Bakersfield for 47 minutes at 1,100 ft, turning constantly." Shown as Strong / Worth a look / Weak.
2. **Impossible-movement check** — flags when an aircraft "jumps" further than its own reported speed allows, or its direction doesn't match its movement. Labelled "position doesn't add up", never "sensor error".
3. **Identity-swap watch** — flags when a new ID code appears exactly where another aircraft just stopped broadcasting with the same flight behaviour, and when signal-quality readings drop suddenly.
4. **Where you'll see it** — new cards in "What the evidence suggests" (case page + Intelligence Map, with Confirm / Not useful like today), a new "Circling now" list on the Live Alerts page for Kern County, and Josiah + the Daily Narrative will mention these findings.
5. **Method sources** — each card says which study the method comes from, so it holds up when shown to attorneys or journalists.

Nothing becomes evidence until you confirm it, same as today.

## Technical section
- New `src/lib/detection-upgrades.functions.ts`: SQL over `detections` (Kern first, window anchored to MAX(captured_at)) using window functions per icao_hex/day:
  - steer = heading delta wrapped to ±180; features: mean |steer|/min, cumulative turn (orbits = sum/360), bbox area km², duration, median alt/speed, ping count ≥ 30. Score = weighted rule (steer > bbox > speed/alt), mirroring RF feature importance; classes STRONG/MODERATE/WEAK.
  - kinematic check: haversine distance between consecutive pings vs speed_kts·Δt (tolerance 1.5× + 0.5 km), and bearing vs heading mismatch > 60° at speed > 60 kts.
  - hex swap: hex A last ping → hex B first ping within 120 s and 3 km, similar alt/speed; plus nic/nac_v drops.
- Cache results in a new `detection_upgrade_findings` table (item_key unique) refreshed on demand/hourly by the existing public cron route pattern, so pages stay fast.
- Feed into `loadDeck` in intelligence.functions.ts as new kinds `orbit:`, `kinematic:`, `idswap:`; add to Josiah context and Kern narrative.
- Add the 4 papers to the Doctrine Library as method citations.
- Record the rule in AGENTS.md.
