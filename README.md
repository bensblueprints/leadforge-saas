# LeadForge AI - Intelligent Lead Generation Platform

A powerful SaaS platform for scraping and managing business leads with GoHighLevel CRM integration, Resend email capabilities, and Airwallex payment processing.

## Live Demo

**Production URL:** https://leadforge-saas.netlify.app

## Features

### Core Functionality
- **Lead Scraping** - Generate leads from Google Maps by industry and city
- **Lead Management** - View, filter, and export all scraped leads
- **Multi-city Support** - Scrape multiple cities in a single operation
- **Industry Categories** - Support for 18+ business categories

### Integrations
- **GoHighLevel CRM** - Sync leads directly to your GHL account
- **Resend Email API** - Send email campaigns to your leads
- **Webhook Support** - Real-time notifications when leads are scraped
- **n8n Automation** - Optional workflow automation via n8n

### User Features
- **User Authentication** - Secure JWT-based auth system
- **Usage Tracking** - Monitor leads used vs. plan limits
- **Plan Management** - Free, Professional ($97/mo), Enterprise ($297/mo)
- **CSV Export** - Export all leads to CSV format

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Backend:** Netlify Functions (Node.js)
- **Database:** PostgreSQL (Neon)
- **Authentication:** JWT
- **Payments:** Airwallex
- **CRM:** GoHighLevel API
- **Email:** Resend API
- **Automation:** n8n (optional)
- **Hosting:** Netlify

## Project Structure

```
leadgen-saas/
├── index.html                    # Main application (SPA)
├── netlify/
│   └── functions/
│       ├── auth-login.js         # User login
│       ├── auth-register.js      # User registration
│       ├── get-stats.js          # Dashboard statistics
│       ├── get-leads.js          # Retrieve user leads
│       ├── get-settings.js       # Get user settings
│       ├── update-settings.js    # Save user settings
│       ├── trigger-scrape.js     # Start lead scraping
│       ├── scrape-callback.js    # n8n callback endpoint
│       ├── get-scraped-cities.js # Get scraped city history
│       ├── ghl-sync.js           # Sync leads to GoHighLevel
│       ├── create-checkout.js    # Airwallex payment checkout
│       ├── payment-webhook.js    # Payment confirmation webhook
│       └── setup-db.js           # Database schema setup
├── netlify.toml                  # Netlify configuration
├── package.json                  # Dependencies
└── README.md                     # This file
```

## Database Schema

### Tables

**lf_users**
- `id` - Primary key
- `email` - User email (unique)
- `password_hash` - Bcrypt hashed password
- `name` - Full name
- `company` - Company name
- `plan` - Subscription plan (free/professional/enterprise)
- `leads_used` - Monthly leads consumed
- `leads_limit` - Monthly leads allowed
- `created_at`, `updated_at` - Timestamps

**lf_user_settings**
- `id` - Primary key
- `user_id` - Foreign key to users
- `ghl_api_key` - GoHighLevel API key
- `ghl_location_id` - GHL Location ID
- `ghl_auto_sync` - Auto-sync toggle
- `ghl_pipeline_id` - Default pipeline for leads
- `resend_api_key` - Resend email API key
- `webhook_url` - Custom webhook URL
- `created_at`, `updated_at` - Timestamps

**lf_leads**
- `id` - Primary key
- `user_id` - Foreign key to users
- `business_name` - Business name
- `phone`, `email`, `address` - Contact info
- `city`, `state` - Location
- `industry` - Business category
- `website` - Business website
- `rating`, `reviews` - Google ratings
- `ghl_synced` - Sync status
- `ghl_contact_id` - GHL contact reference
- `created_at` - Timestamp

**lf_scraped_cities**
- `id` - Primary key
- `user_id` - Foreign key to users
- `city` - City name
- `industry` - Industry scraped
- `lead_count` - Number of leads found
- `scraped_at` - Timestamp

