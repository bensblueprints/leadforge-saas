const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2024';

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

// Email regex patterns
const emailPatterns = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi
];

// Common email patterns to try based on business name and domain
function generatePossibleEmails(businessName, domain) {
  const cleaned = businessName.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(' ')
    .filter(w => w.length > 2)
    .slice(0, 2);

  const possibleEmails = [
    `info@${domain}`,
    `contact@${domain}`,
    `hello@${domain}`,
    `sales@${domain}`,
    `support@${domain}`,
    `admin@${domain}`,
    `office@${domain}`
  ];

  if (cleaned.length > 0) {
    possibleEmails.push(`${cleaned[0]}@${domain}`);
  }

  return possibleEmails;
}

// Extract domain from URL
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Scrape website for email addresses
async function scrapeWebsiteForEmail(websiteUrl) {
  if (!websiteUrl) return null;

  try {
    // Ensure URL has protocol
    let url = websiteUrl;
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    console.log(`Scraping ${url} for emails...`);

    // Fetch the webpage
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 10000
    });

    if (!response.ok) {
      console.log(`Failed to fetch ${url}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const foundEmails = new Set();

    // Search for emails using patterns
    for (const pattern of emailPatterns) {
      const matches = html.match(pattern) || [];
      for (const match of matches) {
        const email = match.replace(/^mailto:/i, '').toLowerCase();
        // Filter out common false positives
        if (!email.includes('example.com') &&
            !email.includes('sentry.io') &&
            !email.includes('@2x') &&
            !email.includes('.png') &&
            !email.includes('.jpg') &&
            !email.includes('.gif') &&
            email.includes('@') &&
            email.includes('.')) {
          foundEmails.add(email);
        }
      }
    }

    // Try contact page if no email found
    if (foundEmails.size === 0) {
      const contactPages = ['/contact', '/contact-us', '/about', '/about-us'];
      for (const page of contactPages) {
        try {
          const contactUrl = new URL(page, url).href;
          const contactResponse = await fetch(contactUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml'
            },
            timeout: 5000
          });

          if (contactResponse.ok) {
            const contactHtml = await contactResponse.text();
            for (const pattern of emailPatterns) {
              const matches = contactHtml.match(pattern) || [];
              for (const match of matches) {
                const email = match.replace(/^mailto:/i, '').toLowerCase();
                if (!email.includes('example.com') &&
                    !email.includes('sentry.io') &&
                    email.includes('@') &&
                    email.includes('.')) {
                  foundEmails.add(email);
                }
              }
            }
          }

          if (foundEmails.size > 0) break;
        } catch (e) {
          // Continue to next page
        }
      }
    }

    // Return the first valid email found, preferring info@, contact@, etc.
    const emailArray = Array.from(foundEmails);
    const priorityPrefixes = ['info', 'contact', 'hello', 'sales', 'office'];

    for (const prefix of priorityPrefixes) {
      const priorityEmail = emailArray.find(e => e.startsWith(prefix + '@'));
      if (priorityEmail) return priorityEmail;
    }

    return emailArray[0] || null;
  } catch (error) {
    console.error(`Error scraping ${websiteUrl}:`, error.message);
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
    const { leadId } = JSON.parse(event.body);

    if (!leadId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Lead ID is required' })
      };
    }

    // Get the lead
    const leadResult = await pool.query(
      `SELECT id, business_name, website, email FROM lf_leads WHERE id = $1 AND user_id = $2`,
      [leadId, decoded.userId]
    );

    if (leadResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Lead not found' })
      };
    }

    const lead = leadResult.rows[0];

    // If lead already has email, return it
    if (lead.email && lead.email.length > 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          email: lead.email,
          source: 'cached',
          message: 'Email already exists for this lead'
        })
      };
    }

    // If no website, can't scrape
    if (!lead.website) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          email: null,
          message: 'No website available to scrape for email'
        })
      };
    }

    // Scrape the website for email
    const scrapedEmail = await scrapeWebsiteForEmail(lead.website);

    if (scrapedEmail) {
      // Update the lead with the found email
      await pool.query(
        `UPDATE lf_leads SET email = $1, updated_at = NOW() WHERE id = $2`,
        [scrapedEmail, leadId]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          email: scrapedEmail,
          source: 'scraped',
          message: 'Email found and saved'
        })
      };
    }

    // Try to generate possible emails based on domain
    const domain = extractDomain(lead.website);
    if (domain) {
      const possibleEmails = generatePossibleEmails(lead.business_name, domain);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          email: null,
          possibleEmails: possibleEmails.slice(0, 5),
          message: 'No email found on website. Here are some common patterns to try.'
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: false,
        email: null,
        message: 'Could not find email address'
      })
    };

  } catch (error) {
    console.error('Scrape email error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to scrape email', message: error.message })
    };
  }
};
