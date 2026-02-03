const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';

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

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    // Get user info
    const userResult = await pool.query(
      'SELECT id, email, name, company, plan, leads_used, leads_limit FROM users WHERE id = $1',
      [decoded.userId]
    );
    const user = userResult.rows[0];

    // Get total leads
    const leadsResult = await pool.query(
      'SELECT COUNT(*) as total FROM leads WHERE user_id = $1',
      [decoded.userId]
    );

    // Get synced leads
    const syncedResult = await pool.query(
      'SELECT COUNT(*) as synced FROM leads WHERE user_id = $1 AND ghl_synced = true',
      [decoded.userId]
    );

    // Get scraped cities count
    const citiesResult = await pool.query(
      'SELECT COUNT(DISTINCT city) as cities FROM user_scraped_cities WHERE user_id = $1',
      [decoded.userId]
    );

    // Get recent activity (last 7 days)
    const activityResult = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM leads WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY DATE(created_at) ORDER BY date DESC`,
      [decoded.userId]
    );

    // Get top industries
    const industriesResult = await pool.query(
      `SELECT industry, COUNT(*) as count
       FROM leads WHERE user_id = $1 AND industry IS NOT NULL AND industry != ''
       GROUP BY industry ORDER BY count DESC LIMIT 5`,
      [decoded.userId]
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          plan: user.plan,
          leadsUsed: user.leads_used,
          leadsLimit: user.leads_limit
        },
        stats: {
          totalLeads: parseInt(leadsResult.rows[0].total),
          syncedLeads: parseInt(syncedResult.rows[0].synced),
          citiesScraped: parseInt(citiesResult.rows[0].cities),
          leadsRemaining: user.leads_limit - user.leads_used
        },
        activity: activityResult.rows,
        topIndustries: industriesResult.rows
      })
    };
  } catch (error) {
    console.error('Get stats error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get stats', message: error.message })
    };
  }
};
