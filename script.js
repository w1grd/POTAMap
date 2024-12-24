// Function to fetch and cache the list of parks
async function fetchAndCacheParks(apiUrl, cacheKey, cacheExpiryKey, cacheDuration) {
    // Check if data is already cached and still valid
    const cachedData = localStorage.getItem(cacheKey);
    const cachedExpiry = localStorage.getItem(cacheExpiryKey);

    if (cachedData && cachedExpiry && Date.now() < parseInt(cachedExpiry, 10)) {
        console.log("Using cached park data.");
        return JSON.parse(cachedData);
    }

    // Fetch new data from the API
    try {
        console.log("Fetching fresh park data from API...");
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch park data: ${response.statusText}`);
        }

        const data = await response.json();

        // Cache the data and expiry timestamp
        localStorage.setItem(cacheKey, JSON.stringify(data));
        localStorage.setItem(cacheExpiryKey, (Date.now() + cacheDuration).toString());
        console.log("Park data fetched and cached successfully.");

        return data;
    } catch (error) {
        console.error("Error fetching park data:", error.message);
        throw error;
    }
}

// Function to initialize the map
function initializeMap(lat, lng) {
    const map = L.map("map").setView([lat, lng], 10); // Centered at user's location

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

// Function to display park data on the map
function displayParksOnMap(map, parks) {
    parks.forEach((park) => {
        const { name, reference, latitude, longitude } = park;

        if (latitude && longitude) {
            // Add marker for each park
            L.marker([latitude, longitude])
                .addTo(map)
                .bindPopup(`<b>${name}</b><br>Identifier: ${reference}`) // Popup with name and ID
                .bindTooltip(`${reference}: ${name}`, { direction: "top" }); // Tooltip with ID and name
        }
    });
}

// Setup function to initialize the map and fetch parks
async function setupPOTAMap() {
    const apiUrl = "https://api.pota.app/program/parks/US";
    const cacheKey = "pota-parks";
    const cacheExpiryKey = `${cacheKey}-expiry`;
    const cacheDuration = 10 * 24 * 60 * 60 * 1000; // 10 days in milliseconds

    try {
        // Fetch and cache the list of parks
        const parks = await fetchAndCacheParks(apiUrl, cacheKey, cacheExpiryKey, cacheDuration);

        // Use Geolocation API to get user's current position
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;

                // Initialize the map
                const map = initializeMap(userLat, userLng);

                // Display parks on the map
                displayParksOnMap(map, parks);
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
