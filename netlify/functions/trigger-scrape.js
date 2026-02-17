const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';

// API Keys for real scraping
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const SERP_API_KEY = process.env.SERP_API_KEY;

// n8n webhook URL - must be publicly reachable from Netlify (no private IPs)
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

// Helper function to wait (for pagination token to become valid)
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to scrape real leads using Google Places API (Legacy - works with more API keys)
// Supports pagination to get more than 20 results (up to 60 per search)
async function scrapeWithGooglePlaces(industry, city, maxResults) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.log('No GOOGLE_MAPS_API_KEY configured');
    return null;
  }

  try {
    const query = `${industry} in ${city}`;
    console.log(`Searching Google Places API for: "${query}", requesting ${maxResults} results`);

    const leads = [];
    let nextPageToken = null;
    let pageCount = 0;
    const maxPages = Math.ceil((maxResults || 60) / 20); // Google returns max 20 per page, max 3 pages (60 total)

    do {
      // Build URL with or without page token
      let searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_MAPS_API_KEY}`;
      if (nextPageToken) {
        searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${nextPageToken}&key=${GOOGLE_MAPS_API_KEY}`;
      }

      const searchResponse = await fetch(searchUrl);

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        console.error('Google Places API error:', searchResponse.status, errorText);
        break;
      }

      const searchData = await searchResponse.json();

      if (searchData.status !== 'OK' && searchData.status !== 'ZERO_RESULTS') {
        console.error('Google Places API status:', searchData.status, searchData.error_message);
        break;
      }

      const places = searchData.results || [];
      console.log(`Page ${pageCount + 1}: Got ${places.length} results`);

      // Process each place and get details for phone numbers
      for (const place of places) {
        if (leads.length >= maxResults) break;

        try {
          // Get place details for phone number
          let phone = '';
          let website = '';

          if (place.place_id) {
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=formatted_phone_number,website&key=${GOOGLE_MAPS_API_KEY}`;
            const detailsResponse = await fetch(detailsUrl);

            if (detailsResponse.ok) {
              const detailsData = await detailsResponse.json();
              if (detailsData.result) {
                phone = detailsData.result.formatted_phone_number || '';
                website = detailsData.result.website || '';
              }
            }
          }

          const loc = place.geometry?.location;
          leads.push({
            business_name: place.name || 'Unknown Business',
            phone: phone,
            email: '',
            address: place.formatted_address || '',
            city: city.split(',')[0].trim(),
            state: extractState(place.formatted_address || ''),
            website: website,
            rating: place.rating || 0,
            reviews: place.user_ratings_total || 0,
            place_id: place.place_id || '',
            lat: loc?.lat ?? null,
            lng: loc?.lng ?? null
          });
        } catch (detailError) {
          console.error('Error processing place:', detailError.message);
          const loc = place.geometry?.location;
          leads.push({
            business_name: place.name || 'Unknown Business',
            phone: '',
            email: '',
            address: place.formatted_address || '',
            city: city.split(',')[0].trim(),
            state: extractState(place.formatted_address || ''),
            website: '',
            rating: place.rating || 0,
            reviews: place.user_ratings_total || 0,
            place_id: place.place_id || '',
            lat: loc?.lat ?? null,
            lng: loc?.lng ?? null
          });
        }
      }

      // Check for next page
      nextPageToken = searchData.next_page_token;
      pageCount++;

      // If there's a next page and we need more results, wait 2 seconds (Google requirement)
      if (nextPageToken && leads.length < maxResults && pageCount < maxPages) {
        console.log('Waiting for next page token to become valid...');
        await sleep(2000);
      }

    } while (nextPageToken && leads.length < maxResults && pageCount < maxPages);

    console.log(`Processed ${leads.length} total leads from Google Places (${pageCount} pages)`);
    return leads.length > 0 ? leads : null;
  } catch (error) {
    console.error('Google Places scrape error:', error.message);
    return null;
  }
}

// Function to scrape using SerpAPI (fallback)
async function scrapeWithSerpAPI(industry, city, maxResults) {
  if (!SERP_API_KEY) {
    console.log('No SERP_API_KEY configured');
    return null;
  }

  try {
    const query = `${industry} in ${city}`;
    const url = `https://serpapi.com/search.json?engine=google_maps&q=${encodeURIComponent(query)}&type=search&api_key=${SERP_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error('SerpAPI error:', await response.text());
      return null;
    }

    const data = await response.json();
    const places = data.local_results || [];

    return places.slice(0, maxResults).map(place => {
      const gps = place.gps_coordinates || {};
      const lat = gps.latitude ?? gps.lat ?? null;
      const lng = gps.longitude ?? gps.lng ?? null;
      return {
        business_name: place.title || 'Unknown Business',
        phone: place.phone || '',
        email: '',
        address: place.address || '',
        city: city.split(',')[0].trim(),
        state: extractState(place.address || ''),
        website: place.website || '',
        rating: place.rating || 0,
        reviews: place.reviews || 0,
        place_id: place.place_id || '',
        lat,
        lng
      };
    });
  } catch (error) {
    console.error('SerpAPI scrape error:', error.message);
    return null;
  }
}

