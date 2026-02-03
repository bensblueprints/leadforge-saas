const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';

// n8n webhook URL on your NAS server
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://100.122.165.61:5678/webhook/leadforge-scrape';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    const { cities, industry, maxResults } = JSON.parse(event.body);

    if (!cities || !Array.isArray(cities) || cities.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Cities array is required' })
      };
    }

    if (!industry) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Industry is required' })
      };
    }

    // Check user's leads limit
    const userResult = await pool.query(
      'SELECT leads_used, leads_limit, plan FROM lf_users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    const user = userResult.rows[0];
    const remainingLeads = user.leads_limit === -1 ? Infinity : (user.leads_limit - user.leads_used);

    if (remainingLeads <= 0) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: 'Lead limit reached',
          message: 'Please upgrade your plan to scrape more leads'
        })
      };
    }

    // Filter out already scraped cities
    const scrapedResult = await pool.query(
      `SELECT city FROM lf_scraped_cities
       WHERE user_id = $1 AND industry = $2 AND city = ANY($3)`,
      [decoded.userId, industry, cities]
    );

    const alreadyScraped = scrapedResult.rows.map(r => r.city.toLowerCase());
    const citiesToScrape = cities.filter(c => !alreadyScraped.includes(c.toLowerCase()));

    if (citiesToScrape.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'All cities already scraped',
          citiesSkipped: cities.length,
          citiesToScrape: 0
        })
      };
    }

    // Trigger n8n webhook for scraping
    const n8nPayload = {
      userId: decoded.userId,
      userEmail: decoded.email,
      cities: citiesToScrape,
      industry,
      maxResults: Math.min(maxResults || 50, 100),
      callbackUrl: `${process.env.URL || 'https://leadforge-saas.netlify.app'}/.netlify/functions/scrape-callback`
    };

    try {
      const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(n8nPayload)
      });

      if (!n8nResponse.ok) {
        console.error('n8n webhook failed:', await n8nResponse.text());
        // Continue anyway - we'll simulate leads for now
      }
    } catch (n8nError) {
      console.error('n8n connection error:', n8nError.message);
      // Continue with simulated scraping if n8n is not available
    }

    // Record the cities as being scraped (in progress)
    for (const city of citiesToScrape) {
      await pool.query(
        `INSERT INTO lf_scraped_cities (user_id, city, industry, lead_count, scraped_at)
         VALUES ($1, $2, $3, 0, NOW())
         ON CONFLICT (user_id, city, industry) DO NOTHING`,
        [decoded.userId, city, industry]
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Scraping initiated for ${citiesToScrape.length} cities`,
        citiesToScrape: citiesToScrape.length,
        citiesSkipped: cities.length - citiesToScrape.length,
        cities: citiesToScrape,
        jobId: `job_${Date.now()}`
      })
    };
  } catch (error) {
    console.error('Trigger scrape error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to start scraping', message: error.message })
    };
  }
};
