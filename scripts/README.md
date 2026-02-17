# LeadForge Automation Scripts

## Overview

This directory contains automation scripts for scraping leads and syncing them to GoHighLevel.

## Scripts

### 1. dentist-la-scrape.sh
Scrapes dentist leads from Google Maps and syncs them to GHL.

**Usage:**
```bash
export GOOGLE_MAPS_API_KEY="your-api-key"
export GHL_API_KEY="your-ghl-api-key"
export GHL_LOCATION_ID="your-location-id"

./dentist-la-scrape.sh
```

**Features:**
- Uses Google Places API for real data
- Falls back to demo data if no API key
- Handles pagination (up to 100 results)
- Automatic rate limiting
- Retry logic for API failures
- Direct GHL sync

### 2. sync-leads-to-ghl.py
Python script to sync scraped leads JSON to GoHighLevel.

**Usage:**
```bash
python3 sync-leads-to-ghl.py /path/to/leads.json
```

**Features:**
- Reads JSON lead files
- Auto-fixes JSON formatting issues
- Syncs to GHL with proper headers
- Rate-limited (2 req/sec)
- Cloudflare bypass
- Detailed success/failure reporting

## Environment Variables

Required environment variables:

```bash
GOOGLE_MAPS_API_KEY="AIzaSy..."  # Google Maps API key
GHL_API_KEY="pit-..."             # GoHighLevel API key
GHL_LOCATION_ID="UBm..."          # GHL Location ID
```

## API Configuration

### Google Maps API
1. Go to Google Cloud Console
2. Enable Places API
3. Create API key
4. Add to environment

### GoHighLevel API
1. Login to GHL
2. Settings > Integrations
3. Create Private Integration Token
4. Use `pit-` format key

## Workflow

1. **Scrape leads**: Run dentist-la-scrape.sh
2. **Review data**: Check /tmp/leadforge-dentist-la-*/dentist-leads.json
3. **Sync to GHL**: Automatically done by script, or manual via sync-leads-to-ghl.py
4. **View in GHL**: Check your contacts in the GHL dashboard

## Output

Leads are stored in:
```
/tmp/leadforge-dentist-la-<timestamp>/dentist-leads.json
```

## Integration with LeadForge SaaS

These scripts complement the Netlify functions in `netlify/functions/trigger-scrape.js` which provides the same functionality through the web interface.

The bash/Python scripts are useful for:
- CLI automation
- Cron jobs
- Testing
- Bulk operations
- Local development