// Main function to scrape real leads (tries Google first, then SerpAPI)
async function scrapeRealLeads(industry, city, maxResults) {
  // Try Google Places API first
  let leads = await scrapeWithGooglePlaces(industry, city, maxResults);
  if (leads && leads.length > 0) {
    console.log(`Got ${leads.length} leads from Google Places API`);
    return leads;
  }

  // Fallback to SerpAPI
  leads = await scrapeWithSerpAPI(industry, city, maxResults);
  if (leads && leads.length > 0) {
    console.log(`Got ${leads.length} leads from SerpAPI`);
    return leads;
  }

  return null;
}

function extractState(address) {
  const stateMatch = address.match(/,\s*([A-Z]{2})\s*\d{5}/);
  return stateMatch ? stateMatch[1] : '';
}

// Sanitize string for email/URL generation
function sanitizeForEmail(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

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

    // Prefer direct scraping when API keys are available (works from Netlify)
    // n8n only works if N8N_WEBHOOK_URL is a PUBLIC URL (Netlify cannot reach private IPs)
    const hasDirectScraping = !!(GOOGLE_MAPS_API_KEY || SERP_API_KEY);
    const hasPublicN8n = N8N_WEBHOOK_URL && !N8N_WEBHOOK_URL.match(/^(https?:\/\/)?(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9][0-9]|1[0-2][0-9])\.)/);

    let n8nSuccess = false;

    if (hasPublicN8n && !hasDirectScraping) {
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
        if (n8nResponse.ok) {
          n8nSuccess = true;
          console.log('n8n webhook triggered successfully');
        } else {
          console.error('n8n webhook failed:', await n8nResponse.text());
        }
      } catch (n8nError) {
        console.error('n8n connection error:', n8nError.message);
      }
    } else if (hasDirectScraping) {
      console.log('Using direct scraping (Google Places / SerpAPI)');
    } else if (!hasPublicN8n && N8N_WEBHOOK_URL) {
      console.log('N8N_WEBHOOK_URL is private/unreachable from Netlify - using fallback');
    }

    // If n8n didn't handle it, do direct scraping (real or demo)
    let totalLeadsGenerated = 0;
    let usedRealScraping = false;

    if (!n8nSuccess) {
      const scrapeMsg = hasDirectScraping ? 'Scraping with Google Places / SerpAPI...' : 'No API keys - generating demo leads...';
      console.log(scrapeMsg);

      for (const city of citiesToScrape) {
        let cityLeadCount = 0;

        // Try to get real leads (Google Places first, then SerpAPI)
        const realLeads = await scrapeRealLeads(industry, city, maxResults || 50);

        if (realLeads && realLeads.length > 0) {
          usedRealScraping = true;
          console.log(`Got ${realLeads.length} real leads for ${city}`);

          for (const lead of realLeads) {
            try {
              const existingLead = await pool.query(
                `SELECT id FROM lf_leads WHERE user_id = $1 AND business_name = $2 AND address = $3`,
                [decoded.userId, lead.business_name, lead.address]
              );

              if (existingLead.rows.length > 0) {
                console.log(`Skipping duplicate: ${lead.business_name}`);
                continue;
              }

              await pool.query(
                `INSERT INTO lf_leads (user_id, business_name, phone, email, address, city, state, industry, website, rating, reviews, place_id, lat, lng)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                [decoded.userId, lead.business_name, lead.phone, lead.email, lead.address, lead.city, lead.state, industry, lead.website, lead.rating, lead.reviews, lead.place_id || null, lead.lat ?? null, lead.lng ?? null]
              );
              cityLeadCount++;
              totalLeadsGenerated++;
            } catch (insertError) {
              if (!insertError.message.includes('duplicate')) {
                console.error('Failed to insert lead:', insertError.message);
              }
            }
          }
        } else {
          // Fallback to demo data (clearly marked as demo)
          console.log(`No API keys or API failed - generating demo leads for ${city}`);
          const numLeads = Math.min(maxResults || 50, 15);
          const sanitizedCity = sanitizeForEmail(city);
          const sanitizedIndustry = sanitizeForEmail(industry);

          for (let i = 0; i < numLeads; i++) {
            const leadData = {
              business_name: `[DEMO] ${industry} Business ${i + 1}`,
              phone: `(555) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
              email: `demo${i + 1}@example.com`,
              address: `${Math.floor(Math.random() * 9999) + 1} Demo Street`,
              city: city.split(',')[0].trim(),
              state: city.includes(',') ? city.split(',')[1].trim() : 'US',
              website: `https://demo-${sanitizedIndustry}-${i + 1}.example.com`,
              rating: (Math.random() * 2 + 3).toFixed(1),
              reviews: Math.floor(Math.random() * 100) + 1
            };

            try {
              await pool.query(
                `INSERT INTO lf_leads (user_id, business_name, phone, email, address, city, state, industry, website, rating, reviews, place_id, lat, lng)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, NULL, NULL)`,
                [decoded.userId, leadData.business_name, leadData.phone, leadData.email, leadData.address, leadData.city, leadData.state, industry, leadData.website, leadData.rating, leadData.reviews]
              );
              cityLeadCount++;
              totalLeadsGenerated++;
            } catch (insertError) {
              console.error('Failed to insert lead:', insertError.message);
            }
          }
        }

        // Record the city as scraped (use per-city count)
        await pool.query(
          `INSERT INTO lf_scraped_cities (user_id, city, industry, lead_count, scraped_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (user_id, city, industry) DO UPDATE SET lead_count = $4, scraped_at = NOW()`,
          [decoded.userId, city, industry, cityLeadCount]
        );
      }

      // Update user's leads_used count
      await pool.query(
        `UPDATE lf_users SET leads_used = leads_used + $1, updated_at = NOW() WHERE id = $2`,
        [totalLeadsGenerated, decoded.userId]
      );
    } else {
      // Record the cities as being scraped (in progress) - n8n will update counts later
      for (const city of citiesToScrape) {
        await pool.query(
          `INSERT INTO lf_scraped_cities (user_id, city, industry, lead_count, scraped_at)
           VALUES ($1, $2, $3, 0, NOW())
           ON CONFLICT (user_id, city, industry) DO NOTHING`,
          [decoded.userId, city, industry]
        );
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: n8nSuccess
          ? `Scraping initiated for ${citiesToScrape.length} cities`
          : usedRealScraping
            ? `Scraped ${totalLeadsGenerated} real leads from ${citiesToScrape.length} cities`
            : `Generated ${totalLeadsGenerated} demo leads for ${citiesToScrape.length} cities (Add SERP_API_KEY for real data)`,
        citiesToScrape: citiesToScrape.length,
        citiesSkipped: cities.length - citiesToScrape.length,
        cities: citiesToScrape,
        leadsGenerated: totalLeadsGenerated,
        realData: usedRealScraping,
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
