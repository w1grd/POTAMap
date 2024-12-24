// Function to fetch and cache the list of parks
async function fetchAndCacheParks(apiUrl, cacheKey, cacheExpiryKey, cacheDuration) {
    const cachedData = localStorage.getItem(cacheKey);
    const cachedExpiry = localStorage.getItem(cacheExpiryKey);

    if (cachedData && cachedExpiry && Date.now() < parseInt(cachedExpiry, 10)) {
        console.log("Using cached park data.");
        return JSON.parse(cachedData);
    }

    try {
        console.log("Fetching fresh park data from API...");
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch park data: ${response.statusText}`);
        }

        const data = await response.json();

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
    const map = L.map("map").setView([lat, lng], 10);

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
// Function to get custom marker color based on activation count
function getMarkerColor(activations) {
    if (activations > 10) return "#ff6666"; // Light red
    if (activations > 0) return "#ffff00"; // Yellow
    return "#00ff00"; // Vivid green for exactly zero
}

// Function to display park data on the map
function displayParksOnMap(map, parks) {
    parks.forEach((park) => {
        const { name, id, latitude, longitude, activations } = park;

        if (latitude && longitude) {
            // Determine marker color based on activations
            const markerColor = getMarkerColor(activations);

            // Create a custom marker
            const customMarker = L.circleMarker([latitude, longitude], {
                radius: 8, // Marker size
                fillColor: markerColor, // Inner color
                color: "#000", // Border color (black for contrast)
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8,
            });

            // Add marker to the map with a popup and tooltip
            customMarker
                .addTo(map)
                .bindPopup(`<b>${name}</b><br>Identifier: ${id}<br>Activations: ${activations}`)
                .bindTooltip(`${id}: ${name} (${activations} activations)`, { direction: "top" });
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
        const parks = await fetchAndCacheParks(apiUrl, cacheKey, cacheExpiryKey, cacheDuration);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;

                const map = initializeMap(userLat, userLng);
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
