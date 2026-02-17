const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';

// Database pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Middleware
app.use(express.json());
app.use(express.static('.'));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Auth middleware
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ========== AUTH ROUTES ==========
app.post('/api/auth-register', async (req, res) => {
  try {
    const { email, password, name, company } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const existingUser = await pool.query('SELECT id FROM lf_users WHERE email = $1', [email.toLowerCase()]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 3);
    const result = await pool.query(
      `INSERT INTO lf_users (email, password_hash, name, company, plan, leads_limit, trial_ends_at)
       VALUES ($1, $2, $3, $4, 'trial', 500, $5)
       RETURNING id, email, name, company, plan, leads_used, leads_limit, trial_ends_at, created_at`,
      [email.toLowerCase(), passwordHash, name || '', company || '', trialEnd]
    );
    const user = result.rows[0];
    await pool.query(`INSERT INTO lf_user_settings (user_id) VALUES ($1)`, [user.id]);
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, message: 'Account created successfully!', token, user });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed', message: error.message });
  }
});

app.post('/api/auth-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const result = await pool.query(
      `SELECT id, email, password_hash, name, company, plan, leads_used, leads_limit, trial_ends_at, created_at, is_admin
       FROM lf_users WHERE email = $1`, [email.toLowerCase()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const settingsResult = await pool.query(
      `SELECT ghl_api_key, ghl_location_id, ghl_auto_sync, ghl_pipeline_id, resend_api_key, webhook_url
       FROM lf_user_settings WHERE user_id = $1`, [user.id]
    );
    const settings = settingsResult.rows[0] || {};
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    const isTrialActive = user.plan === 'trial' && user.trial_ends_at && new Date(user.trial_ends_at) > new Date();
    const trialExpired = user.plan === 'trial' && user.trial_ends_at && new Date(user.trial_ends_at) <= new Date();
    let trialDaysRemaining = 0;
    if (isTrialActive && user.trial_ends_at) {
      trialDaysRemaining = Math.ceil((new Date(user.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24));
    }
    res.json({
      success: true,
      message: trialExpired ? 'Your free trial has expired. Please upgrade to continue.' : 'Login successful',
      token,
      user: { ...user, leadsLimit: trialExpired ? 0 : user.leads_limit, isTrialActive, trialExpired, trialDaysRemaining },
      settings: {
        ghlApiKey: settings.ghl_api_key ? '********' + settings.ghl_api_key.slice(-4) : null,
        ghlLocationId: settings.ghl_location_id,
        ghlAutoSync: settings.ghl_auto_sync,
        ghlPipelineId: settings.ghl_pipeline_id
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

// ========== SETUP DB ==========
app.get('/api/setup-db', async (req, res) => {
  const results = [];
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lf_users (
        id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255), company VARCHAR(255), plan VARCHAR(50) DEFAULT 'free',
        leads_used INTEGER DEFAULT 0, leads_limit INTEGER DEFAULT 50,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
        trial_ends_at TIMESTAMP, is_admin BOOLEAN DEFAULT false
      )
    `);
    results.push('Created lf_users table');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lf_user_settings (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, ghl_api_key VARCHAR(255),
        ghl_location_id VARCHAR(255), ghl_auto_sync BOOLEAN DEFAULT false, ghl_pipeline_id VARCHAR(255),
        resend_api_key VARCHAR(255), webhook_url VARCHAR(500), ghl_industry_pipelines TEXT, ghl_stage_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(user_id)
      )
    `);
    results.push('Created lf_user_settings table');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lf_leads (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, business_name VARCHAR(255), phone VARCHAR(50),
        email VARCHAR(255), address TEXT, city VARCHAR(100), state VARCHAR(50), industry VARCHAR(100),
        website VARCHAR(255), rating DECIMAL(2,1), reviews INTEGER, ghl_synced BOOLEAN DEFAULT false,
        ghl_contact_id VARCHAR(255), created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push('Created lf_leads table');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lf_scraped_cities (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, city VARCHAR(255) NOT NULL,
        industry VARCHAR(100) NOT NULL, lead_count INTEGER DEFAULT 0, scraped_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, city, industry)
      )
    `);
    results.push('Created lf_scraped_cities table');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lf_subscriptions (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE, stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255), plan VARCHAR(50) DEFAULT 'free', status VARCHAR(50) DEFAULT 'active',
        current_period_end TIMESTAMP, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push('Created lf_subscriptions table');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_lf_leads_user ON lf_leads(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_lf_settings_user ON lf_user_settings(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_lf_cities_user ON lf_scraped_cities(user_id)');
    results.push('Created indexes');
    res.json({ success: true, message: 'All tables created successfully', results });
  } catch (error) {
    console.error('Database setup error:', error);
    res.status(500).json({ error: 'Database setup failed', message: error.message, results });
  }
});

// ========== SETTINGS ROUTES ==========
app.get('/api/get-settings', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ghl_api_key, ghl_location_id, ghl_auto_sync, ghl_pipeline_id, 
              resend_api_key, webhook_url, ghl_industry_pipelines, ghl_stage_id
       FROM lf_user_settings WHERE user_id = $1`, [req.userId]
    );
    const settings = result.rows[0] || {};
    res.json({
      success: true,
      settings: {
        ghlApiKey: settings.ghl_api_key || '', ghlLocationId: settings.ghl_location_id || '',
        ghlAutoSync: settings.ghl_auto_sync || false, ghlPipelineId: settings.ghl_pipeline_id || '',
        resendApiKey: settings.resend_api_key || '', webhookUrl: settings.webhook_url || '',
        ghlIndustryPipelines: settings.ghl_industry_pipelines || '{}', ghlStageId: settings.ghl_stage_id || ''
      }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings', message: error.message });
  }
});

app.post('/api/update-settings', authMiddleware, async (req, res) => {
  try {
    const { ghlApiKey, ghlLocationId, ghlAutoSync, ghlPipelineId, resendApiKey, webhookUrl, ghlIndustryPipelines, ghlStageId } = req.body;
    await pool.query(
      `INSERT INTO lf_user_settings (user_id, ghl_api_key, ghl_location_id, ghl_auto_sync, ghl_pipeline_id, 
        resend_api_key, webhook_url, ghl_industry_pipelines, ghl_stage_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) DO UPDATE SET 
         ghl_api_key = EXCLUDED.ghl_api_key, ghl_location_id = EXCLUDED.ghl_location_id,
         ghl_auto_sync = EXCLUDED.ghl_auto_sync, ghl_pipeline_id = EXCLUDED.ghl_pipeline_id,
         resend_api_key = EXCLUDED.resend_api_key, webhook_url = EXCLUDED.webhook_url,
         ghl_industry_pipelines = EXCLUDED.ghl_industry_pipelines, ghl_stage_id = EXCLUDED.ghl_stage_id,
         updated_at = NOW()`,
      [req.userId, ghlApiKey, ghlLocationId, ghlAutoSync, ghlPipelineId, resendApiKey, webhookUrl, ghlIndustryPipelines, ghlStageId]
    );
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings', message: error.message });
  }
});

// ========== LEADS ROUTES ==========
app.get('/api/get-leads', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, business_name, phone, email, address, city, state, industry,
              website, rating, reviews, ghl_synced, ghl_contact_id, created_at
       FROM lf_leads WHERE user_id = $1 ORDER BY created_at DESC`, [req.userId]
    );
    res.json({ success: true, leads: result.rows });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ error: 'Failed to get leads', message: error.message });
  }
});

app.post('/api/save-leads', authMiddleware, async (req, res) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'No leads provided' });
    }
    const savedLeads = [];
    for (const lead of leads) {
      const result = await pool.query(
        `INSERT INTO lf_leads (user_id, business_name, phone, email, address, city, state, industry, website, rating, reviews)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT DO NOTHING RETURNING *`,
        [req.userId, lead.business_name, lead.phone, lead.email, lead.address, 
         lead.city, lead.state, lead.industry, lead.website, lead.rating, lead.reviews]
      );
      if (result.rows[0]) savedLeads.push(result.rows[0]);
    }
    await pool.query(`UPDATE lf_users SET leads_used = leads_used + $1 WHERE id = $2`, [savedLeads.length, req.userId]);
    res.json({ success: true, saved: savedLeads.length, leads: savedLeads });
  } catch (error) {
    console.error('Save leads error:', error);
    res.status(500).json({ error: 'Failed to save leads', message: error.message });
  }
});

// ========== STATS ROUTES ==========
app.get('/api/get-stats', authMiddleware, async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT leads_used, leads_limit, plan, trial_ends_at FROM lf_users WHERE id = $1`, [req.userId]
    );
    const leadsResult = await pool.query(`SELECT COUNT(*) as total FROM lf_leads WHERE user_id = $1`, [req.userId]);
    const citiesResult = await pool.query(`SELECT COUNT(DISTINCT city) as total FROM lf_scraped_cities WHERE user_id = $1`, [req.userId]);
    const user = userResult.rows[0] || {};
    res.json({
      success: true,
      stats: {
        leadsUsed: user.leads_used || 0, leadsLimit: user.leads_limit || 0,
        totalLeads: parseInt(leadsResult.rows[0]?.total || 0),
        citiesScraped: parseInt(citiesResult.rows[0]?.total || 0),
        plan: user.plan || 'free', trialEndsAt: user.trial_ends_at
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats', message: error.message });
  }
});

// ========== SCRAPED CITIES ROUTES ==========
app.get('/api/get-scraped-cities', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT city, industry, lead_count, scraped_at FROM lf_scraped_cities WHERE user_id = $1 ORDER BY scraped_at DESC`,
      [req.userId]
    );
    res.json({ success: true, cities: result.rows });
  } catch (error) {
    console.error('Get scraped cities error:', error);
    res.status(500).json({ error: 'Failed to get scraped cities', message: error.message });
  }
});

// ========== GHL ROUTES ==========
app.get('/api/ghl-pipelines', authMiddleware, async (req, res) => {
  try {
    const settingsResult = await pool.query(
      `SELECT ghl_api_key, ghl_location_id FROM lf_user_settings WHERE user_id = $1`, [req.userId]
    );
    const settings = settingsResult.rows[0] || {};
    const apiKey = settings.ghl_api_key || process.env.GHL_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'GoHighLevel API key not configured' });
    }
    const response = await fetch('https://rest.gohighlevel.com/v1/pipelines', {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28' }
    });
    if (!response.ok) throw new Error(`GHL API error: ${response.status}`);
    const data = await response.json();
    res.json({ success: true, pipelines: data.pipelines || [] });
  } catch (error) {
    console.error('GHL pipelines error:', error);
    res.status(500).json({ error: 'Failed to fetch pipelines', message: error.message });
  }
});

app.post('/api/ghl-sync', authMiddleware, async (req, res) => {
  try {
    const { leadIds, pipelineId, stageId } = req.body;
    const settingsResult = await pool.query(
      `SELECT ghl_api_key, ghl_location_id FROM lf_user_settings WHERE user_id = $1`, [req.userId]
    );
    const settings = settingsResult.rows[0] || {};
    const apiKey = settings.ghl_api_key || process.env.GHL_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'GoHighLevel API key not configured' });
    }
    const leadsResult = await pool.query(
      `SELECT * FROM lf_leads WHERE user_id = $1 AND id = ANY($2)`, [req.userId, leadIds]
    );
    const syncedLeads = [];
    for (const lead of leadsResult.rows) {
      try {
        const contactData = {
          firstName: lead.business_name?.split(' ')[0] || lead.business_name,
          lastName: lead.business_name?.split(' ').slice(1).join(' ') || '',
          email: lead.email, phone: lead.phone, address1: lead.address,
          city: lead.city, state: lead.state, website: lead.website, source: 'LeadForge AI'
        };
        const contactResponse = await fetch('https://rest.gohighlevel.com/v1/contacts', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Version': '2021-07-28' },
          body: JSON.stringify(contactData)
        });
        if (contactResponse.ok) {
          const contact = await contactResponse.json();
          if (pipelineId) {
            await fetch('https://rest.gohighlevel.com/v1/pipeline', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Version': '2021-07-28' },
              body: JSON.stringify({ contactId: contact.contact.id, pipelineId, stageId })
            });
          }
          await pool.query(`UPDATE lf_leads SET ghl_synced = true, ghl_contact_id = $1 WHERE id = $2`, [contact.contact.id, lead.id]);
          syncedLeads.push(lead.id);
        }
      } catch (syncError) {
        console.error('Sync error for lead:', lead.id, syncError);
      }
    }
    res.json({ success: true, synced: syncedLeads.length, leadIds: syncedLeads });
  } catch (error) {
    console.error('GHL sync error:', error);
    res.status(500).json({ error: 'Failed to sync leads', message: error.message });
  }
});

// ========== SCRAPE ROUTES ==========
app.post('/api/trigger-scrape', authMiddleware, async (req, res) => {
  try {
    const { city, industry } = req.body;
    if (!city || !industry) {
      return res.status(400).json({ error: 'City and industry are required' });
    }
    const userResult = await pool.query(
      `SELECT leads_used, leads_limit, plan, trial_ends_at FROM lf_users WHERE id = $1`, [req.userId]
    );
    const user = userResult.rows[0];
    const isTrialActive = user.plan === 'trial' && user.trial_ends_at && new Date(user.trial_ends_at) > new Date();
    if (user.leads_used >= user.leads_limit && !isTrialActive) {
      return res.status(403).json({ error: 'Lead limit reached. Please upgrade your plan.' });
    }
    await pool.query(
      `INSERT INTO lf_scraped_cities (user_id, city, industry, lead_count) VALUES ($1, $2, $3, 0)
       ON CONFLICT (user_id, city, industry) DO UPDATE SET scraped_at = NOW()`,
      [req.userId, city, industry]
    );
    res.json({ success: true, message: 'Scrape initiated', scrapeId: Date.now().toString(), city, industry });
  } catch (error) {
    console.error('Trigger scrape error:', error);
    res.status(500).json({ error: 'Failed to trigger scrape', message: error.message });
  }
});

app.post('/api/scrape-callback', async (req, res) => {
  try {
    const { leads, city, industry, userId } = req.body;
    if (!Array.isArray(leads)) {
      return res.status(400).json({ error: 'Invalid leads data' });
    }
    const savedLeads = [];
    for (const lead of leads) {
      const result = await pool.query(
        `INSERT INTO lf_leads (user_id, business_name, phone, email, address, city, state, industry, website, rating, reviews)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT DO NOTHING RETURNING id`,
        [userId, lead.business_name, lead.phone, lead.email, lead.address, 
         lead.city || city, lead.state, lead.industry || industry, lead.website, lead.rating, lead.reviews]
      );
      if (result.rows[0]) savedLeads.push(result.rows[0]);
    }
    await pool.query(`UPDATE lf_scraped_cities SET lead_count = $1 WHERE user_id = $2 AND city = $3 AND industry = $4`,
      [savedLeads.length, userId, city, industry]);
    await pool.query(`UPDATE lf_users SET leads_used = leads_used + $1 WHERE id = $2`, [savedLeads.length, userId]);
    res.json({ success: true, saved: savedLeads.length });
  } catch (error) {
    console.error('Scrape callback error:', error);
    res.status(500).json({ error: 'Failed to process scrape callback', message: error.message });
  }
});

// ========== CHECKOUT & PAYMENT ROUTES ==========
app.post('/api/create-checkout', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    res.json({ 
      success: true, message: 'Checkout created', plan,
      checkoutUrl: `${process.env.URL || 'https://leadforge.advancedmarketing.co'}/checkout.html?plan=${plan}`
    });
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout', message: error.message });
  }
});

app.post('/api/payment-webhook', async (req, res) => {
  try {
    const { userId, plan, status } = req.body;
    if (status === 'success') {
      await pool.query(
        `UPDATE lf_users SET plan = $1, leads_limit = CASE 
          WHEN $1 = 'starter' THEN 1000 WHEN $1 = 'growth' THEN 5000 WHEN $1 = 'scale' THEN 20000 ELSE leads_limit END
         WHERE id = $2`, [plan, userId]
      );
      await pool.query(
        `INSERT INTO lf_subscriptions (user_id, plan, status) VALUES ($1, $2, 'active')
         ON CONFLICT (user_id) DO UPDATE SET plan = $2, status = 'active', updated_at = NOW()`,
        [userId, plan]
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Payment webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ========== ADMIN ROUTES ==========
app.get('/api/admin-get-users', authMiddleware, async (req, res) => {
  try {
    const adminCheck = await pool.query('SELECT is_admin FROM lf_users WHERE id = $1', [req.userId]);
    if (!adminCheck.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.company, u.plan, u.leads_used, u.leads_limit, 
              u.created_at, u.is_admin, u.trial_ends_at, s.ghl_api_key, s.ghl_location_id
       FROM lf_users u LEFT JOIN lf_user_settings s ON u.id = s.user_id ORDER BY u.created_at DESC`
    );
    res.json({ success: true, users: result.rows });
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ error: 'Failed to get users', message: error.message });
  }
});

app.post('/api/admin-delete-user', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;
    const adminCheck = await pool.query('SELECT is_admin FROM lf_users WHERE id = $1', [req.userId]);
    if (!adminCheck.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    await pool.query('DELETE FROM lf_leads WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM lf_user_settings WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM lf_scraped_cities WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM lf_subscriptions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM lf_users WHERE id = $1', [userId]);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user', message: error.message });
  }
});

app.post('/api/admin-update-subscription', authMiddleware, async (req, res) => {
  try {
    const { userId, plan, leadsLimit } = req.body;
    const adminCheck = await pool.query('SELECT is_admin FROM lf_users WHERE id = $1', [req.userId]);
    if (!adminCheck.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    await pool.query(`UPDATE lf_users SET plan = $1, leads_limit = $2 WHERE id = $3`, [plan, leadsLimit, userId]);
    res.json({ success: true, message: 'Subscription updated successfully' });
  } catch (error) {
    console.error('Admin update subscription error:', error);
    res.status(500).json({ error: 'Failed to update subscription', message: error.message });
  }
});

// ========== SERVE FRONTEND ==========
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`LeadForge server running on port ${PORT}`);
});
