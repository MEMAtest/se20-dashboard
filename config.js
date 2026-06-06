// Penge Dash SE20 - Configuration
// ============================================
// ALL APIS ARE FREE FOR PERSONAL USE
// ============================================

const CONFIG = {
    // ============================================
    // 1. WEATHER (Open-Meteo) - NO KEY NEEDED!
    // ============================================
    // Using Open-Meteo: Completely free, no signup required
    // https://open-meteo.com/

    // ============================================
    // 2. TFL API (Buses + Overground)
    // ============================================
    // FREE: Unlimited (works without key, but key recommended)
    // Register: https://api-portal.tfl.gov.uk/
    // Steps:
    //   1. Register for account
    //   2. Go to "Products" > Subscribe to free tier
    //   3. Create an "App" to get keys
    TFL_APP_ID: 'unified',
    TFL_APP_KEY: '2d7d8f0982ad4f96a6041db81e8a4508',

    // ============================================
    // 3. DARWIN TRAIN API (Live National Rail data)
    // ============================================
    // Backend consuming Darwin Push Port (Kafka) for real-time departures
    DARWIN_API_URL: 'https://railway-tlmc.onrender.com',

    // ============================================
    // LOCATION SETTINGS (SE20 7UA - Penge)
    // ============================================
    // LOCATION is the legacy/default home. It is used as the first-run default
    // and as an offline fallback. The live "home" is now stored at runtime in
    // localStorage ('pengedash-home') and can be relocated to any postcode.
    LOCATION: {
        lat: 51.4178,
        lon: -0.0542,
        postcode: 'SE20 7UA'
    },

    // Default home (SE20) used when no saved home exists. isDefault enables the
    // Darwin National Rail backend (which only covers the SE20 stations below).
    DEFAULT_HOME: {
        lat: 51.4178,
        lon: -0.0542,
        postcode: 'SE20 7UA',
        label: 'Home (SE20)',
        isDefault: true
    },

    // Stations to monitor (CRS codes)
    STATIONS: {
        PENGE_WEST: 'PNW',      // Southern
        PENGE_EAST: 'PNE',      // Southeastern
        BIRKBECK: 'BKB',        // Tram
        ANERLEY: 'ANR'          // Overground
    },

    // Darwin backend only serves these SE20 CRS stations (real National Rail times)
    DARWIN_STATIONS: ['PNW', 'PNE', 'BKB', 'ANR'],

    // TfL Bus Stop IDs (NaPTAN codes for High Street / Maple Road)
    BUS_STOPS: [
        '490010905E',  // Stop E - towards Crystal Palace / Tottenham Court Rd
        '490010905D'   // Stop D - towards Penge / Beckenham
    ],

    // Postcode geocoding (free, no key, CORS-enabled)
    GEOCODE_URL: 'https://api.postcodes.io',

    // Nearby auto-detection radii (metres) + result caps
    NEARBY: {
        stationRadius: 1500,
        busRadius: 500,
        maxStations: 6,
        maxBusStops: 4
    },

    // Refresh intervals (in milliseconds)
    REFRESH_INTERVALS: {
        weather: 10 * 60 * 1000,    // 10 minutes
        trains: 60 * 1000,           // 1 minute
        buses: 30 * 1000,            // 30 seconds
        traffic: 5 * 60 * 1000       // 5 minutes
    },

    // ============================================
    // DEMO MODE
    // ============================================
    // Set to false once you've added your API keys
    USE_MOCK_DATA: false
};
