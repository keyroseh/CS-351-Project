// CS 351 — Web Development | Tracklist Project
// Frontend logic: Spotify OAuth, zip code lookup, Ticketmaster concert search, DOM rendering

/* TRACKLIST — script.js: Brain of the app. Handles Spotify OAuth, fetching top artists,
   geolocation, Ticketmaster concert search, DOM rendering, and favorites. */

/* Config: Spotify Client ID is safe to expose on the frontend. Secret stays on the backend. */
const SPOTIFY_CLIENT_ID    = 'your_spotify_client_id'; // replace with your actual client ID
const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:3000/callback';
const SCOPES               = 'user-top-read';
const API_BASE             = 'http://127.0.0.1:3000';

/* State: variables we need to remember across functions */
let accessToken  = null;
let topArtists   = [];
let userLocation = null;

/* DOM References: grabbed once at the top for performance */
const loginSection    = document.getElementById('login-section');
const appSection      = document.getElementById('app-section');
const loginBtn        = document.getElementById('login-btn');
const artistsGrid     = document.getElementById('artists-grid');
const concertsGrid    = document.getElementById('concerts-grid');
const locationStatus  = document.getElementById('location-status');
const loadingOverlay  = document.getElementById('loading-overlay');
const loadingMsg      = document.getElementById('loading-msg');
const radiusSlider    = document.getElementById('radius-slider');
const radiusLabel     = document.getElementById('radius-label');
const timeRangeSelect = document.getElementById('time-range-select');
const refreshBtn      = document.getElementById('refresh-btn');
const favCount        = document.getElementById('fav-count');
const zipPopup        = document.getElementById('zip-popup');
const logoutBtn       = document.getElementById('logout-btn');
const zipInput        = document.getElementById('zip-input');
const zipSubmitBtn    = document.getElementById('zip-submit-btn');
const zipError        = document.getElementById('zip-error');

