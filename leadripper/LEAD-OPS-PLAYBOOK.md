# LeadRipper - Lead Operations Playbook
**Advanced Marketing | Benjamin Boyce**
**Last Updated: 2026-02-19**

---

## 1. Lead Sources

| Source | URL | Status | Type |
|--------|-----|--------|------|
| **LeadRipper** | leadripper.com | LIVE | Google Places scraping (primary) |
| **LeadForge AI** | leadforge.advancedmarketing.co | LIVE | Same engine, original branding |
| **Lead Scraper** | lead-scraper-dashboard.netlify.app | Active | Separate dashboard |
| **CLI Scripts** | `scripts/dentist-la-scrape.sh` | Manual | Direct Google Maps + GHL sync |
| **FB Group Poster** | fb-group-poster.netlify.app | Active | Social lead gen |
| **Upwork Hunter** | upwork.advancedmarketing.co | Active | Job acquisition |

---

## 2. Supported Industries (18)

| Industry | Scrape Key | Priority | Client Match |
|----------|-----------|----------|--------------|
| Dentists | `dentist` | HIGH | -- |
| Lawyers | `lawyer` | HIGH | Miami Divorce Attorney |
| Doctors | `doctor` | MEDIUM | -- |
| Chiropractors | `chiropractor` | HIGH | -- |
| Plumbers | `plumber` | HIGH | -- |
| Electricians | `electrician` | HIGH | -- |
| HVAC | `hvac` | HIGH | -- |
| Roofing | `roofing` | HIGH | -- |
| Restaurants | `restaurant` | LOW | -- |
| Gyms & Fitness | `gym` | MEDIUM | -- |
| Real Estate | `realtor` | MEDIUM | -- |
| Accountants | `accountant` | MEDIUM | -- |
| Hair Salons | `salon` | MEDIUM | -- |
| Spas & Wellness | `spa` | MEDIUM | Marta Mithras |
| Veterinarians | `veterinarian` | MEDIUM | -- |
| Auto Repair | `auto_repair` | MEDIUM | -- |
| Insurance | `insurance` | MEDIUM | -- |
| Landscaping | `landscaping` | MEDIUM | -- |

---

## 3. GHL Pipeline Strategy

### Recommended Pipeline Setup

Create these pipelines in GHL under the **Advanced Marketing Limited** location (`fl5rL3eZQWBq2GYlDPkl`):

#### Pipeline: "LeadRipper - Inbound Leads"
| Stage | Purpose | Action |
|-------|---------|--------|
| 1. New Lead | Raw scraped lead, uncontacted | Auto-populated by LeadRipper sync |
| 2. Email Found | Lead has verified email | After email scraping enrichment |
| 3. Contacted | First outreach sent | Manual or via GHL workflow |
| 4. Responded | Lead replied | Manual update |
| 5. Booked | Meeting/call scheduled | Manual update |
| 6. Closed - Won | Became client | Manual update |
| 7. Closed - Lost | Not interested / dead | Manual update |

#### Pipeline: "Client Lead Delivery"
For leads being delivered TO clients (agency model):

| Stage | Purpose |
|-------|---------|
| 1. Scraped | Fresh lead, not yet delivered |
| 2. Delivered | Sent to client |
| 3. Client Contacted | Client reached out to lead |
| 4. Converted | Lead became client's customer |

### Industry-to-Pipeline Routing

Configure in LeadRipper dashboard (Settings > GHL > Industry Pipelines):

```json
{
  "lawyer": { "pipelineId": "<legal-pipeline-id>", "stageId": "<new-lead-stage>" },
  "dentist": { "pipelineId": "<healthcare-pipeline-id>", "stageId": "<new-lead-stage>" },
  "plumber": { "pipelineId": "<home-services-pipeline-id>", "stageId": "<new-lead-stage>" },
  "hvac": { "pipelineId": "<home-services-pipeline-id>", "stageId": "<new-lead-stage>" },
  "roofing": { "pipelineId": "<home-services-pipeline-id>", "stageId": "<new-lead-stage>" }
}
```

---

## 4. Lead Flow Architecture

```
SCRAPE                    ENRICH                    DISTRIBUTE
=====                     ======                    ==========

Google Places API ──┐
                    ├──> PostgreSQL (lf_leads) ──> Email Scraper ──┐
SerpAPI (fallback) ─┘                                              │
                                                                   v
                                                            ┌─────────────┐
                                                            │  GHL Sync   │
                                                            │  (Contacts) │
                                                            └──────┬──────┘
                                                                   │
                                              ┌────────────────────┼────────────────────┐
                                              v                    v                    v
                                        GHL Pipeline         CSV Export          Webhook Alert
                                     (Auto-routed by        (Bulk download)    (Real-time notify)
                                      industry)
```

