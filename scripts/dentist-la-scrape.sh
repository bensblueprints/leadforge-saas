#!/bin/bash
set -e

# LA Dentist Scraping Script
# Scrapes 100 dentists in Los Angeles and syncs to GHL

INDUSTRY="Dentist"
CITY="Los Angeles, CA"
MAX_RESULTS=100
GHL_API_KEY="${GHL_API_KEY:-pit-c4462672-3aa3-4053-bcd8-54816a9e443f}"
GHL_LOCATION_ID="${GHL_LOCATION_ID:-UBmPAwAYktetwRC3MC0Z}"

echo "🦷 Starting LA Dentist Scrape..."
echo "Target: ${MAX_RESULTS} dentists in ${CITY}"
echo ""

# Check for Google Maps API key
if [ -z "$GOOGLE_MAPS_API_KEY" ]; then
  echo "⚠️  No GOOGLE_MAPS_API_KEY found in environment"
  echo "This will generate demo data only."
  echo ""
  echo "To use real Google Maps data, set:"
  echo "  export GOOGLE_MAPS_API_KEY='your-api-key'"
  echo ""
  read -p "Continue with demo data? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Create temp directory for scraped leads
TEMP_DIR="/tmp/leadforge-dentist-la-$(date +%s)"
mkdir -p "$TEMP_DIR"

# Scrape using Google Maps API (if key available)
LEADS_FILE="$TEMP_DIR/dentist-leads.json"

if [ -n "$GOOGLE_MAPS_API_KEY" ]; then
  echo "🔍 Scraping real dentist data from Google Maps..."

  # Use Google Places API Text Search
  QUERY="Dentist in Los Angeles, CA"
  API_URL="https://maps.googleapis.com/maps/api/place/textsearch/json"

  # First page
  RESPONSE=$(curl -s "${API_URL}?query=${QUERY// /%20}&key=${GOOGLE_MAPS_API_KEY}")
  echo "$RESPONSE" > "$TEMP_DIR/page1.json"

  # Extract place IDs and fetch details
  PLACE_IDS=$(echo "$RESPONSE" | jq -r '.results[].place_id' | head -n 100)

  echo "[" > "$LEADS_FILE"
  FIRST=true
  COUNT=0

  for PLACE_ID in $PLACE_IDS; do
    if [ $COUNT -ge $MAX_RESULTS ]; then
      break
    fi

    # Get place details (phone, website, etc) with retry logic
    MAX_RETRIES=3
    RETRY_COUNT=0
    SUCCESS=false

    while [ $RETRY_COUNT -lt $MAX_RETRIES ] && [ "$SUCCESS" = false ]; do
      DETAILS=$(curl -s "https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=name,formatted_phone_number,website,formatted_address,rating,user_ratings_total&key=${GOOGLE_MAPS_API_KEY}")

      STATUS=$(echo "$DETAILS" | jq -r '.status // "ERROR"')

      if [ "$STATUS" = "OK" ]; then
        SUCCESS=true
      elif [ "$STATUS" = "OVER_QUERY_LIMIT" ]; then
        echo "  ⚠️  Rate limited, waiting 2 seconds..."
        sleep 2
        RETRY_COUNT=$((RETRY_COUNT + 1))
      else
        echo "  ⚠️  API error: $STATUS, retrying..."
        sleep 1
        RETRY_COUNT=$((RETRY_COUNT + 1))
      fi
    done

    if [ "$SUCCESS" = false ]; then
      echo "  ✗ Failed to fetch details for place (skipping)"
      continue
    fi

    NAME=$(echo "$DETAILS" | jq -r '.result.name // "Unknown"')
    PHONE=$(echo "$DETAILS" | jq -r '.result.formatted_phone_number // ""')
    WEBSITE=$(echo "$DETAILS" | jq -r '.result.website // ""')
    ADDRESS=$(echo "$DETAILS" | jq -r '.result.formatted_address // ""')
    RATING=$(echo "$DETAILS" | jq -r '.result.rating // 0')
    REVIEWS=$(echo "$DETAILS" | jq -r '.result.user_ratings_total // 0')

    if [ "$FIRST" = true ]; then
      FIRST=false
    else
      echo "," >> "$LEADS_FILE"
    fi

    cat >> "$LEADS_FILE" <<EOF
{
  "business_name": "$NAME",
  "phone": "$PHONE",
  "email": "",
  "address": "$ADDRESS",
  "city": "Los Angeles",
  "state": "CA",
  "website": "$WEBSITE",
  "rating": $RATING,
  "reviews": $REVIEWS,
  "tags": ["Dentist", "Los Angeles", "Auto-Scraped"]
}
EOF

    COUNT=$((COUNT + 1))
    echo "  ✓ Scraped: $NAME ($COUNT/$MAX_RESULTS)"

    # Conservative rate limit: 1 request per second to avoid throttling
    sleep 1
  done

  echo "]" >> "$LEADS_FILE"
  echo ""
  echo "✅ Scraped $COUNT real dentist leads from Google Maps"

