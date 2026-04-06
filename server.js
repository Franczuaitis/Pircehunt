const express = require('express');
const https = require('https');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const SERP_KEY = process.env.SERP_API_KEY;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_KEY;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.slice(0, 100))); }
      });
    }).on('error', reject);
  });
}

function supaFetch(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const fullUrl = SUPA_URL + endpoint;
    const parsed = new URL(fullUrl);
    const reqOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY,
        'Content-Type': 'application/json',
        'Prefer': options.prefer || 'return=minimal',
        ...(options.headers || {}),
      },
    };
    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log('[SUPA]', options.method || 'GET', endpoint.slice(0, 60), '->', res.statusCode);
        try { resolve(data ? JSON.parse(data) : {}); }
        catch(e) { resolve({}); }
      });
    });
    req.on('error', (e) => { console.error('[SUPA] Error:', e.message); reject(e); });
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function serpSearch(query, extra = {}) {
  const params = new URLSearchParams({
    engine: 'google_shopping',
    q: query,
    gl: 'us',
    hl: 'en',
    num: 20,
    api_key: SERP_KEY,
    ...extra,
  });
  return httpGet('https://serpapi.com/search.json?' + params.toString());
}

// Wyciąga link z produktu SerpApi - używa product_link lub link
function getLink(item) {
  return item.product_link || item.link || null;
}

const SCAN_QUERIES = [
  { query: 'electronics deals discount', cat: 'electronics' },
  { query: 'nike adidas shoes sale', cat: 'fashion' },
  { query: 'home kitchen gadgets sale', cat: 'home' },
  { query: 'gaming console sale', cat: 'gaming' },
  { query: 'sports equipment discount', cat: 'sports' },
  { query: 'beauty skincare sale', cat: 'beauty' },
  { query: 'books bestseller deals', cat: 'books' },
];

async function scanAndSave() {
  console.log('[SCAN] Starting deals scan...');
  if (!SERP_KEY || !SUPA_URL || !SUPA_KEY) {
    console.log('[SCAN] Missing API keys');
    return;
  }

  for (const { query, cat } of SCAN_QUERIES) {
    try {
      console.log('[SCAN] Scanning:', query);
      const data = await serpSearch(query);
      const raw = data.shopping_results || [];
      console.log('[SCAN] Raw results:', raw.length, 'for', cat);

      const items = raw
        .filter(item => getLink(item) && item.price)
        .map(item => ({
          name: item.title,
          store: item.source,
          price: parseFloat((item.price || '').replace(/[^0-9.]/g, '')) || 0,
          image: item.thumbnail || null,
          link: getLink(item),
          rating: item.rating ? parseFloat(item.rating) : null,
          category: cat,
          tag: item.tag || (item.extensions ? item.extensions.find(e => e.includes('OFF')) : null) || null,
          found_at: new Date().toISOString(),
        }))
        .filter(i => i.price > 0)
        .slice(0, 10);

      console.log('[SCAN] Valid items:', items.length, 'for', cat);

      if (items.length > 0) {
        const result = await supaFetch('/rest/v1/deals', {
          method: 'POST',
          body: items,
          prefer: 'return=representation',
        });
        console.log('[SCAN] Saved:', cat, Array.isArray(result) ? result.length + ' items' : JSON.stringify(result).slice(0, 100));
      }

      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error('[SCAN] Error for', cat, ':', err.message);
    }
  }
  console.log('[SCAN] Done.');
}

const SIX_HOURS = 6 * 60 * 60 * 1000;
scanAndSave();
setInterval(scanAndSave, SIX_HOURS);

app.get('/api/deals', async (req, res) => {
  const cat = req.query.cat || 'all';
  try {
    let endpoint = '/rest/v1/deals?select=*&order=found_at.desc&limit=20';
    if (cat !== 'all') endpoint += '&category=eq.' + cat;
    const data = await supaFetch(endpoint);
    res.json({ results: Array.isArray(data) ? data : [] });
  } catch (err) {
    console.error('Deals error:', err.message);
    res.json({ results: [] });
  }
});

app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ results: [] });
  try {
    const data = await serpSearch(q);
    const results = (data.shopping_results || [])
      .filter(item => getLink(item) && item.price)
      .map((item, i) => ({
        id: i,
        name: item.title,
        store: item.source,
        price: parseFloat((item.price || '').replace(/[^0-9.]/g, '')) || 0,
        image: item.thumbnail || null,
        link: getLink(item),
        rating: item.rating ? parseFloat(item.rating) : null,
        tag: item.tag || null,
      }))
      .filter(r => r.price > 0);
    res.json({ results });
  } catch (err) {
    console.error('Search error:', err.message);
    res.json({ results: [], error: 'Search failed' });
  }
});

app.get('/api/compare', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ stores: [] });
  try {
    const data = await serpSearch(q, { num: 10 });
    const stores = (data.shopping_results || [])
      .filter(item => getLink(item) && item.price)
      .map(item => ({
        name: item.source,
        price: parseFloat((item.price || '').replace(/[^0-9.]/g, '')) || 0,
        link: getLink(item),
        shipping: item.delivery || 'Check store',
        rating: item.rating ? parseFloat(item.rating) : null,
        image: item.thumbnail || null,
      }))
      .filter(r => r.price > 0)
      .sort((a, b) => a.price - b.price)
      .slice(0, 5);
    if (stores.length > 0) stores[0].best = true;
    res.json({ stores });
  } catch (err) {
    console.error('Compare error:', err.message);
    res.json({ stores: [], error: 'Compare failed' });
  }
});

app.get('/health', (req, res) => res.json({
  ok: true,
  app: 'PriceHunt',
  serp: !!SERP_KEY,
  supabase: !!SUPA_URL,
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('PriceHunt running on port', PORT));
