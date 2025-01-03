// Initialize global variables
let activations = [];
let map; // Leaflet map instance
let parks = []; // Global variable to store parks data

// Function to initialize the hamburger menu
function initializeMenu() {
    const menu = document.createElement('div');
    menu.id = 'hamburgerMenu';
    menu.innerHTML = `
        <div id="menuToggle">
            <input type="checkbox" id="menuCheckbox" />
            <label for="menuCheckbox">
                <span></span>
                <span></span>
                <span></span>
            </label>
            <ul id="menu">
                <li>
                    <button id="updateActivations">Update Activations</button>
                </li>
                <li>
                    <label for="fileUpload">Upload Activations File</label>
                    <input type="file" id="fileUpload" accept="application/json" />
                </li>
                <li>
                    <label><input type="checkbox" id="toggleActivations" /> Show My Activations</label>
                </li>
            </ul>
        </div>
    `;
    document.body.appendChild(menu);

    // Add event listeners for the menu options
    document.getElementById('fileUpload').addEventListener('change', handleFileUpload);
    document.getElementById('toggleActivations').addEventListener('change', toggleActivations);
    document.getElementById('updateActivations').addEventListener('click', handleUpdateActivations);
}

// Function to handle updating activations via API
async function handleUpdateActivations() {
    const callsign = prompt('Enter your callsign:');
    if (!callsign) {
        alert('Callsign is required to update activations.');
        return;
    }

    try {
        const recentActivations = await fetchRecentActivations(callsign);
        console.log("Fetched Recent Activations:", recentActivations); // Debugging

        if (recentActivations.length === 0) {
            alert('No recent activations found for this callsign.');
            return;
        }

        // Retrieve existing activations from local storage
        let storedActivations = JSON.parse(localStorage.getItem('activations')) || [];

        // Create a map for quick lookup to avoid duplicates
        const activationMap = new Map();
        storedActivations.forEach(act => activationMap.set(act.reference, act));

        // Append new activations, avoiding duplicates
        recentActivations.forEach(act => {
            if (!activationMap.has(act.reference)) {
                activationMap.set(act.reference, act);
            }
        });

        // Update the global activations array and local storage
        activations = Array.from(activationMap.values());
        localStorage.setItem('activations', JSON.stringify(activations));

        alert('Activations updated successfully!');
        console.log("Updated Activations:", activations); // Debugging

        // Refresh the map to reflect updated activations
        refreshMapActivations();
    } catch (error) {
        console.error('Error updating activations:', error);
        alert('Failed to update activations.');
    }
}

// Function to handle file upload and append activations
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const newActivations = JSON.parse(e.target.result);
            console.log("Uploaded Activations:", newActivations); // Debugging

            if (!Array.isArray(newActivations)) {
                throw new Error('Uploaded JSON is not an array of activations.');
            }

            // Retrieve existing activations from local storage
            const storedActivations = JSON.parse(localStorage.getItem('activations')) || [];
            console.log("Stored Activations Before Upload:", storedActivations); // Debugging

            // Create a map for quick lookup to avoid duplicates
            const activationMap = new Map();
            storedActivations.forEach(act => activationMap.set(act.reference, act));

            // Append new activations, avoiding duplicates
            newActivations.forEach(act => {
                if (!activationMap.has(act.reference)) {
                    activationMap.set(act.reference, act);
                }
            });

            // Update the global activations array and local storage
            activations = Array.from(activationMap.values());
            localStorage.setItem('activations', JSON.stringify(activations));

            alert('Activations appended successfully!');
            console.log("Activations After Upload:", activations); // Debugging

            // Refresh the map to reflect new activations
            refreshMapActivations();
        } catch (err) {
            console.error('Error uploading activations:', err);
            alert('Invalid JSON file or incorrect data format.');
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
        console.log("API Response for Recent Activations:", data); // Debugging
        return data.recent_activity?.activations || [];
    } catch (error) {
        console.error(error);
        alert('Error fetching recent activations.');
        return [];
    }
}

// Function to toggle the display of user's activations
async function toggleActivations(event) {
    const showActivations = event.target.checked;
    if (!showActivations) {
        // Hide activations by refreshing the map without user activations
        refreshMapActivations();
        return;
    }

    // Get activations from local storage
    let storedActivations = JSON.parse(localStorage.getItem('activations')) || [];
    console.log("Stored Activations on Toggle:", storedActivations); // Debugging

    if (storedActivations.length === 0) {
        // Prompt for callsign if no activations are stored
        const callsign = prompt('Enter your callsign to fetch activations:');
        if (!callsign) {
            alert('Callsign is required to fetch activations.');
            event.target.checked = false;
            return;
        }

        // Fetch recent activations
        const recentActivations = await fetchRecentActivations(callsign);
        console.log("Recent Activations on Toggle:", recentActivations); // Debugging

        if (recentActivations.length === 0) {
            alert('No recent activations found for this callsign.');
            event.target.checked = false;
            return;
        }

        // Merge and deduplicate activations
        const activationMap = new Map();
        storedActivations.forEach(act => activationMap.set(act.reference, act));
        recentActivations.forEach(act => {
            if (!activationMap.has(act.reference)) {
                activationMap.set(act.reference, act);
            }
        });

        // Update the global activations array and local storage
        activations = Array.from(activationMap.values());
        localStorage.setItem('activations', JSON.stringify(activations));

        alert('Activations loaded successfully!');
        console.log("Activations After Toggle Fetch:", activations); // Debugging
    } else {
        // If activations are already loaded, ensure 'activations' variable is up to date
        activations = storedActivations;
    }

    // Highlight activations on the map
    const activatedReferences = activations.map((activation) => activation.reference);
    console.log("Activated References:", activatedReferences); // Debugging
    displayParksOnMap(map, parks, activatedReferences, map.activationsLayer);
}

