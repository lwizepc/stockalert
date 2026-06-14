const express = require('express');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = 'd8ljt21r01qnkjl72dugd8ljt21r01qnkjl72dv0';

// Map our symbols to Finnhub's symbol format
const FINNHUB_MAP = { BTC: 'BINANCE:BTCUSDT' };
const DEFAULT_SYMBOLS = ['AAPL','TSLA','GOOGL','MSFT','NVDA','META','BTC'];

let latestPrices = {};   // { SYMBOL: { price, time } }
let subscribed = new Set();
let finnhubWS = null;

function toFinnSymbol(sym) { return FINNHUB_MAP[sym] || sym; }
function fromFinnSymbol(finnSym) {
  return finnSym === 'BINANCE:BTCUSDT' ? 'BTC' : finnSym;
}

function connectFinnhub() {
  finnhubWS = new WebSocket(`wss://ws.finnhub.io?token=${API_KEY}`);

  finnhubWS.on('open', () => {
    console.log('Conectado a Finnhub OK');
    DEFAULT_SYMBOLS.forEach(subscribeFinnhub);
    subscribed.forEach(finnSym => {
      finnhubWS.send(JSON.stringify({ type: 'subscribe', symbol: finnSym }));
    });
  });

  finnhubWS.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'trade' && msg.data) {
        msg.data.forEach(t => {
          const sym = fromFinnSymbol(t.s);
          latestPrices[sym] = { price: t.p, time: t.t };
        });
      }
    } catch (e) {}
  });

  finnhubWS.on('close', () => {
    console.log('Finnhub desconectado, reintentando en 3s...');
    setTimeout(connectFinnhub, 3000);
  });

  finnhubWS.on('error', (e) => console.log('Finnhub error:', e.message));
}

function subscribeFinnhub(sym) {
  const finnSym = toFinnSymbol(sym);
  if (subscribed.has(finnSym)) return;
  subscribed.add(finnSym);
  if (finnhubWS && finnhubWS.readyState === WebSocket.OPEN) {
    finnhubWS.send(JSON.stringify({ type: 'subscribe', symbol: finnSym }));
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Current prices - the phone asks for this every few seconds
app.get('/api/prices', (req, res) => {
  res.json(latestPrices);
});

// Ask the server to start tracking a new symbol (e.g. when a new alarm is created)
app.post('/api/subscribe', (req, res) => {
  const { symbol } = req.body || {};
  if (symbol) subscribeFinnhub(symbol);
  res.json({ ok: true });
});

// Symbol search (proxied so the API key never reaches the browser)
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const r = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${API_KEY}`);
    const d = await r.json();
    res.json(d);
  } catch (e) {
    res.status(500).json({ error: 'search failed' });
  }
});

// Single quote lookup (used when picking a symbol, before live data arrives)
app.get('/api/quote', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    const finnSym = toFinnSymbol(symbol);
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${finnSym}&token=${API_KEY}`);
    const d = await r.json();
    if (d.c) {
      if (!latestPrices[symbol]) latestPrices[symbol] = { price: d.c, time: Date.now() };
      subscribeFinnhub(symbol);
    }
    res.json(d);
  } catch (e) {
    res.status(500).json({ error: 'quote failed' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`StockAlert corriendo en el puerto ${PORT}`));
connectFinnhub();