---

## 5. Target Markets - Scrape Plan

### Phase 1: High-Value Home Services (Week 1-2)
Scrape top 25 US metros for each:
- Plumbers
- HVAC
- Roofing
- Electricians
- Landscaping

**Cities:** New York, Los Angeles, Chicago, Houston, Phoenix, Philadelphia, San Antonio, San Diego, Dallas, San Jose, Austin, Jacksonville, Fort Worth, Columbus, Charlotte, Indianapolis, San Francisco, Seattle, Denver, Nashville, Oklahoma City, Las Vegas, Portland, Memphis, Louisville

**Expected yield:** ~500 leads per city per industry = ~62,500 leads

### Phase 2: Healthcare & Professional (Week 2-3)
Same 25 cities:
- Dentists
- Chiropractors
- Doctors
- Veterinarians

**Expected yield:** ~50,000 leads

### Phase 3: Legal & Financial (Week 3-4)
Same 25 cities:
- Lawyers
- Accountants
- Insurance agents
- Real estate agents

**Expected yield:** ~50,000 leads

### Phase 4: Lifestyle & Retail (Week 4+)
- Gyms, Salons, Spas, Restaurants, Auto Repair

---

## 6. Client Project Lead Routing

| Client | Industry | Market | Lead Source | GHL Action |
|--------|----------|--------|-------------|------------|
| Miami Divorce Attorney | `lawyer` | Miami, FL | LeadRipper scrape "divorce attorney" | Sync to client sub-account |
| Herban Bud | Cannabis/CBD | TBD | Custom scrape "dispensary" | Sync to client sub-account |
| Dope Pros | Cannabis | TBD | Custom scrape | Sync to client sub-account |
| Marta Mithras | `spa`/wellness | TBD | LeadRipper scrape "yoga studio" | Sync to client sub-account |
| New Harvest | TBD | TBD | TBD | TBD |

---

## 7. Automation Checklist

### Already Working
- [x] User registration (7-day trial, 500 leads)
- [x] Lead scraping via Google Places API
- [x] Lead storage in PostgreSQL (Neon)
- [x] CSV export
- [x] Email enrichment (website crawling)
- [x] GHL sync code (needs API key scopes)
- [x] Admin panel
- [x] Industry-specific pipeline routing (code ready)

### Needs Setup
- [ ] GHL API key scopes: enable `contacts.write` + `opportunities.write`
- [ ] Create GHL pipelines (see Section 3)
- [ ] Configure industry-to-pipeline routing in dashboard
- [ ] Airwallex: switch from demo to production for payments
- [ ] Set up GHL workflows for auto-outreach after lead sync
- [ ] Automated scrape scheduling (cron / n8n workflow)

### Future Enhancements
- [ ] Lead scoring based on rating + reviews + has_email + has_website
- [ ] Auto-email campaigns via Resend API
- [ ] Duplicate detection across scrape runs
- [ ] Client sub-account management (multi-tenant GHL)
- [ ] Lead delivery reports for agency clients

---

## 8. Environment Variables (Netlify - LeadRipper)

| Variable | Status | Value |
|----------|--------|-------|
| `DATABASE_URL` | SET | Neon PostgreSQL |
| `JWT_SECRET` | SET | `leadripper-secret-key-2026` |
| `GOOGLE_MAPS_API_KEY` | SET | `AIzaSyA1J9ly...` |
| `AIRWALLEX_API_KEY` | SET | Demo mode |
| `AIRWALLEX_CLIENT_ID` | SET | Demo mode |
| `AIRWALLEX_ENV` | SET | `demo` |
| `SUPABASE_URL` | SET | Not used (legacy) |
| `SUPABASE_SERVICE_KEY` | SET | Not used (legacy) |
| `N8N_CALLBACK_SECRET` | SET | `leadripper-n8n-secret` |
| `SERP_API_KEY` | NOT SET | Optional fallback |

---

## 9. Key URLs & Access

| Resource | URL |
|----------|-----|
| LeadRipper (live) | https://leadripper.com |
| LeadRipper Netlify | https://app.netlify.com/projects/leadripper |
| LeadRipper Function Logs | https://app.netlify.com/projects/leadripper/logs/functions |
| GitHub Repo | https://github.com/bensblueprints/leadforge-saas |
| GHL Dashboard | https://app.gohighlevel.com |
| GHL Location ID | `fl5rL3eZQWBq2GYlDPkl` |
| GHL API Key | `pit-d6b661eb-5662-4b97-acb9-dd7360bb1c0f` (needs scopes) |
| ClickUp LeadRipper | Folder ID `901812350639` |
| Neon DB | `ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech` |
