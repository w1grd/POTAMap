// Function to fetch and cache park data
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
// Function to fetch user activations for a callsign
async function fetchUserActivations(callsign) {
    const url = `https://api.pota.app/profile/${callsign}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch activations for callsign ${callsign}: ${response.statusText}`);
        }
        const data = await response.json();

        // Extract the references from recent_activity.activations
        const activations = data.recent_activity?.activations || [];
        const activatedReferences = activations.map((activation) => activation.reference);
        console.log(`User ${callsign} has activated the following parks:`, activatedReferences);

        return activatedReferences; // List of activated park references
    } catch (error) {
        console.error("Error fetching activations:", error.message);
        return [];
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

// Function to determine marker color
function getMarkerColor(activations, userActivated) {
    if (userActivated) return "orange"; // User activated this park
    if (activations > 10) return "#ff6666"; // Light red
    if (activations > 0) return "#90ee90"; // Light green
    return "#0000ff"; // Vivid blue
}

// Function to display parks on the map
function displayParksOnMap(map, parks, userActivatedReferences) {
    parks.forEach((park) => {
        const { name, reference, latitude, longitude, activations } = park;

        if (latitude && longitude) {
            const userActivated = userActivatedReferences.includes(reference); // Check if user activated this park
            console.log(`Ref in displayParksOnMap: ${reference}`)
            const markerColor = getMarkerColor(activations, userActivated);

            // Create a custom marker
            const customMarker = L.circleMarker([latitude, longitude], {
                radius: 8, // Marker size
                fillColor: markerColor, // Inner color
                color: "#000", // Border color
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8,
            });

            // Add marker to the map with a popup and tooltip
            customMarker
                .addTo(map)
                .bindPopup(`<b>${name}</b><br>Identifier: ${reference}<br>Activations: ${activations}`)
                .bindTooltip(`${reference}: ${name} (${activations} activations)`, { direction: "top" });
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
            async (position) => {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;

                const map = initializeMap(userLat, userLng);

                // Ensure the Update Map button has an event listener
                const updateButton = document.getElementById("updateMap");
                if (updateButton) {
                    updateButton.addEventListener("click", async () => {
                        const callsignInput = document.getElementById("callsign");
                        const callsign = callsignInput ? callsignInput.value.trim() : "";
                        if (callsign) {
                            // Fetch user activations and update the map
                            const userActivatedReferences = await fetchUserActivations(callsign);
                            displayParksOnMap(map, parks, userActivatedReferences);
                        } else {
                            // Clear user-specific activations
                            displayParksOnMap(map, parks, []);
                        }
                    });
                } else {
                    console.error("Update Map button not found in the DOM.");
                }

                // Initial display without user activations
                displayParksOnMap(map, parks, []);
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