/* Loading Overlay Helpers: showLoading(msg) displays the spinner, hideLoading() dismisses it. */
function showLoading(msg = 'Loading…') {
  loadingMsg.textContent = msg;
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

/* Spotify OAuth Step 1 — Redirect to Spotify: Builds the auth URL and sends the user to
   Spotify's login screen. Spotify redirects back with a one-time code in the URL. */
loginBtn.addEventListener('click', () => {
  const state = crypto.randomUUID();
  sessionStorage.setItem('spotify_oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     SPOTIFY_CLIENT_ID,
    scope:         SCOPES,
    redirect_uri:  SPOTIFY_REDIRECT_URI,
    state,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
});

/* Spotify OAuth Step 2 — Handle Callback: Reads the code from the URL, validates the state
   to prevent CSRF, then sends the code to our backend to exchange it for an access token. */
async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  const state  = params.get('state');

  if (!code) return false;

  if (state !== sessionStorage.getItem('spotify_oauth_state')) {
    alert('Security check failed. Please try logging in again.');
    return false;
  }

  showLoading('Connecting to Spotify…');

  try {
    const res  = await fetch(`${API_BASE}/auth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    accessToken = data.access_token;
    sessionStorage.setItem('spotify_access_token', accessToken);
    window.history.replaceState({}, document.title, '/');
    return true;

  } catch (err) {
    console.error('OAuth callback error:', err);
    hideLoading();
    alert('Login failed. Make sure the server is running and try again.');
    return false;
  }
}

/* Geolocation: Asks the browser for GPS coordinates. Returns a Promise resolving to { lat, lng }.
   The browser will prompt the user for permission the first time. */
function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(err)
    );
  });
}

/* Fetch Top Artists: Calls our backend /spotify/top-artists (which proxies to Spotify).
   Returns an array of artist objects based on the selected time range. */
async function fetchTopArtists() {
  const timeRange = timeRangeSelect.value;
  const res  = await fetch(`${API_BASE}/spotify/top-artists?time_range=${timeRange}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.items;
}

/* Fetch Concerts For One Artist: Calls our backend /concerts (which proxies to Ticketmaster).
   Returns upcoming events for that artist near the user's coordinates. */
async function fetchConcertsForArtist(artistName) {
  const radius = radiusSlider.value;
  const { lat, lng } = userLocation;
  const params = new URLSearchParams({ artist: artistName, lat, lng, radius });
  const res    = await fetch(`${API_BASE}/concerts?${params}`);
  const data   = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/* Render Artists: Takes Spotify artist objects and injects photo + name chips into the DOM. */
function renderArtists(artists) {
  artistsGrid.innerHTML = '';
  artists.forEach((artist, i) => {
    const imgUrl = artist.images?.[artist.images.length - 1]?.url
                ?? 'https://via.placeholder.com/26';
    const chip = document.createElement('div');
    chip.className = 'artist-chip';
    chip.style.animationDelay = `${i * 50}ms`;
    chip.innerHTML = `
      <img src="${imgUrl}" alt="${artist.name}" />
      <span>${artist.name}</span>
    `;
    artistsGrid.appendChild(chip);
  });
}

/* Render Concerts: Takes a deduplicated, sorted array of Ticketmaster events and builds
   concert cards in the DOM. Shows an empty state message if no results are found. */
function renderConcerts(events) {
  concertsGrid.innerHTML = '';

  if (events.length === 0) {
    concertsGrid.innerHTML = `
      <p class="empty-msg">
        No upcoming concerts found nearby.<br/>
        Try increasing the search radius or switching to "All time" taste.
      </p>
    `;
    return;
  }

  events.forEach((event, i) => {
    const venue     = event._embedded?.venues?.[0];
    const venueName = venue?.name ?? 'Venue TBD';
    const city      = venue?.city?.name ?? '';
    const date      = event.dates?.start?.localDate ?? null;
    const time      = event.dates?.start?.localTime ?? null;
    const imgUrl    = event.images?.find(img => img.ratio === '16_9')?.url
                   ?? event.images?.[0]?.url ?? '';
    const price     = event.priceRanges
      ? `$${Math.round(event.priceRanges[0].min)}–$${Math.round(event.priceRanges[0].max)}`
      : 'See site';

    const card = document.createElement('div');
    card.className = 'concert-card';
    card.style.animationDelay = `${i * 60}ms`;

    const favoriteData = JSON.stringify({
      id:    event.id,
      name:  event.name,
      date:  date,
      venue: venueName,
      url:   event.url,
    });

    card.innerHTML = `
      <div class="concert-img" style="background-image: url('${imgUrl}')" role="img" aria-label="${event.name}"></div>
      <div class="concert-info">
        <h3 class="concert-name">${event.name}</h3>
        <p class="concert-venue">${venueName}${city ? `, ${city}` : ''}</p>
        <div class="concert-meta">
          <span class="concert-date">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            ${date ? formatDate(date) : 'Date TBD'}${time ? ' · ' + formatTime(time) : ''}
          </span>
          <span class="concert-price">${price}</span>
        </div>
        <div class="concert-actions">
          <a href="${event.url}" target="_blank" rel="noopener" class="btn-tickets">Get Tickets</a>
          <button class="btn-fav" data-event='${favoriteData}'>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            Save
          </button>
        </div>
      </div>
    `;
    concertsGrid.appendChild(card);
  });

  document.querySelectorAll('.btn-fav').forEach(btn => {
    btn.addEventListener('click', async () => {
      const eventData = JSON.parse(btn.dataset.event);
      await saveFavorite(eventData);
      btn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        Saved
      `;
      btn.disabled = true;
    });
  });
}

/* Date & Time Formatters: Convert Ticketmaster's raw "2025-08-14" and "19:30:00" strings
   into readable formats like "Aug 14, 2025" and "7:30 PM". */
function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatTime(timeStr) {
  const [hourStr, min] = timeStr.split(':');
  const hour   = parseInt(hourStr, 10);
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${min} ${period}`;
}

/* Favorites: saveFavorite() POSTs an event to the backend (saved to data.json).
   refreshFavCount() GETs the current count and updates the header badge. */
async function saveFavorite(event) {
  try {
    await fetch(`${API_BASE}/favorites`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ event }),
    });
    await refreshFavCount();
  } catch (err) {
    console.error('Failed to save favorite:', err);
  }
}

async function refreshFavCount() {
  try {
    const res  = await fetch(`${API_BASE}/favorites`);
    const favs = await res.json();
    favCount.textContent = favs.length;
  } catch (err) {
    console.error('Failed to fetch favorites count:', err);
  }
}

/* Load Concerts: Fetches concerts for all top artists in parallel, deduplicates by event ID
   (same show can match multiple artists), sorts by date, then renders the cards. */
async function loadConcerts() {
  const radius = radiusSlider.value;
  showLoading(`Searching for concerts within ${radius} miles…`);

  try {
    const results = await Promise.allSettled(
      topArtists.map(artist => fetchConcertsForArtist(artist.name))
    );

    const seen   = new Set();
    const events = [];

    results.forEach(result => {
      if (result.status === 'fulfilled') {
        result.value.forEach(event => {
          if (!seen.has(event.id)) {
            seen.add(event.id);
            events.push(event);
          }
        });
      }
    });

    events.sort((a, b) => {
      const da = a.dates?.start?.localDate ?? '9999';
      const db = b.dates?.start?.localDate ?? '9999';
      return da.localeCompare(db);
    });

    renderConcerts(events);

  } catch (err) {
    console.error('Failed to load concerts:', err);
    concertsGrid.innerHTML = `<p class="empty-msg">Something went wrong. Is the server running?</p>`;
  } finally {
    hideLoading();
  }
}

/* Get Location From Zip: Shows a popup asking for zip code, converts it to lat/lng
   using the free Zippopotam.us API (no API key needed). */
function getLocationFromZip() {
  return new Promise((resolve) => {
    zipPopup.classList.remove('hidden');
    zipInput.focus();

    async function handleSubmit() {
      const zip = zipInput.value.trim();

      // Validate — must be exactly 5 digits
      if (!/^\d{5}$/.test(zip)) {
        zipError.classList.remove('hidden');
        return;
      }

      zipError.classList.add('hidden');
      zipSubmitBtn.textContent = 'Looking up…';
      zipSubmitBtn.disabled = true;

      try {
        // Zippopotam.us — free, no API key, returns lat/lng for US zip codes
        const res  = await fetch(`https://api.zippopotam.us/us/${zip}`);

        if (!res.ok) {
          throw new Error('Zip not found');
        }

        const data = await res.json();
        const lat  = parseFloat(data.places[0].latitude);
        const lng  = parseFloat(data.places[0].longitude);
        const city = `${data.places[0]['place name']}, ${data.places[0]['state abbreviation']}`;

        userLocation = { lat, lng };
        locationStatus.textContent = `${city}`;

        zipPopup.classList.add('hidden');
        resolve();

      } catch (err) {
        zipError.textContent = 'Zip code not found. Please try again.';
        zipError.classList.remove('hidden');
        zipSubmitBtn.textContent = 'Find Concerts';
        zipSubmitBtn.disabled = false;
      }
    }

    // Submit on button click or Enter key
    zipSubmitBtn.addEventListener('click', handleSubmit);
    zipInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSubmit();
    });
  });
}

/* Start App: Called once authenticated. Shows the app, gets location, fetches top artists,
   loads concerts, and updates the favorites badge. */
async function startApp() {
  loginSection.classList.add('hidden');
  appSection.classList.remove('hidden');

  // Show zip code popup to get user location
  hideLoading();
  await getLocationFromZip();

  showLoading('Fetching your top artists from Spotify…');
  try {
    topArtists = await fetchTopArtists();
    renderArtists(topArtists);
  } catch (err) {
    hideLoading();
    alert('Could not fetch your Spotify data: ' + err.message);
    return;
  }

  await loadConcerts();
  await refreshFavCount();
}

/* Controls — Radius Slider: Updates the label in real time as the user drags.
   The new value is applied to the next concert search when Refresh is hit. */
radiusSlider.addEventListener('input', () => {
  radiusLabel.textContent = `${radiusSlider.value} mi`;
});

/* Controls — Refresh Button: Re-fetches top artists and concerts using the current
   radius and time range settings. */
refreshBtn.addEventListener('click', async () => {
  if (!accessToken || !userLocation) return;
  showLoading('Refreshing…');
  try {
    topArtists = await fetchTopArtists();
    renderArtists(topArtists);
  } catch (err) {
    console.error('Refresh failed:', err);
  }
  await loadConcerts();
});

/* Logout: Clears the session token and reloads the page to show the login screen. */
logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem('spotify_access_token');
  sessionStorage.removeItem('spotify_oauth_state');
  window.location.href = '/';
});

/* Entry Point: Runs immediately on page load. Checks if the user is returning from Spotify's
   OAuth redirect, already has a session token, or needs to log in fresh. */
(async () => {
  const justLoggedIn = await handleOAuthCallback();

  if (!justLoggedIn) {
    const stored = sessionStorage.getItem('spotify_access_token');
    if (stored) accessToken = stored;
  }

  if (accessToken) {
    startApp();
  } else {
    loginSection.classList.remove('hidden');
    appSection.classList.add('hidden');
    hideLoading();
  }
})();
