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

// n8n webhook URL on your NAS server
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://100.122.165.61:5678/webhook/leadforge-scrape';

// Function to scrape real leads using Google Places API (New - v2)
async function scrapeWithGooglePlaces(industry, city, maxResults) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.log('No GOOGLE_MAPS_API_KEY configured');
    return null;
  }

  try {
    const query = `${industry} in ${city}`;
    console.log(`Searching Google Places API for: "${query}"`);

    // Step 1: Text Search using new Places API (v2)
    const searchUrl = 'https://places.googleapis.com/v1/places:searchText';

    const searchResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.addressComponents'
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: Math.min(maxResults || 20, 20), // API max is 20 per request
        languageCode: 'en'
      })
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Google Places API error:', searchResponse.status, errorText);
      return null;
    }

    const searchData = await searchResponse.json();
    console.log(`Google Places returned ${searchData.places?.length || 0} results`);

    const places = searchData.places || [];
    const leads = [];

    // Step 2: Process each place (new API returns details in search response)
    for (const place of places.slice(0, maxResults)) {
      try {
        // Extract state from address components
        let state = '';
        if (place.addressComponents) {
          const stateComponent = place.addressComponents.find(
            c => c.types && c.types.includes('administrative_area_level_1')
          );
          if (stateComponent) {
            state = stateComponent.shortText || stateComponent.longText || '';
          }
        }

        // Fallback to extracting from formatted address
        if (!state) {
          state = extractState(place.formattedAddress || '');
        }

        leads.push({
          business_name: place.displayName?.text || 'Unknown Business',
          phone: place.nationalPhoneNumber || place.internationalPhoneNumber || '',
          email: '', // Google doesn't provide emails
          address: place.formattedAddress || '',
          city: city.split(',')[0].trim(),
          state: state,
          website: place.websiteUri || '',
          rating: place.rating || 0,
          reviews: place.userRatingCount || 0,
          place_id: place.id || '',
          google_maps_url: place.googleMapsUri || ''
        });
      } catch (detailError) {
        console.error('Error processing place:', detailError.message);
        // Still add basic info
        leads.push({
          business_name: place.displayName?.text || 'Unknown Business',
          phone: '',
          email: '',
          address: place.formattedAddress || '',
          city: city.split(',')[0].trim(),
          state: extractState(place.formattedAddress || ''),
          website: '',
          rating: place.rating || 0,
          reviews: place.userRatingCount || 0,
          place_id: place.id || ''
        });
      }
    }

    console.log(`Processed ${leads.length} leads from Google Places`);
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

    return places.slice(0, maxResults).map(place => ({
      business_name: place.title || 'Unknown Business',
      phone: place.phone || '',
      email: '',
      address: place.address || '',
      city: city.split(',')[0].trim(),
      state: extractState(place.address || ''),
      website: place.website || '',
      rating: place.rating || 0,
      reviews: place.reviews || 0,
      place_id: place.place_id || ''
    }));
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

    // Try n8n webhook first, fall back to direct generation
    const n8nPayload = {
      userId: decoded.userId,
      userEmail: decoded.email,
      cities: citiesToScrape,
      industry,
      maxResults: Math.min(maxResults || 50, 100),
      callbackUrl: `${process.env.URL || 'https://leadforge-saas.netlify.app'}/.netlify/functions/scrape-callback`
    };

    let n8nSuccess = false;
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

    // If n8n failed, try SerpAPI for real leads, then fallback to demo data
    let totalLeadsGenerated = 0;
    let usedRealScraping = false;

    if (!n8nSuccess) {
      console.log('n8n unavailable, trying SerpAPI for real leads...');

      for (const city of citiesToScrape) {
        // Try to get real leads from SerpAPI
        const realLeads = await scrapeRealLeads(industry, city, maxResults || 50);

        if (realLeads && realLeads.length > 0) {
          usedRealScraping = true;
          console.log(`Got ${realLeads.length} real leads for ${city}`);

          for (const lead of realLeads) {
            try {
              await pool.query(
                `INSERT INTO lf_leads (user_id, business_name, phone, email, address, city, state, industry, website, rating, reviews)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [decoded.userId, lead.business_name, lead.phone, lead.email, lead.address, lead.city, lead.state, industry, lead.website, lead.rating, lead.reviews]
              );
              totalLeadsGenerated++;
            } catch (insertError) {
              if (!insertError.message.includes('duplicate')) {
                console.error('Failed to insert lead:', insertError.message);
              }
            }
          }
        } else {
          // Fallback to demo data (clearly marked as demo)
          console.log(`No SerpAPI key or API failed, generating demo leads for ${city}`);
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
                `INSERT INTO lf_leads (user_id, business_name, phone, email, address, city, state, industry, website, rating, reviews)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [decoded.userId, leadData.business_name, leadData.phone, leadData.email, leadData.address, leadData.city, leadData.state, industry, leadData.website, leadData.rating, leadData.reviews]
              );
              totalLeadsGenerated++;
            } catch (insertError) {
              console.error('Failed to insert lead:', insertError.message);
            }
          }
        }

        // Record the city as scraped
        await pool.query(
          `INSERT INTO lf_scraped_cities (user_id, city, industry, lead_count, scraped_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (user_id, city, industry) DO UPDATE SET lead_count = $4, scraped_at = NOW()`,
          [decoded.userId, city, industry, totalLeadsGenerated]
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
