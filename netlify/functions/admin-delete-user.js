const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';

// Helper to verify admin
async function verifyAdmin(token) {
  if (!token) return null;

  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    const result = await pool.query(
      'SELECT id, email, is_admin FROM lf_users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return null;
    }

    return result.rows[0];
  } catch (e) {
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

  if (event.httpMethod !== 'DELETE' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const admin = await verifyAdmin(event.headers.authorization);
    if (!admin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { userId } = JSON.parse(event.body);

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'User ID is required' })
      };
    }

    // Check if user exists
    const userResult = await pool.query('SELECT id, email, is_admin FROM lf_users WHERE id = $1', [userId]);

    if (userResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    const targetUser = userResult.rows[0];

    // Prevent deleting self or other admins
    if (targetUser.id === admin.id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Cannot delete your own account' })
      };
    }

    if (targetUser.is_admin) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Cannot delete another admin account' })
      };
    }

    // Delete all user data in order (due to foreign key-like relationships)
    await pool.query('DELETE FROM lf_leads WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM lf_scraped_cities WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM lf_user_settings WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM lf_subscriptions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM lf_users WHERE id = $1', [userId]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `User ${targetUser.email} and all associated data have been deleted`
      })
    };
  } catch (error) {
    console.error('Admin delete user error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to delete user', message: error.message })
    };
  }
};
