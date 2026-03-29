const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve app
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// API: Search products (mock — replace with real APIs like Google Shopping, PriceAPI.io etc.)
app.get('/api/search', (req, res) => {
  const { q, limit = 10 } = req.query;
  if (!q) return res.json({ results: [] });

  // Mock response — in production connect to:
  // - PriceAPI.io ($29/mo)
  // - Google Shopping API
  // - Shopzilla API
  // - CamelCamelCamel API (Amazon)
  const mock = [
    { id: 1, name: q, store: 'Amazon', price: 99.99, was: 149.99, drop: 33, emoji: '📦' },
    { id: 2, name: q, store: 'eBay', price: 109.99, was: 149.99, drop: 27, emoji: '🏷️' },
    { id: 3, name: q, store: 'Walmart', price: 119.99, was: 149.99, drop: 20, emoji: '🛒' },
  ];
  res.json({ results: mock, total: mock.length, query: q });
});

// API: Price history
app.get('/api/price-history/:id', (req, res) => {
  const history = Array.from({length: 30}, (_, i) => ({
    date: new Date(Date.now() - (29-i)*24*60*60*1000).toISOString().split('T')[0],
    price: Math.floor(80 + Math.random() * 70)
  }));
  res.json({ history });
});

// API: Watchlist (in production use database)
const watchlist = {};
app.post('/api/watch', (req, res) => {
  const { userId, productId, targetPrice } = req.body;
  if (!watchlist[userId]) watchlist[userId] = [];
  watchlist[userId].push({ productId, targetPrice, createdAt: new Date() });
  res.json({ ok: true });
});

app.get('/api/watch/:userId', (req, res) => {
  res.json(watchlist[req.params.userId] || []);
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, app: 'PriceHunt' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PriceHunt running on port ${PORT}`));
