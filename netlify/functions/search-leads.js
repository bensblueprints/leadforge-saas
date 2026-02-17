const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch {
    return null;
  }
}

// Geocode address to lat/lng
async function geocodeLocation(location) {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.[0]) return null;
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng };
}

// Search Google Places by keyword + location + radius (meters)
// Uses Text Search with location biasing for flexible keyword search (e.g. "dentist")
async function searchPlaces(keyword, lat, lng, radiusMeters, maxResults = 60) {
  if (!GOOGLE_MAPS_API_KEY) return [];
  const leads = [];
  let nextPageToken = null;
  let pageCount = 0;
  const maxPages = Math.ceil(maxResults / 20);

  do {
    let url;
    if (nextPageToken) {
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(nextPageToken)}&key=${GOOGLE_MAPS_API_KEY}`;
    } else {
      const query = `${keyword}`;
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lng}&radius=${radiusMeters}&key=${GOOGLE_MAPS_API_KEY}`;
    }

    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') break;

    const places = data.results || [];
    for (const place of places) {
      if (leads.length >= maxResults) break;
      const loc = place.geometry?.location;
      leads.push({
        place_id: place.place_id || '',
        business_name: place.name || 'Unknown',
        address: place.formatted_address || '',
        lat: loc?.lat || null,
        lng: loc?.lng || null,
        rating: place.rating || 0,
        reviews: place.user_ratings_total || 0,
        website: null // Fetched in details if needed
      });
    }

    nextPageToken = data.next_page_token;
    pageCount++;
    if (nextPageToken && pageCount < maxPages) {
      await new Promise(r => setTimeout(r, 2000));
    }
  } while (nextPageToken && leads.length < maxResults && pageCount < maxPages);

  return leads;
}

// Enrich with phone, website from Place Details
async function enrichLead(placeId) {
  if (!GOOGLE_MAPS_API_KEY || !placeId) return {};
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return {};
  const data = await res.json();
  if (!data.result) return {};
  return {
    phone: data.result.formatted_phone_number || '',
    website: data.result.website || ''
  };
}

function extractState(address) {
  const m = address?.match(/,\s*([A-Z]{2})\s*\d{5}/);
  return m ? m[1] : '';
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
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    let keyword, location, radiusKm, maxResults, offset = 0, limit = 20;

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      keyword = body.keyword || body.industry;
      location = body.location;
      radiusKm = body.radiusKm ?? body.radius ?? 50;
      maxResults = body.maxResults || 60;
      offset = body.offset || 0;
      limit = body.limit || 20;
    } else {
      const params = event.queryStringParameters || {};
      keyword = params.keyword || params.industry;
      location = params.location;
      radiusKm = parseFloat(params.radiusKm || params.radius || 50);
      maxResults = parseInt(params.maxResults || 60);
      offset = parseInt(params.offset || 0);
      limit = parseInt(params.limit || 20);
    }

    if (!keyword || !location) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'keyword and location are required' })
      };
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({ error: 'Search not configured. Add GOOGLE_MAPS_API_KEY.' })
      };
    }

    const coords = await geocodeLocation(location);
    if (!coords) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Could not geocode location' })
      };
    }

    const radiusMeters = Math.round(radiusKm * 1000);
    const rawLeads = await searchPlaces(keyword, coords.lat, coords.lng, radiusMeters, maxResults);

    // Get user's existing leads by place_id to mark status
    const placeIds = rawLeads.map(l => l.place_id).filter(Boolean);
    let addedPlaceIds = new Set();
    if (placeIds.length > 0) {
      const existing = await pool.query(
        `SELECT place_id FROM lf_leads WHERE user_id = $1 AND place_id = ANY($2)`,
        [decoded.userId, placeIds]
      );
      addedPlaceIds = new Set(existing.rows.map(r => r.place_id));
    }

    const leads = rawLeads.map(l => ({
      ...l,
      status: addedPlaceIds.has(l.place_id) ? 'added' : 'not_added',
      website_status: l.website ? 'yes' : 'unknown'
    }));

    const total = leads.length;
    const paginated = leads.slice(offset, offset + limit);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        leads: paginated,
        total,
        limit,
        offset,
        location: { lat: coords.lat, lng: coords.lng }
      })
    };
  } catch (error) {
    console.error('Search leads error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Search failed', message: error.message })
    };
  }
};
