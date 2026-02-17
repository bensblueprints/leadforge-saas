const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Shared secret for n8n callback authentication
const N8N_CALLBACK_SECRET = process.env.N8N_CALLBACK_SECRET || 'leadforge-n8n-secret';

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Callback-Secret',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Verify callback secret
  const callbackSecret = event.headers['x-callback-secret'];
  if (callbackSecret !== N8N_CALLBACK_SECRET) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Invalid callback secret' })
    };
  }

  try {
    const { userId, city, industry, leads } = JSON.parse(event.body);

    if (!userId || !city || !industry) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    let savedCount = 0;

    // Save leads to database
    if (leads && Array.isArray(leads)) {
      for (const lead of leads) {
        try {
          await pool.query(
            `INSERT INTO lf_leads (user_id, business_name, phone, email, address, city, state, industry, website, rating, reviews, place_id, lat, lng)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              userId,
              lead.business_name || lead.name,
              lead.phone,
              lead.email,
              lead.address,
              lead.city || city,
              lead.state,
              industry,
              lead.website,
              lead.rating,
              lead.reviews,
              lead.place_id || null,
              lead.lat ?? null,
              lead.lng ?? null
            ]
          );
          savedCount++;
        } catch (insertError) {
          console.error('Failed to insert lead:', insertError.message);
        }
      }
    }

    // Update scraped city with lead count
    await pool.query(
      `UPDATE lf_scraped_cities
       SET lead_count = $1, scraped_at = NOW()
       WHERE user_id = $2 AND city = $3 AND industry = $4`,
      [savedCount, userId, city, industry]
    );

    // Update user's leads_used count
    await pool.query(
      `UPDATE lf_users
       SET leads_used = leads_used + $1, updated_at = NOW()
       WHERE id = $2`,
      [savedCount, userId]
    );

    console.log(`Saved ${savedCount} leads for user ${userId} in ${city} (${industry})`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Saved ${savedCount} leads`,
        savedCount,
        city,
        industry
      })
    };
  } catch (error) {
    console.error('Scrape callback error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to process callback', message: error.message })
    };
  }
};
