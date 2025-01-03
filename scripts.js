// Initialize a global variable to store activations
let activations = [];

// Function to initialize the hamburger menu
function initializeMenu() {
    const menu = document.createElement('div');
    menu.id = 'hamburgerMenu';
    menu.innerHTML = `
        <div id="menuToggle">
            <input type="checkbox" id="menuCheckbox" />
            <span></span>
            <span></span>
            <span></span>
            <ul id="menu">
                <li><label for="fileUpload">Upload Activations File</label><input type="file" id="fileUpload" accept="application/json" /></li>
                <li><label><input type="checkbox" id="toggleActivations" /> Show My Activations</label></li>
            </ul>
        </div>
    `;
    document.body.appendChild(menu);

    // Add event listeners for the menu options
    document.getElementById('fileUpload').addEventListener('change', handleFileUpload);
    document.getElementById('toggleActivations').addEventListener('change', toggleActivations);
}

// Function to handle file upload
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            localStorage.setItem('activations', JSON.stringify(data));
            alert('Activations file uploaded successfully!');
        } catch (err) {
            alert('Invalid JSON file.');
        }
    };
    reader.readAsText(file);
}

// Function to fetch recent activations from the POTA.app API
async function fetchRecentActivations(callsign) {
    const url = `https://api.pota.app/profile/${callsign}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch recent activations: ${response.statusText}`);
        }

        const data = await response.json();
        return data.recent_activity?.activations || [];
    } catch (error) {
        console.error(error);
        alert('Error fetching recent activations.');
        return [];
    }
}

// Function to toggle the display of activations
async function toggleActivations(event) {
    const showActivations = event.target.checked;
    if (!showActivations) {
        // Hide activations
        displayParksOnMap(map, parks, []);
        return;
    }

    // Get activations from local storage
    let storedActivations = JSON.parse(localStorage.getItem('activations')) || [];

    // Prompt for callsign
    const callsign = prompt('Enter your callsign:');
    if (!callsign) {
        alert('Callsign is required to fetch recent activations.');
        event.target.checked = false;
        return;
    }

    // Fetch recent activations and merge with stored activations
    const recentActivations = await fetchRecentActivations(callsign);
    activations = [...storedActivations, ...recentActivations];

    // Highlight activations on the map
    const activatedReferences = activations.map((activation) => activation.reference);
    displayParksOnMap(map, parks, activatedReferences);
}

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

// Function to display parks on the map
function displayParksOnMap(map, parks, userActivatedReferences) {
    parks.forEach((park) => {
        const { name, reference, latitude, longitude, activations } = park;

        if (latitude && longitude) {
            const userActivated = userActivatedReferences.includes(reference); // Check if user activated this park
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

// Function to determine marker color
function getMarkerColor(activations, userActivated) {
    if (userActivated) return "#ffa500"; // Orange for user-activated parks
    if (activations > 10) return "#ff6666"; // Light red
    if (activations > 0) return "#90ee90"; // Light green
    return "#0000ff"; // Vivid blue
}

// Function to initialize the map and fetch parks
async function setupPOTAMap() {
    const apiUrl = 'https://api.pota.app/program/parks/US';
    const cacheKey = 'pota-parks';
    const cacheExpiryKey = `${cacheKey}-expiry`;
    const cacheDuration = 10 * 24 * 60 * 60 * 1000; // 10 days in milliseconds

    try {
        const parks = await fetchAndCacheParks(apiUrl, cacheKey, cacheExpiryKey, cacheDuration);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;

                map = initializeMap(userLat, userLng);

                // Initial display without user activations
                displayParksOnMap(map, parks, []);
            },
            (error) => {
                console.error('Error getting location:', error.message);
                alert('Unable to retrieve your location.');
            }
        );
    } catch (error) {
        console.error('Error setting up POTA map:', error.message);
    }
}

// Add CSS for the hamburger menu
const style = document.createElement('style');
style.innerHTML = `
    #hamburgerMenu {
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 1000;
    }

    #menuToggle {
        display: flex;
        flex-direction: column;
    }

    #menuToggle input[type="checkbox"] {
        display: none;
    }

    #menuToggle span {
        background: #333;
        height: 3px;
        margin: 5px 0;
        width: 25px;
    }

    #menu {
        display: none;
        list-style: none;
        padding: 10px;
        background: #fff;
        border: 1px solid #ccc;
        position: absolute;
        top: 30px;
        left: 0;
    }

    #menuToggle input[type="checkbox"]:checked ~ #menu {
        display: block;
    }
`;
document.head.appendChild(style);

// Initialize everything
initializeMenu();
setupPOTAMap();
