// Function to fetch and cache POTA parks data for a given location
async function fetchPOTASites(loc, force = false) {
    // Validate the location
    const availableLocations = ["loc1", "loc2", "loc3"]; // Replace with actual location identifiers
    if (!availableLocations.includes(loc)) {
        throw new Error("Argument 'location' is invalid");
    }

    const url = `https://api.pota.app/location/parks/${loc}`;
    const cacheKey = `parks-${loc}`; // Cache key for localStorage
    const cacheExpiryKey = `${cacheKey}-expiry`; // Separate key to store expiry timestamp
    const cacheDuration = 24 * 60 * 60 * 1000; // Cache duration in milliseconds (e.g., 24 hours)

    // Check if data is cached and valid
    const cachedData = localStorage.getItem(cacheKey);
    const cachedExpiry = localStorage.getItem(cacheExpiryKey);

    if (!force && cachedData && cachedExpiry && Date.now() < parseInt(cachedExpiry, 10)) {
        console.log(`Using cached data for location '${loc}'.`);
        return JSON.parse(cachedData);
    }

    // Fetch new data if cache is invalid or forced
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch data from ${url}`);
        }
        const data = await response.json();

        // Save data and expiry to cache
        localStorage.setItem(cacheKey, JSON.stringify(data));
        localStorage.setItem(cacheExpiryKey, (Date.now() + cacheDuration).toString());
        console.log(`Data fetched and cached for location '${loc}'.`);

        return data;
    } catch (error) {
        console.error(`Error fetching data: ${error.message}`);
        throw error;
    }
}

// Function to initialize the map
function initializeMap(lat, lng) {
    const map = L.map("map").setView([lat, lng], 13);

    // Add OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Add marker for user's location
    L.marker([lat, lng])
        .addTo(map)
        .bindPopup("Your Location")
        .openPopup();

    return map;
}

// Function to display POTA locations on the map
function displayPOTASitesOnMap(map, sites) {
    if (!sites || sites.length === 0) {
        console.error("No POTA data available to display.");
        return;
    }

    // Add markers for POTA locations
    sites.forEach((site) => {
        L.marker([site.latitude, site.longitude])
            .addTo(map)
            .bindPopup(`<b>${site.name}</b><br>${site.description}`);
    });
}

// Setup function to initialize map and display POTA locations
async function setupPOTAMap() {
    try {
        // Use Geolocation API to get user's current position
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;

                // Initialize the map
                const map = initializeMap(userLat, userLng);

                // Fetch POTA sites for a specific location
                const loc = "loc1"; // Replace with desired location identifier
                const sites = await fetchPOTASites(loc);

                // Display POTA sites on the map
                displayPOTASitesOnMap(map, sites);
            },
            (error) => {
                console.error("Error getting location:", error.message);
                alert("Unable to retrieve your location.");
            }
        );
    } catch (error) {
        console.error("Error setting up POTA map:", error.message);
    }
}

// Run the setup function when the page loads
document.addEventListener("DOMContentLoaded", setupPOTAMap);
