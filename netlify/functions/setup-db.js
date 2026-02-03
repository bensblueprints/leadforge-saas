const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const results = [];

  try {
    // Create users table first (no foreign keys)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lf_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        company VARCHAR(255),
        plan VARCHAR(50) DEFAULT 'free',
        leads_used INTEGER DEFAULT 0,
        leads_limit INTEGER DEFAULT 50,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push('Created lf_users table');

    // Create settings table (no foreign keys, use user_id as index)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lf_user_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        ghl_api_key VARCHAR(255),
        ghl_location_id VARCHAR(255),
        ghl_auto_sync BOOLEAN DEFAULT false,
        ghl_pipeline_id VARCHAR(255),
        resend_api_key VARCHAR(255),
        webhook_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);
    results.push('Created lf_user_settings table');

    // Add resend_api_key column if it doesn't exist (migration)
    await pool.query(`
      ALTER TABLE lf_user_settings
      ADD COLUMN IF NOT EXISTS resend_api_key VARCHAR(255),
      ADD COLUMN IF NOT EXISTS webhook_url VARCHAR(500)
    `).catch(() => {});
    results.push('Migration: Added resend_api_key and webhook_url columns');

    // Add trial_ends_at column to lf_users (migration for free trial feature)
    await pool.query(`
      ALTER TABLE lf_users
      ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP
    `).catch(() => {});
    results.push('Migration: Added trial_ends_at column to lf_users');

    // Create leads table (no foreign keys)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lf_leads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        business_name VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(50),
        industry VARCHAR(100),
        website VARCHAR(255),
        rating DECIMAL(2,1),
        reviews INTEGER,
        ghl_synced BOOLEAN DEFAULT false,
        ghl_contact_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push('Created lf_leads table');

    // Create scraped cities table (no foreign keys)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lf_scraped_cities (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        city VARCHAR(255) NOT NULL,
        industry VARCHAR(100) NOT NULL,
        lead_count INTEGER DEFAULT 0,
        scraped_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, city, industry)
      )
    `);
    results.push('Created lf_scraped_cities table');

    // Create subscriptions table (no foreign keys)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lf_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        plan VARCHAR(50) DEFAULT 'free',
        status VARCHAR(50) DEFAULT 'active',
        current_period_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push('Created lf_subscriptions table');

    // Create indexes for better performance
    await pool.query('CREATE INDEX IF NOT EXISTS idx_lf_leads_user ON lf_leads(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_lf_settings_user ON lf_user_settings(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_lf_cities_user ON lf_scraped_cities(user_id)');
    results.push('Created indexes');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'All tables created successfully',
        results,
        tables: ['lf_users', 'lf_user_settings', 'lf_leads', 'lf_scraped_cities', 'lf_subscriptions']
      })
    };
  } catch (error) {
    console.error('Database setup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Database setup failed',
        message: error.message,
        results
      })
    };
  }
};
