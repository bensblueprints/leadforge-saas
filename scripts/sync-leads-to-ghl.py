#!/usr/bin/env python3
import json
import urllib.request
import urllib.parse
import time
import sys
import os

# Configuration
GHL_API_KEY = os.getenv("GHL_API_KEY", "pit-c4462672-3aa3-4053-bcd8-54816a9e443f")
GHL_LOCATION_ID = os.getenv("GHL_LOCATION_ID", "UBmPAwAYktetwRC3MC0Z")
GHL_API_URL = "https://services.leadconnectorhq.com/contacts/"

def read_leads_from_file(file_path):
    """Read and clean up the JSON leads file"""
    with open(file_path, 'r') as f:
        content = f.read()

    # Remove trailing commas before closing braces/brackets
    content = content.replace(',\n]', '\n]').replace(',\n}', '\n}')

    try:
        leads = json.loads(content)
        return leads
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        print("Attempting to fix and retry...")

        # Try to fix common issues
        lines = content.split('\n')
        fixed_lines = []
        for i, line in enumerate(lines):
            # Remove trailing comma if next non-empty line starts with } or ]
            if line.strip().endswith(','):
                # Look ahead to see if we need to remove the comma
                for j in range(i+1, len(lines)):
                    next_line = lines[j].strip()
                    if next_line:
                        if next_line.startswith('}') or next_line.startswith(']'):
                            line = line.rstrip(',')
                        break
            fixed_lines.append(line)

        content = '\n'.join(fixed_lines)
        return json.loads(content)

def sync_lead_to_ghl(lead):
    """Sync a single lead to GoHighLevel"""
    # Extract business name parts for first/last name
    business_name = lead.get('business_name', '')
    name_parts = business_name.split(' ', 1)
    first_name = name_parts[0] if len(name_parts) > 0 else 'Business'
    last_name = name_parts[1] if len(name_parts) > 1 else 'Contact'

    # Prepare contact data
    contact_data = {
        "firstName": first_name,
        "lastName": last_name,
        "name": business_name,
        "phone": lead.get('phone', ''),
        "email": lead.get('email', ''),
        "address1": lead.get('address', ''),
        "city": lead.get('city', ''),
        "state": lead.get('state', ''),
        "website": lead.get('website', ''),
        "locationId": GHL_LOCATION_ID,
        "source": "LeadForge Bot Army",
        "tags": lead.get('tags', ["Dentist", "Los Angeles", "Auto-Scraped"]),
        "customFields": [
            {"key": "rating", "value": str(lead.get('rating', ''))},
            {"key": "reviews", "value": str(lead.get('reviews', ''))},
        ]
    }

    # Remove empty fields
    contact_data = {k: v for k, v in contact_data.items() if v}

    headers = {
        "Authorization": f"Bearer {GHL_API_KEY}",
        "Content-Type": "application/json",
        "Version": "2021-07-28",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }

    try:
        data = json.dumps(contact_data).encode('utf-8')
        req = urllib.request.Request(GHL_API_URL, data=data, headers=headers, method='POST')

        with urllib.request.urlopen(req) as response:
            if response.status in [200, 201]:
                return True, f"✓ Synced: {business_name}"
            else:
                error_msg = response.read().decode('utf-8')[:200]
                return False, f"✗ Failed: {business_name} - {response.status}: {error_msg}"

    except urllib.error.HTTPError as e:
        error_msg = e.read().decode('utf-8')[:200]
        return False, f"✗ HTTP Error: {business_name} - {e.code}: {error_msg}"
    except Exception as e:
        return False, f"✗ Error: {business_name} - {str(e)}"

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 sync-leads-to-ghl.py <leads-json-file>")
        sys.exit(1)

    leads_file = sys.argv[1]

    if not os.path.exists(leads_file):
        print(f"Error: File not found: {leads_file}")
        sys.exit(1)

    print("📊 Loading leads from file...")
    leads = read_leads_from_file(leads_file)
    print(f"Found {len(leads)} leads to sync\n")

    print("🔄 Syncing to GoHighLevel...\n")

    synced = 0
    failed = 0

    for i, lead in enumerate(leads, 1):
        success, message = sync_lead_to_ghl(lead)
        print(f"[{i}/{len(leads)}] {message}")

        if success:
            synced += 1
        else:
            failed += 1

        # Rate limit: 2 requests per second to be safe
        time.sleep(0.5)

    print("\n" + "="*50)
    print("🎉 SYNC COMPLETE!")
    print("="*50)
    print(f"  Total leads:  {len(leads)}")
    print(f"  Synced:       {synced}")
    print(f"  Failed:       {failed}")
    print("="*50)
    print(f"\nView contacts: https://app.gohighlevel.com/location/{GHL_LOCATION_ID}/contacts\n")

if __name__ == "__main__":
    main()
