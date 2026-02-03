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

  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
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

    // Create user_settings table for GHL configs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        ghl_api_key VARCHAR(255),
        ghl_location_id VARCHAR(255),
        ghl_auto_sync BOOLEAN DEFAULT false,
        ghl_pipeline_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);

    // Create leads table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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

    // Create scraped_cities table for tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_scraped_cities (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        city VARCHAR(255) NOT NULL,
        industry VARCHAR(100) NOT NULL,
        lead_count INTEGER DEFAULT 0,
        scraped_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, city, industry)
      )
    `);

    // Create subscriptions table for Stripe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        plan VARCHAR(50) DEFAULT 'free',
        status VARCHAR(50) DEFAULT 'active',
        current_period_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'All tables created successfully',
        tables: ['users', 'user_settings', 'leads', 'user_scraped_cities', 'subscriptions']
      })
    };
  } catch (error) {
    console.error('Database setup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Database setup failed', message: error.message })
    };
  }
};