// Function to refresh the map based on current activations
function refreshMapActivations() {
    // Clear existing markers or layers if necessary
    if (map.activationsLayer) {
        map.removeLayer(map.activationsLayer);
    }

    // Create a new layer group
    map.activationsLayer = L.layerGroup().addTo(map);
    console.log("Created activationsLayer"); // Debugging

    // Determine which activations to display
    let activatedReferences = [];
    const toggleCheckbox = document.getElementById('toggleActivations');
    if (toggleCheckbox && toggleCheckbox.checked) {
        activatedReferences = activations.map(act => act.reference);
    }
    console.log("Activated References in Refresh:", activatedReferences); // Debugging

    // Display parks with the current activations
    displayParksOnMap(map, parks, activatedReferences, map.activationsLayer);
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
        console.log("Fetched Park Data:", data); // Debugging

        // Assign parks as per data structure
        const formattedData = Array.isArray(data) ? data : (data.parks || []);
        console.log("Formatted Park Data:", formattedData); // Debugging

        // Store as an object with 'parks' array if necessary
        const storageData = Array.isArray(data) ? { parks: data } : data;
        localStorage.setItem(cacheKey, JSON.stringify(storageData));
        localStorage.setItem(cacheExpiryKey, (Date.now() + cacheDuration).toString());
        console.log("Park data fetched and cached successfully.");

        return storageData;
    } catch (error) {
        console.error("Error fetching park data:", error.message);
        throw error;
    }
}

// Function to initialize the map
function initializeMap(lat, lng) {
    const mapInstance = L.map("map").setView([lat, lng], 10);
    console.log("Initialized map at:", lat, lng); // Debugging

    // Add OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapInstance);

    // Add marker for user's location
    L.marker([lat, lng])
        .addTo(mapInstance)
        .bindPopup("Your Location")
        .openPopup();

    return mapInstance;
}

// Function to display parks on the map
function displayParksOnMap(map, parks, userActivatedReferences, layerGroup = map.activationsLayer) {
    console.log("Displaying parks on the map:", parks.length); // Debugging
    console.log("User Activated References:", userActivatedReferences); // Debugging

    parks.forEach((park) => {
        const { name, reference, latitude, longitude, activations } = park;

        if (latitude && longitude) {
            const userActivated = userActivatedReferences.includes(reference); // Check if user activated this park
            const markerColor = getMarkerColor(activations, userActivated);
            console.log(`Adding marker for: ${name} (${reference}) with color: ${markerColor}`); // Debugging

            // Create a custom marker
            const customMarker = L.circleMarker([latitude, longitude], {
                radius: 8, // Marker size
                fillColor: markerColor, // Inner color
                color: "#000", // Border color
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8,
            });

            // Add marker to the specified layer group
            customMarker
                .addTo(layerGroup)
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
        const parksData = await fetchAndCacheParks(apiUrl, cacheKey, cacheExpiryKey, cacheDuration);
        parks = Array.isArray(parksData) ? parksData : (parksData.parks || []);
        console.log("Parks Loaded:", parks); // Debugging

        // Initialize global activations from local storage
        activations = JSON.parse(localStorage.getItem('activations')) || [];
        console.log("Initial Activations:", activations); // Debugging

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;

                map = initializeMap(userLat, userLng);

                // Create a layer group for activations
                map.activationsLayer = L.layerGroup().addTo(map);
                console.log("Created activationsLayer"); // Debugging

                // Initial display with or without activations based on toggle state
                const toggleCheckbox = document.getElementById('toggleActivations');
                if (toggleCheckbox && toggleCheckbox.checked) {
                    const activatedReferences = activations.map(act => act.reference);
                    console.log("Initial Activated References:", activatedReferences); // Debugging
                    displayParksOnMap(map, parks, activatedReferences, map.activationsLayer);
                } else {
                    displayParksOnMap(map, parks, [], map.activationsLayer);
                }
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
    /* Hamburger Menu Container */
    #hamburgerMenu {
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 1000;
    }

    /* Menu Toggle */
    #menuToggle {
        display: flex;
        flex-direction: column;
        cursor: pointer;
        user-select: none;
    }

    /* Hide the checkbox */
    #menuToggle input[type="checkbox"] {
        display: none;
    }

    /* Hamburger Lines within Label */
    #menuToggle label span {
        background: #333;
        height: 3px;
        margin: 5px 0;
        width: 25px;
        transition: all 0.3s ease;
        display: block;
    }

    /* Menu Styling */
    #menu {
        display: none;
        list-style: none;
        padding: 10px;
        background: #fff;
        border: 1px solid #ccc;
        position: absolute;
        top: 35px;
        left: 0;
        width: 200px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    /* Show Menu When Checkbox is Checked */
    #menuToggle input[type="checkbox"]:checked ~ #menu {
        display: block;
    }

    /* Animate Hamburger to 'X' When Menu is Open */
    #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(1) {
        transform: translateY(8px) rotate(45deg);
    }

    #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(2) {
        opacity: 0;
    }

    #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(3) {
        transform: translateY(-8px) rotate(-45deg);
    }

    /* Style Menu Items */
    #menu li {
        margin: 10px 0;
    }

    #menu button,
    #menu label {
        cursor: pointer;
        background: none;
        border: none;
        font-size: 16px;
        width: 100%;
        text-align: left;
    }

    #menu input[type="file"] {
        display: block;
        margin-top: 5px;
    }
`;
document.head.appendChild(style);

// Initialize everything
initializeMenu();
setupPOTAMap();