**lf_subscriptions**
- `id` - Primary key
- `user_id` - Foreign key to users (unique)
- `stripe_customer_id` - Payment intent ID
- `stripe_subscription_id` - Not used (Airwallex)
- `plan` - Current plan
- `status` - Subscription status
- `current_period_end` - Period end date
- `created_at`, `updated_at` - Timestamps

## Environment Variables

Required environment variables for Netlify:

```env
# Database
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# Authentication
JWT_SECRET=your-secure-jwt-secret

# Airwallex Payments
AIRWALLEX_CLIENT_ID=your-client-id
AIRWALLEX_API_KEY=your-api-key
AIRWALLEX_ENV=demo  # or production

# n8n Integration (optional)
N8N_WEBHOOK_URL=https://your-n8n.domain/webhook/leadforge-scrape

# Site URL
URL=https://leadforge-saas.netlify.app
```

## API Endpoints

### Authentication
- `POST /.netlify/functions/auth-register` - Create account
- `POST /.netlify/functions/auth-login` - Login

### Data
- `GET /.netlify/functions/get-stats` - Dashboard statistics
- `GET /.netlify/functions/get-leads` - Paginated leads list
- `GET /.netlify/functions/get-scraped-cities` - Scrape history
- `GET /.netlify/functions/get-settings` - User settings

### Actions
- `POST /.netlify/functions/trigger-scrape` - Start scraping
- `POST /.netlify/functions/ghl-sync` - Sync to GoHighLevel
- `POST /.netlify/functions/update-settings` - Save settings
- `POST /.netlify/functions/create-checkout` - Payment checkout

### Webhooks
- `POST /.netlify/functions/scrape-callback` - n8n results
- `POST /.netlify/functions/payment-webhook` - Payment confirmation

## Subscription Plans

| Plan | Price | Leads/Month | Features |
|------|-------|-------------|----------|
| Free | $0 | 50 | Basic scraping |
| Professional | $97 | 5,000 | Unlimited cities, GHL integration |
| Enterprise | $297 | Unlimited | API access, white-label exports |

## GoHighLevel Integration

### Setup
1. Go to Settings > GoHighLevel Integration
2. Enter your GHL API Key
3. Enter your Location ID
4. Enable Auto-sync (optional)

### Syncing Leads
- Manual: Click "Sync to GHL" on any lead list
- Automatic: Enable auto-sync in settings
- Bulk: Use "Sync All to GHL" on My Leads page

### Lead Mapping
- `business_name` → `firstName`, `lastName`, `companyName`
- `email` → `email`
- `phone` → `phone`
- `address` → `address1`
- `city`, `state` → `city`, `state`
- `industry` → Tags

## Resend Email Integration

### Setup
1. Go to Settings
2. Enter your Resend API Key
3. Save

### Features
- Email campaigns to scraped leads
- Delivery tracking
- Custom webhook notifications

## n8n Integration (Optional)

For real-time Google Maps scraping, you can connect an n8n instance:

### n8n Setup
1. Install n8n on your server
2. Create a workflow with HTTP trigger
3. Configure Google Maps scraping nodes
4. Set callback URL to LeadForge endpoint

### Workflow
1. LeadForge sends scrape request to n8n
2. n8n scrapes Google Maps
3. n8n sends results back via callback
4. LeadForge stores leads and updates UI

## Local Development

```bash
# Clone repository
git clone https://github.com/bensblueprints/leadgen-saas.git
cd leadgen-saas

# Install dependencies
npm install

# Install Netlify CLI
npm install -g netlify-cli

# Link to Netlify site
netlify link

# Start local dev server
netlify dev
```

## Deployment

```bash
# Deploy to production
netlify deploy --prod

# Deploy to preview
netlify deploy
```

## Database Setup

Run the setup endpoint to create tables:

```bash
curl https://leadforge-saas.netlify.app/.netlify/functions/setup-db
```

## Support

For issues and feature requests:
- Email: Ben@JustFeatured.com
- GitHub Issues: https://github.com/bensblueprints/leadgen-saas/issues

## License

MIT License - See LICENSE file for details.

---

Built with AI assistance by Claude Code
