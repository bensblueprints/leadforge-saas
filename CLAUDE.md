# Claude Brain - Benjamin Boyce / Advanced Marketing Operations
## Master Reference Document - Any Claude instance should read this first
**Last Updated:** 2026-02-18

---

## ACTIVE TASK: LeadRipper Restyle
**This repo (leadforge-saas) needs to be restyled and deployed to leadripper.com**

### What to do:
1. **Restyle orange/black** - Change the CSS color scheme from cyan/purple to orange (#ff8c00) and black (#080808)
2. **Rebrand** - Change all references from "LeadForge AI" to "LeadRipper"
3. **New pricing structure:**
   - FREE TRIAL: 7 days OR 500 leads (whichever comes first)
   - After trial: $99/month (single plan, unlimited leads)
4. **Keep ALL functionality** - Auth, lead scraping, CSV export, GHL sync, webhooks - everything stays
5. **Deploy to Netlify site:** leadripper (site ID: 1dadeb61-8e1f-48db-9ccf-dff912531b20)

### CSS Variables to change (in index.html :root):
- --accent-primary: #00e5ff → #ff8c00 (orange)
- --accent-secondary: #7c3aed → #ff5500 (deep orange)
- --accent-tertiary: #10b981 → #ffaa00 (gold)
- --glow-primary: rgba(0,229,255,0.15) → rgba(255,140,0,0.15)
- --glow-secondary: rgba(124,58,237,0.15) → rgba(255,85,0,0.15)
- --gradient-primary: change to orange gradient
- Background vars: keep dark but shift from blue-tinted to pure black

### Netlify deploy command:
```bash
npx netlify-cli deploy --prod --site 1dadeb61-8e1f-48db-9ccf-dff912531b20 --auth nfp_qdr1zz7uAYjWSMSU2LBySaVW1nhF4U9T6ec9 --dir .
```

---

## Owner
- **Name:** Benjamin Boyce
- **Primary Email:** ben@advancedmarketing.co
- **GitHub:** bensblueprints
- **Location:** Vietnam (Asia/Saigon timezone)
- **Business:** Advanced Marketing (advancedmarketing.co)

## Team Members
| Name | Email | Role | ClickUp ID |
|------|-------|------|-----------|
| Benjamin Boyce | ben@advancedmarketing.co | Owner | 306728756 |
| Saurebh | saurebh@advancedmarketing.co | Member | 107651954 |
| Prathamesh Mali | pratham@advancedmarketing.co | Member | 107651953 |
| Molt Bot 1 | TBD | Bot (Mac Mini) | TBD |

---

## API Credentials & Access

### GitHub
- **CLI:** gh (installed at /c/Program Files/GitHub CLI)
- **Account:** bensblueprints
- **Auth:** Logged in via gh auth (keyring)

### Cloudflare
- **Account:** Ben@justfeatured.com's Account
- **Account ID:** cd1101d063eaba1717d71c13a6ae8c73
- **API Token:** Bearer UtW2SjqpYV9pn7moY-DhhyGFeOecpKfhstGeoKBb
- **Permissions:** DNS read/edit, Zone read

### Netlify
- **Account:** Benjamin Boyce (bensblueprints)
- **Email:** ben@advancedmarketing.co
- **Account Slug:** rootaccess
- **Account Type:** Pro
- **API Token:** Bearer nfp_qdr1zz7uAYjWSMSU2LBySaVW1nhF4U9T6ec9
- **Total Sites:** 103

### ClickUp
- **Workspace:** Advancedmarketing (Team ID: 90182459032)
- **Space:** Team Space (ID: 90189869635)
- **API Token:** pk_306728756_PAMBIWTJU040ZANKZR4H1ZWCEOS2GUSC

---

## Domain Architecture

### Cloudflare Zones
| Domain | Zone ID | Status | NS |
|--------|---------|--------|-----|
| advancedmarketing.co | 336d95bd4610e03e5ad636bbe98fe786 | Active | elijah/monika |
| benjaminboyce.com | a17a6f16cd1680838801c1963e6cc15e | Active | elijah/monika |
| bulkkratom.us | 99935e0586d8745fa49c2b664207ff44 | Pending | jen/sage |
| foundersvietnam.com | 8c0e50103866966819c86db2b97b77fa | Pending | elijah/monika |
| leadripper.com | e28b581792f031f1db85b680ade74d64 | Active | jen/sage |
| upvotethat.com | 24d24f3bc6d8624a89b374f34b7fff2f | Active | elijah/monika |

### Hosting Standard
- **All sites hosted on Netlify** (NOT on personal server)
- **DNS via Cloudflare** → Netlify load balancer IP: **75.2.60.5**
- **Old server IP (DO NOT USE):** 46.62.157.83
- If a site is down with 521 error, check if A record still points to old server

### advancedmarketing.co - Primary Domain (9 subdomains)
| Subdomain | Netlify Site | Purpose |
|-----------|-------------|---------|
| advancedmarketing.co | advanced-marketing-main | Main agency site |
| hosting.advancedmarketing.co | hosting-manager-am | Hosting management dashboard |
| ads.advancedmarketing.co | ads-dashboard-am | Ads dashboard |
| upwork.advancedmarketing.co | joyful-bublanina-e23947 | Upwork job hunter |
| website.advancedmarketing.co | web-design-pages-am | Web design pages |
| stream.advancedmarketing.co | multistream-pro | Multistreaming platform |
| playbook.advancedmarketing.co | playbook-125m-sale | Sales playbook |
| leadforge.advancedmarketing.co | leadforge-saas | Lead generation SaaS |
| shopifycourse.advancedmarketing.co | shopify-branding-blueprint | Shopify course |
| shopify.advancedmarketing.co | shopifyadvancedmarketing | Shopify services |

### rootaccess.design (2 subdomains)
| Subdomain | Netlify Site |
|-----------|-------------|
| www.rootaccess.design | rootaccessdesign |
| start.rootaccess.design | gentle-banoffee-428f5b |

### Standalone Domains
| Domain | Netlify Site | Purpose |
|--------|-------------|---------|
| benjaminboyce.com | benjamin-boyce | Personal site |
| leadripper.com | leadripper | Lead gen (clone of leadforge) |
| bulkkratom.us | bulkkratom-store | Kratom e-commerce |
| foundersvietnam.com | foundersvietnam | Founders community Vietnam |
| upvotethat.com | reddittraffic | Reddit traffic/upvote service |
| coworkingatlas.com | coworkatlas | Coworking directory |
| coffeeclassdanang.com | coffee-class-danang | Coffee class in Danang |
| voicepitchpro.com | voicepitchpro | Voice pitch tool |
| fakestatement.com | fakestatement | Statement generator |
| onwardtravelticket.com | onward-travel-ticket | Onward travel tickets |
| invoicefree.xyz | invoiceyou | Free invoice tool |

---

## GitHub Repos (65 total)
Backed up to: `C:\Users\admin\Desktop\Github Repo Backup 2-18-2026\`

Key repos that map to live sites:
- leadforge-saas → leadforge.advancedmarketing.co
- lead-scraper → lead-scraper-dashboard.netlify.app
- upvotethatdev → upvotethatdev.netlify.app
- hosting-manager-dashboard → hosting.advancedmarketing.co
- multistream-pro → stream.advancedmarketing.co
- shopify-branding-blueprint → shopifycourse.advancedmarketing.co
- founders-club → foundersvietnam.com
- fb-group-poster → fb-group-poster.netlify.app
- funitize-landing → funitize-landing.netlify.app

---

## ClickUp Project Structure

### Client Projects (existing)
- Miami Divorce Attorney (6 tasks)
- Herban Bud (15 tasks)
- Dope Pros (2 tasks)
- New Harvest (2 tasks)
- Marta Mithras / yogaofemotions.com (7 tasks)

### Internal Operations (existing)
- Internal - Advanced Marketing Operations (24 tasks)
- Agent Registry - Complete Directory (25 tasks)
- Marketing & Advertising Campaigns (3 tasks)
- Generated Deliverables (1 task)

### Domain Projects (created 2/18/2026)
- advancedmarketing.co (Primary Domain) - Folder ID: 901812350636
  - Each subdomain has its own list
- rootaccess.design - Folder ID: 901812350637
- benjaminboyce.com - Folder ID: 901812350638
- leadripper.com - Folder ID: 901812350639
- bulkkratom.us - Folder ID: 901812350640
- foundersvietnam.com - Folder ID: 901812350641
- upvotethat.com - Folder ID: 901812350643
- coworkingatlas.com - Folder ID: 901812350644
- coffeeclassdanang.com - Folder ID: 901812350645
- voicepitchpro.com - Folder ID: 901812350647
- fakestatement.com - Folder ID: 901812350648
- onwardtravelticket.com - Folder ID: 901812350649
- invoicefree.xyz - Folder ID: 901812350651

---

## Infrastructure Notes

### Molt Bot 1
- Runs on Ben's Mac Mini
- Tasks TBD - will be assigned via ClickUp
- Future automation bot for recurring operations

### DNS Troubleshooting Checklist
1. Site returning 521? → A record likely points to old server (46.62.157.83)
2. Fix: Update A record to 75.2.60.5 via Cloudflare API
3. Site timing out? → Check if Cloudflare NS are properly set at registrar
4. SSL issues? → Cloudflare handles SSL termination (proxied mode)

### Key Patterns
- All new sites go to Netlify
- DNS always through Cloudflare
- A records → 75.2.60.5 (Netlify)
- CNAME www → apex domain
- CNAME * → apex domain (wildcard for all subdomains)
- foundersvietnam.com has email config (Resend/Amazon SES for transactional email)