else
  echo "📝 Generating demo dentist data..."

  # Generate demo leads
  echo "[" > "$LEADS_FILE"
  for i in $(seq 1 $MAX_RESULTS); do
    if [ $i -gt 1 ]; then
      echo "," >> "$LEADS_FILE"
    fi

    PHONE="(310) $(printf '%03d' $((RANDOM % 900 + 100)))-$(printf '%04d' $((RANDOM % 9000 + 1000)))"
    RATING=$(awk -v seed=$RANDOM 'BEGIN { srand(seed); printf "%.1f", rand()*2 + 3 }')
    REVIEWS=$((RANDOM % 200 + 10))
    STREET_NUM=$((RANDOM % 9999 + 1))

    cat >> "$LEADS_FILE" <<EOF
{
  "business_name": "[DEMO] LA Dental Care #$i",
  "phone": "$PHONE",
  "email": "demo$i@example.com",
  "address": "$STREET_NUM Wilshire Blvd, Los Angeles, CA 90017",
  "city": "Los Angeles",
  "state": "CA",
  "website": "https://demo-dentist-$i.example.com",
  "rating": $RATING,
  "reviews": $REVIEWS,
  "tags": ["Dentist", "Los Angeles", "Demo-Data"]
}
EOF
  done
  echo "]" >> "$LEADS_FILE"
  echo "✅ Generated $MAX_RESULTS demo leads"
fi

# Sync to GHL
echo ""
echo "🔄 Syncing leads to GoHighLevel..."

SYNCED=0
FAILED=0

jq -c '.[]' "$LEADS_FILE" | while read -r LEAD; do
  FIRST_NAME=$(echo "$LEAD" | jq -r '.business_name' | awk '{print $1}')
  LAST_NAME=$(echo "$LEAD" | jq -r '.business_name' | awk '{$1=""; print $0}' | xargs)
  EMAIL=$(echo "$LEAD" | jq -r '.email')
  PHONE=$(echo "$LEAD" | jq -r '.phone')
  ADDRESS=$(echo "$LEAD" | jq -r '.address')
  WEBSITE=$(echo "$LEAD" | jq -r '.website')
  TAGS='["Dentist","Los Angeles","Auto-Scraped"]'

  # Create contact in GHL
  RESPONSE=$(curl -s -X POST "https://services.leadconnectorhq.com/contacts/" \
    -H "Authorization: Bearer $GHL_API_KEY" \
    -H "Content-Type: application/json" \
    -H "Version: 2021-07-28" \
    -d "{
      \"firstName\": \"$FIRST_NAME\",
      \"lastName\": \"$LAST_NAME\",
      \"email\": \"$EMAIL\",
      \"phone\": \"$PHONE\",
      \"address1\": \"$ADDRESS\",
      \"locationId\": \"$GHL_LOCATION_ID\",
      \"source\": \"LeadForge Bot Army\",
      \"tags\": $TAGS,
      \"website\": \"$WEBSITE\"
    }")

  if echo "$RESPONSE" | grep -q '"id"'; then
    SYNCED=$((SYNCED + 1))
    echo "  ✓ Synced: $FIRST_NAME $LAST_NAME"
  else
    FAILED=$((FAILED + 1))
    echo "  ✗ Failed: $FIRST_NAME $LAST_NAME"
    # Uncomment to debug: echo "$RESPONSE"
  fi

  # Conservative rate limit: 2 requests per second
  sleep 0.5
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 SCRAPING COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Scraped:     $MAX_RESULTS dentists"
echo "  Synced:      $SYNCED to GHL"
echo "  Failed:      $FAILED"
echo "  Location:    $TEMP_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "View leads at: https://app.gohighlevel.com/location/$GHL_LOCATION_ID/contacts"
echo ""
