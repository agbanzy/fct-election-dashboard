#!/bin/bash
# Generate LGA+ward geojson for all remaining states. Continues on failure.
cd "/Users/godwinagbane/Desktop/Election results" || exit 1
# code|StateName (GRID3 statename, spaced where needed)  — Lagos + the 6 prior already done
STATES=(
"ab|Abia" "ad|Adamawa" "ak|Akwa Ibom" "an|Anambra" "ba|Bauchi" "be|Benue"
"bo|Borno" "by|Bayelsa" "cr|Cross River" "de|Delta" "eb|Ebonyi" "ed|Edo"
"en|Enugu" "go|Gombe" "im|Imo" "ji|Jigawa" "kd|Kaduna" "ko|Kogi"
"kt|Katsina" "kw|Kwara" "ni|Niger" "og|Ogun" "on|Ondo" "os|Osun"
"oy|Oyo" "pl|Plateau" "so|Sokoto" "ta|Taraba" "yo|Yobe" "za|Zamfara"
)
ok=0; fail=0
for entry in "${STATES[@]}"; do
  code="${entry%%|*}"; name="${entry##*|}"; hasc="NG.$(echo $code | tr a-z A-Z)"
  echo "=== $code ($name) $hasc ==="
  if python3 backend/tools/build_state_geojson.py "$code" "$name" --hasc="$hasc" 2>&1 | grep -E "wards:|lgas:|Error|error|not found|not available"; then
    if [ -f "frontend/public/maps/${code}-lgas.geojson" ]; then ok=$((ok+1)); else fail=$((fail+1)); echo "  !! no lgas file for $code"; fi
  else fail=$((fail+1)); echo "  !! run failed for $code"; fi
done
echo "=== DONE: ok=$ok fail=$fail ==="
ls frontend/public/maps/*-lgas.geojson | wc -l | xargs echo "total states with lgas geojson:"
