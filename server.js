// CS 351 — Web Development | Tracklist Project
// Backend server: handles Spotify OAuth, proxies API calls to Spotify and Ticketmaster,
// and manages saved favorites in data.json

require('dotenv').config();

const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const fs         = require('fs');
const fetch      = require('node-fetch');

const app = express();

const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI;
const TICKETMASTER_API_KEY  = process.env.TICKETMASTER_API_KEY;
const PORT                  = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('.'));

const DATA_FILE = './data.json';

/* Route 1: Spotify OAuth - Exchange code for access token */
app.post('/auth/token', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  const params = new URLSearchParams({
    grant_type:   'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
  });

  const credentials = Buffer
    .from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)
    .toString('base64');

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error_description || data.error });
    }

    res.json({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_in:    data.expires_in,
    });

  } catch (err) {
    console.error('Token exchange failed:', err);
    res.status(500).json({ error: 'Token exchange failed' });
  }
});

/* Route 2: Spotify - Get the user's top artists */
app.get('/spotify/top-artists', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const timeRange = req.query.time_range || 'long_term';

  try {
    const response = await fetch(
      `https://api.spotify.com/v1/me/top/artists?limit=10&time_range=${timeRange}`,
      { headers: { Authorization: authHeader } }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(data.error.status).json({ error: data.error.message });
    }

    res.json(data);

  } catch (err) {
    console.error('Spotify top artists error:', err);
    res.status(500).json({ error: 'Failed to fetch top artists from Spotify' });
  }
});

/* Route 3: Ticketmaster - Search for concerts near the user */
app.get('/concerts', async (req, res) => {
  const { artist, lat, lng, radius = 25 } = req.query;

  if (!artist || !lat || !lng) {
    return res.status(400).json({ error: 'Missing required params: artist, lat, lng' });
  }

  const params = new URLSearchParams({
    apikey:             TICKETMASTER_API_KEY,
    keyword:            artist,
    latlong:            `${lat},${lng}`,
    radius:             radius,
    unit:               'miles',
    classificationName: 'music',
    size:               5,
    sort:               'date,asc',
  });

  try {
    const response = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?${params}`
    );

    const data   = await response.json();
    const events = data._embedded?.events ?? [];
    res.json(events);

  } catch (err) {
    console.error('Ticketmaster error:', err);
    res.status(500).json({ error: 'Failed to fetch concerts from Ticketmaster' });
  }
});

/* Route 4: Favorites - Get all saved concerts */
app.get('/favorites', (req, res) => {
  try {
    const raw       = fs.readFileSync(DATA_FILE, 'utf8');
    const favorites = JSON.parse(raw);
    res.json(favorites);
  } catch (err) {
    res.json([]);
  }
});

/* Route 5: Favorites - Save a concert */
app.post('/favorites', (req, res) => {
  const { event } = req.body;

  if (!event || !event.id) {
    return res.status(400).json({ error: 'Missing event data' });
  }

  try {
    const raw          = fs.readFileSync(DATA_FILE, 'utf8');
    const favorites    = JSON.parse(raw);
    const alreadySaved = favorites.find(e => e.id === event.id);

    if (!alreadySaved) {
      favorites.push(event);
      fs.writeFileSync(DATA_FILE, JSON.stringify(favorites, null, 2));
    }

    res.json({ ok: true, total: favorites.length });

  } catch (err) {
    res.status(500).json({ error: 'Failed to save favorite' });
  }
});

/* Route 6: Favorites - Remove a saved concert */
app.delete('/favorites/:id', (req, res) => {
  try {
    const raw     = fs.readFileSync(DATA_FILE, 'utf8');
    const updated = JSON.parse(raw).filter(e => e.id !== req.params.id);
    fs.writeFileSync(DATA_FILE, JSON.stringify(updated, null, 2));
    res.json({ ok: true, total: updated.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

/* Catch Spotify OAuth callback and serve index.html */
app.get('/callback', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

/* Start the server */
app.listen(PORT, () => {
  console.log(`🎵 Tracklist server running at http://127.0.0.1:${PORT}`);
  console.log(`   Spotify redirect URI: ${SPOTIFY_REDIRECT_URI}`);
  console.log(`   Ticketmaster key loaded: ${TICKETMASTER_API_KEY ? '✅' : '❌ MISSING'}`);
});