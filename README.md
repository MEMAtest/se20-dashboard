# Penge Dash SE20

A hyper-local "Zero-Click" dashboard for 21 SE20 7UA. Shows live train, bus, weather, and traffic data at a glance.

## Quick Start

1. Open `index.html` in your browser (or use a local server)
2. The dashboard loads with **demo data** by default
3. Press the refresh button to update

### Run locally with a server:
```bash
cd ~/Documents/se20-dashboard
python3 -m http.server 8080
# Then open http://localhost:8080
```

## Add to Home Screen (iPhone/Android)

1. Open the app in Safari (iPhone) or Chrome (Android)
2. Tap Share > "Add to Home Screen"
3. It will appear as an app on your home screen

## Setting Up Live Data

Edit `config.js` and set `USE_MOCK_DATA: false` after adding your API keys:

### 1. Weather (OpenWeatherMap) - FREE
1. Go to https://openweathermap.org/api
2. Sign up for a free account
3. Get your API key from the dashboard
4. Add to `config.js`:
   ```js
   OPENWEATHER_API_KEY: 'your-key-here',
   ```

### 2. Buses (TfL API) - FREE
The TfL API works without a key, but registering gives better rate limits:
1. Go to https://api-portal.tfl.gov.uk/
2. Register for free
3. Create an app to get App ID and Key
4. Add to `config.js`:
   ```js
   TFL_APP_ID: 'your-app-id',
   TFL_APP_KEY: 'your-app-key',
   ```

### 3. Trains (National Rail) - FREE
1. Go to https://realtime.nationalrail.co.uk/OpenLDBWSRegistration/
2. Register for a Darwin Web Service token
3. Add to `config.js`:
   ```js
   NATIONAL_RAIL_TOKEN: 'your-token-here',
   ```

**Note:** National Rail uses SOAP/XML which requires a server-side proxy. For client-only use, the app uses TfL data for Overground stations.

### 4. Traffic - (Optional, requires paid API)
Traffic data typically requires Google Maps Platform or TomTom API. For now, the dashboard shows placeholder traffic status.

## Project Structure

```
se20-dashboard/
├── index.html      # Main dashboard page
├── styles.css      # All styling
├── app.js          # Main application logic
├── config.js       # API keys and settings
├── manifest.json   # PWA manifest
├── sw.js           # Service worker (offline support)
├── icon.svg        # App icon source
└── README.md       # This file
```

## Stations Monitored

| Station | Code | Lines |
|---------|------|-------|
| Penge West | PNW | Southern |
| Penge East | PNE | Southeastern |
| Birkbeck | BKB | Tram, Overground |

## Bus Stops

The app monitors stops on Penge High Street (NaPTAN codes in config.js).

## Customization

### Change location
Edit `config.js`:
```js
LOCATION: {
    lat: YOUR_LAT,
    lon: YOUR_LON,
    postcode: 'YOUR POSTCODE'
}
```

### Change refresh intervals
```js
REFRESH_INTERVALS: {
    weather: 10 * 60 * 1000,  // 10 minutes
    trains: 60 * 1000,         // 1 minute
    buses: 30 * 1000,          // 30 seconds
}
```

## Hosting Options

### Option 1: Local only
Just open `index.html` from your files - works offline with demo data.

### Option 2: GitHub Pages (Free)
1. Push to a GitHub repo
2. Enable GitHub Pages in Settings
3. Access at `https://yourusername.github.io/se20-dashboard`

### Option 3: Vercel/Netlify (Free)
Drag and drop the folder to deploy instantly.

## License

Personal use. Built for SE20.
