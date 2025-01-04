// Initialize global variables
let activations = [];
let map; // Leaflet map instance
let parks = []; // Global variable to store parks data

/**
 * Ensures that the DOM is fully loaded before executing scripts.
 */
document.addEventListener('DOMContentLoaded', () => {
    initializeMenu();
    setupPOTAMap();
});

/**
 * Initializes the hamburger menu.
 */
function initializeMenu() {
    const menu = document.createElement('div');
    menu.id = 'hamburgerMenu';
    menu.innerHTML = `
        <div id="menuToggle">
            <input type="checkbox" id="menuCheckbox" />
            <label for="menuCheckbox" aria-label="Toggle Menu">
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
    console.log("Hamburger menu initialized."); // Debugging
}

/**
 * Initializes and returns the IndexedDB database.
 * @returns {Promise<IDBDatabase>} The IndexedDB database instance.
 */
async function getDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('potaDatabase', 2); // Increment version if adding new object stores

        request.onupgradeneeded = function(event) {
            const db = event.target.result;

            // Create object store for activations if it doesn't exist
            if (!db.objectStoreNames.contains('activations')) {
                db.createObjectStore('activations', { keyPath: 'reference' });
            }

            // Create object store for parks if it doesn't exist
            if (!db.objectStoreNames.contains('parks')) {
                db.createObjectStore('parks', { keyPath: 'reference' });
            }
        };

        request.onsuccess = function(event) {
            resolve(event.target.result);
        };

        request.onerror = function(event) {
            console.error('Error opening IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Retrieves all activations from IndexedDB.
 * @returns {Promise<Array>} Array of activation objects.
 */
async function getActivationsFromIndexedDB() {
    const db = await getDatabase();
    const transaction = db.transaction('activations', 'readonly');
    const store = transaction.objectStore('activations');
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject('Error retrieving activations from IndexedDB');
    });
}

/**
 * Saves an array of activations to IndexedDB.
 * @param {Array} activations - Array of activation objects to save.
 * @returns {Promise<void>}
 */
async function saveActivationsToIndexedDB(activations) {
    const db = await getDatabase();
    const transaction = db.transaction('activations', 'readwrite');
    const store = transaction.objectStore('activations');

    // Clear existing activations to prevent duplicates
    store.clear();

    return new Promise((resolve, reject) => {
        activations.forEach(act => {
            store.put(act);
        });

        transaction.oncomplete = () => {
            console.log('Activations saved successfully to IndexedDB.');
            resolve();
        };

        transaction.onerror = (event) => {
            console.error('Error saving activations to IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Deletes an activation from IndexedDB.
 * @param {string} reference - The reference of the activation to delete.
 * @returns {Promise<void>}
 */
async function deleteActivationFromIndexedDB(reference) {
    const db = await getDatabase();
    const transaction = db.transaction('activations', 'readwrite');
    const store = transaction.objectStore('activations');

    return new Promise((resolve, reject) => {
        const request = store.delete(reference);
        request.onsuccess = () => {
            console.log(`Activation ${reference} deleted successfully.`);
            resolve();
        };
        request.onerror = () => {
            console.error(`Error deleting activation ${reference} from IndexedDB.`);
            reject('Error deleting activation.');
        };
    });
}

/**
 * Retrieves all parks from IndexedDB.
 * @returns {Promise<Array>} Array of park objects.
 */
async function getParksFromIndexedDB() {
    const db = await getDatabase();
    const transaction = db.transaction('parks', 'readonly');
    const store = transaction.objectStore('parks');
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject('Error retrieving parks from IndexedDB');
    });
}

/**
 * Saves an array of parks to IndexedDB.
 * @param {Array} parks - Array of park objects to save.
 * @returns {Promise<void>}
 */
async function saveParksToIndexedDB(parks) {
    const db = await getDatabase();
    const transaction = db.transaction('parks', 'readwrite');
    const store = transaction.objectStore('parks');

    // Clear existing parks to prevent duplicates
    store.clear();

    return new Promise((resolve, reject) => {
        parks.forEach(park => {
            store.put(park);
        });

        transaction.oncomplete = () => {
            console.log('Parks saved successfully to IndexedDB.');
            resolve();
        };

        transaction.onerror = (event) => {
            console.error('Error saving parks to IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Parses CSV text into an array of objects using PapaParse.
 * @param {string} csvText - The CSV data as a string.
 * @returns {Array<Object>} Parsed CSV data.
 * @throws {Error} If parsing fails.
 */
function parseCSV(csvText) {
    if (typeof Papa === 'undefined') {
        throw new Error('PapaParse library is not loaded. Please include it before using parseCSV.');
    }

    const parsedResult = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true
    });

    if (parsedResult.errors.length > 0) {
        console.error('Errors parsing CSV:', parsedResult.errors);
        throw new Error('Error parsing CSV data.');
    }

    return parsedResult.data;
}


/**
 * Creates a debounced version of the provided function.
 * @param {Function} func - The function to debounce.
 * @param {number} wait - The delay in milliseconds.
 * @returns {Function} The debounced function.
 */
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Handles updating activations via API and stores them in IndexedDB.
 */
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

        // Retrieve existing activations from IndexedDB
        let storedActivations = await getActivationsFromIndexedDB();
        console.log("Stored Activations Before Update:", storedActivations); // Debugging

        // Create a map for quick lookup to avoid duplicates
        const activationMap = new Map();
        storedActivations.forEach(act => activationMap.set(act.reference, act));

        // Append new activations, avoiding duplicates
        recentActivations.forEach(act => {
            if (!activationMap.has(act.reference)) {
                activationMap.set(act.reference, act);
                console.log(`Added new activation: ${act.reference}`); // Debugging
            } else {
                console.log(`Duplicate activation ignored: ${act.reference}`); // Debugging
            }
        });

        // Update the global activations array and IndexedDB
        activations = Array.from(activationMap.values());
        await saveActivationsToIndexedDB(activations);
        console.log("Updated Activations:", activations); // Debugging

        alert('Activations updated successfully!');

        // Refresh the map to reflect updated activations
        updateActivationsInView();
    } catch (error) {
        console.error('Error updating activations:', error);
        alert('Failed to update activations.');
    }
}

/**
 * Handles file upload and appends activations to IndexedDB.
 */
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const parsedData = JSON.parse(e.target.result);
            let newActivations;

            // Determine the format of the uploaded JSON
            if (Array.isArray(parsedData)) {
                newActivations = parsedData;
                console.log("Uploaded JSON is an array of activations.");
            } else if (parsedData.activations && Array.isArray(parsedData.activations)) {
                newActivations = parsedData.activations;
                console.log("Uploaded JSON contains an 'activations' array.");
            } else {
                throw new Error('Uploaded JSON does not contain an array of activations.');
            }

            console.log("Uploaded Activations:", newActivations); // Debugging

            // Retrieve existing activations from IndexedDB
            const storedActivations = await getActivationsFromIndexedDB();
            console.log("Stored Activations Before Upload:", storedActivations); // Debugging

            // Create a map for quick lookup to avoid duplicates based on 'reference'
            const activationMap = new Map();
            storedActivations.forEach(act => activationMap.set(act.reference, act));

            // Initialize counters for user feedback
            let appendedCount = 0;
            let duplicateCount = 0;
            let invalidCount = 0;

            // Append new activations, avoiding duplicates and validating entries
            newActivations.forEach(act => {
                if (act.reference && act.name) { // Basic validation
                    if (!activationMap.has(act.reference)) {
                        activationMap.set(act.reference, act);
                        appendedCount++;
                        console.log(`Appended new activation: ${act.reference}`); // Debugging
                    } else {
                        duplicateCount++;
                        console.log(`Duplicate activation ignored: ${act.reference}`); // Debugging
                    }
                } else {
                    invalidCount++;
                    console.warn(`Invalid activation entry skipped: ${JSON.stringify(act)}`); // Debugging
                }
            });

            // Update the global activations array and IndexedDB
            activations = Array.from(activationMap.values());
            await saveActivationsToIndexedDB(activations);
            console.log("Activations After Upload:", activations); // Debugging

            alert(`Activations appended successfully!\nAppended: ${appendedCount}\nDuplicates: ${duplicateCount}\nInvalid: ${invalidCount}`);

            // Refresh the map to reflect new activations
            updateActivationsInView();
        } catch (err) {
            console.error('Error uploading activations:', err);
            alert('Invalid JSON file or incorrect data format.');
        }
    };
    reader.readAsText(file);
}

/**
 * Fetches recent activations from the POTA.app API.
 * @param {string} callsign - The user's callsign.
 * @returns {Promise<Array>} The list of recent activations.
 */
async function fetchRecentActivations(callsign) {
    const url = `https://api.pota.app/#/profile/${callsign}`;
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

/**
 * Toggles the display of user's activations.
 */
async function toggleActivations(event) {
    const showActivations = event.target.checked;
    console.log(`Show My Activations toggled to: ${showActivations}`); // Debugging
    if (!showActivations) {
        // Hide activations by clearing the layer
        if (map.activationsLayer) {
            map.activationsLayer.clearLayers();
            console.log("Cleared activation markers."); // Debugging
        }
        return;
    }

    try {
        // Get activations from IndexedDB
        let storedActivations = await getActivationsFromIndexedDB();
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
                    console.log(`Added activation from toggle fetch: ${act.reference}`); // Debugging
                }
            });

            // Update the global activations array and IndexedDB
            activations = Array.from(activationMap.values());
            await saveActivationsToIndexedDB(activations);
            console.log("Activations After Toggle Fetch:", activations); // Debugging

            alert('Activations loaded successfully!');
        } else {
            // If activations are already loaded, ensure 'activations' variable is up to date
            activations = storedActivations;
            console.log("Activations are already loaded from IndexedDB."); // Debugging
        }

        // Update the activations on the map based on current view
        updateActivationsInView();
    } catch (error) {
        console.error('Error toggling activations:', error);
        alert('Failed to toggle activations.');
    }
}

/**
 * Retrieves the current geographical bounds of the map.
 * @returns {L.LatLngBounds} The current map bounds.
 */
function getCurrentMapBounds() {
    return map.getBounds();
}

/**
 * Filters activated parks that are within the current map bounds.
 * @param {Array} activations - The list of activated parks.
 * @param {Array} parks - The complete list of parks.
 * @param {L.LatLngBounds} bounds - The current map bounds.
 * @returns {Array} List of activated parks within bounds.
 */
function getActivatedParksInBounds(activations, parks, bounds) {
    const filteredParks = activations.filter((activation) => {
        // Find the corresponding park in the parks list
        const park = parks.find(p => p.reference === activation.reference);
        if (park && park.latitude && park.longitude) {
            const latLng = L.latLng(park.latitude, park.longitude);
            const isWithin = bounds.contains(latLng);
            console.log(`Park ${park.reference} (${park.name}) is within bounds: ${isWithin}`); // Debugging
            return isWithin;
        }
        console.warn(`Invalid park data for reference: ${activation.reference}`); // Debugging
        return false;
    });
    console.log("Filtered Activated Parks:", filteredParks); // Debugging
    return filteredParks;
}

/**
 * Updates the map to display activated parks within the current map view.
 */
function updateActivationsInView() {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    const bounds = getCurrentMapBounds();
    console.log("Current Map Bounds:", bounds.toBBoxString()); // Debugging

    // Get all parks within the current bounds
    const parksInBounds = parks.filter(park => {
        if (park.latitude && park.longitude) {
            const latLng = L.latLng(park.latitude, park.longitude);
            return bounds.contains(latLng);
        }
        console.warn(`Invalid park data for reference: ${park.reference}`); // Debugging
        return false;
    });

    console.log("Parks in Current View:", parksInBounds); // Debugging

    // Clear existing markers
    if (map.activationsLayer) {
        map.activationsLayer.clearLayers();
        console.log("Cleared existing markers."); // Debugging
    } else {
        map.activationsLayer = L.layerGroup().addTo(map);
        console.log("Created activationsLayer."); // Debugging
    }

    // Determine which parks are activated by the user within bounds
    const activatedReferences = activations
        .filter(act => parksInBounds.some(p => p.reference === act.reference))
        .map(act => act.reference);

    console.log("Activated References in Current View:", activatedReferences); // Debugging

    // Display all parks in bounds, highlighting activated ones
    displayParksOnMap(map, parksInBounds, activatedReferences, map.activationsLayer);
    console.log("Displayed all parks within current view with highlights."); // Debugging
}

/**
 * Refreshes the map activations based on the current state.
 */
function refreshMapActivations() {
    // Clear existing markers or layers if necessary
    if (map.activationsLayer) {
        map.activationsLayer.clearLayers();
        console.log("Cleared existing activation markers."); // Debugging
    }

    // Create a new layer group
    map.activationsLayer = L.layerGroup().addTo(map);
    console.log("Created activationsLayer."); // Debugging

    // Determine which activations to display
    let activatedReferences = [];
    const toggleCheckbox = document.getElementById('toggleActivations');
    if (toggleCheckbox && toggleCheckbox.checked) {
        activatedReferences = activations.map(act => act.reference);
        console.log("Activated References in Refresh:", activatedReferences); // Debugging
    }
    // Display parks with the current activations
    displayParksOnMap(map, parks, activatedReferences, map.activationsLayer);
    console.log("Displayed activated parks (if any) based on refresh."); // Debugging
}

/**
 * Fetches and caches park data from the CSV using IndexedDB and PapaParse.
 * @param {string} csvUrl - The CSV file URL.
 * @param {number} cacheDuration - Duration in milliseconds before cache expires.
 * @returns {Promise<Array>} The fetched and parsed park data.
 */
async function fetchAndCacheParks(csvUrl, cacheDuration) {
    const db = await getDatabase();
    const transaction = db.transaction('parks', 'readwrite');
    const store = transaction.objectStore('parks');

    // Check if parks data already exists
    const existingParks = await store.getAll();
    if (existingParks.length > 0) {
        // Optionally, implement cache invalidation based on your requirements
        console.log('Using cached park data from IndexedDB.');
        return existingParks;
    }

    try {
        console.log('Fetching park data from CSV...');
        const response = await fetch(csvUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch park data: ${response.statusText}`);
        }

        const csvText = await response.text();
        const parsedData = parseCSV(csvText);
        console.log('Parsed Park Data:', parsedData); // Debugging

        // Transform parsed data to desired format
        const parks = parsedData.map(park => ({
            reference: park.reference,
            name: park.name,
            latitude: parseFloat(park.latitude),
            longitude: parseFloat(park.longitude),
            activations: parseInt(park.activations, 10) || 0
        }));

        // Save parks to IndexedDB
        await saveParksToIndexedDB(parks);
        console.log('Park data fetched and cached successfully.');

        return parks;
    } catch (error) {
        console.error('Error fetching and caching park data:', error);
        // If fetch fails and parks are cached, return cached data
        if (existingParks.length > 0) {
            console.warn('Using existing cached park data due to fetch error.');
            return existingParks;
        }
        throw error; // Re-throw error if no cached data
    }
}

/**
 * Initializes the Leaflet map.
 * @param {number} lat - Latitude for the map center.
 * @param {number} lng - Longitude for the map center.
 * @returns {L.Map} The initialized Leaflet map instance.
 */
function initializeMap(lat, lng) {
    const mapInstance = L.map("map").setView([lat, lng], 10);
    console.log("Initialized map at:", lat, lng); // Debugging

    // Add OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapInstance);
    console.log("Added OpenStreetMap tiles."); // Debugging

    // Add marker for user's location
    L.marker([lat, lng])
        .addTo(mapInstance)
        .bindPopup("Your Location")
        .openPopup();
    console.log("Added user location marker."); // Debugging

    return mapInstance;
}

/**
 * Displays parks on the map, highlighting user-activated ones.
 * @param {L.Map} map - The Leaflet map instance.
 * @param {Array} parks - The complete list of parks.
 * @param {Array} userActivatedReferences - List of activated park references to highlight.
 * @param {L.LayerGroup} layerGroup - The layer group to add markers to.
 */
function displayParksOnMap(map, parks, userActivatedReferences, layerGroup = map.activationsLayer) {
    console.log(`Displaying ${parks.length} parks on the map.`); // Debugging

    // Ensure 'activations' is an array
    if (!Array.isArray(activations)) {
        console.error("Activations is not an array:", activations);
        activations = []; // Fallback to an empty array to prevent further errors
    }

    parks.forEach((park) => {
        const { reference, name, latitude, longitude, activations: parkActivationCount } = park;
        const isUserActivated = userActivatedReferences.includes(reference);
        const markerColor = getMarkerColor(parkActivationCount, isUserActivated);

        console.log(`Adding marker for: ${name} (${reference}) with color: ${markerColor}`); // Debugging

        // Find all activations for this specific park
        const parkActivations = activations.filter(act => act.reference === reference);
        let latestActivationDate = 'No activations';

        if (parkActivations.length > 0) {
            // Extract valid dates from activations
            const validDates = parkActivations
                .map(act => new Date(act.date))
                .filter(date => !isNaN(date)); // Filter out invalid dates

            if (validDates.length > 0) {
                // Sort dates in descending order and pick the latest
                const latestDate = validDates.sort((a, b) => b - a)[0];
                latestActivationDate = latestDate.toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            }
        }

        // Create the popup content with the latest activation date
        const popupContent = `
            <b>${name}</b><br>
            Identifier: ${reference}<br>
            Activations: ${parkActivationCount}<br>
            <b>My Most Recent Activation:</b> ${latestActivationDate}
        `;

        // Create a custom marker
        const customMarker = L.circleMarker([latitude, longitude], {
            radius: 6, // Marker size
            fillColor: markerColor, // Inner color
            color: "#000", // Border color
            weight: 1,
            opacity: 1, // Border opacity
            fillOpacity: 0.9, // Fill opacity
        });

        // Add marker to the specified layer group
        customMarker
            .addTo(layerGroup)
            .bindPopup(popupContent)
            .bindTooltip(`${reference}: ${name} (${parkActivationCount} activations)`, {
                direction: "top",
                opacity: 0.9,
                sticky: false, // Ensures tooltip disappears when not hovering
                className: "custom-tooltip", // Optional: Add a custom class for additional styling
            });

        // Add click event listener to close the tooltip when marker is clicked
        customMarker.on('click', function() {
            this.closeTooltip();
        });
    });

    console.log("All parks displayed with appropriate highlights."); // Debugging
}

/**
 * Determines the marker color based on activations and user activation status.
 * @param {number} activations - The number of activations for the park.
 * @param {boolean} userActivated - Whether the user has activated the park.
 * @returns {string} The color code for the marker.
 */
function getMarkerColor(activations, userActivated) {
    if (userActivated) return "#ffa500"; // Orange for user-activated parks
    if (activations > 10) return "#ff6666"; // Light red for highly active parks
    if (activations > 0) return "#90ee90"; // Light green for active parks
    return "#0000ff"; // Vivid blue for inactive parks
}

/**
 * Initializes the Leaflet map and loads park data from CSV using IndexedDB.
 */
async function setupPOTAMap() {
    const csvUrl = 'https://pota.review/potamap/data/usparks.csv';
    const cacheDuration = 24 * 60 * 60 * 1000; // 1 day in milliseconds

    try {
        const parksData = await fetchAndCacheParks(csvUrl, cacheDuration);
        parks = parksData; // Already formatted in fetchAndCacheParks
        console.log("Parks Loaded from IndexedDB:", parks); // Debugging

        // Retrieve activations from IndexedDB
        activations = await getActivationsFromIndexedDB();
        console.log("Initial Activations:", activations); // Debugging

        // Optional: Validate that activations correspond to existing parks
        activations.forEach(act => {
            const exists = parks.some(p => p.reference === act.reference);
            if (!exists) {
                console.warn(`Activation reference ${act.reference} does not match any park.`);
            }
        });

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;

                map = initializeMap(userLat, userLng);

                // Create a layer group for activations
                map.activationsLayer = L.layerGroup().addTo(map);
                console.log("Created activationsLayer."); // Debugging

                // Attach event listener for map view changes with debouncing
                map.on('moveend', debounce(() => {
                    console.log("Map moved or zoomed."); // Debugging
                    updateActivationsInView();
                }, 300));
                console.log("Attached moveend event listener with debounce."); // Debugging

                // Initial display based on toggle state
                const toggleCheckbox = document.getElementById('toggleActivations');
                if (toggleCheckbox && toggleCheckbox.checked) {
                    updateActivationsInView();
                } else {
                    // Display all parks without highlighting activations
                    if (map.activationsLayer) {
                        map.activationsLayer.clearLayers();
                    }
                    displayParksOnMap(map, parks, [], map.activationsLayer);
                    console.log("Displayed all parks without activated highlights."); // Debugging
                }
            },
            (error) => {
                console.error('Error getting location:', error.message);
                alert('Unable to retrieve your location.');
            }
        );
    } catch (error) {
        console.error('Error setting up POTA map:', error.message);
        alert('Failed to set up the POTA map. Please try again later.');
    }
}

/**
 * Adds CSS styles for the hamburger menu.
 */
(function addHamburgerMenuStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
        /* Hamburger Menu Container */
        #hamburgerMenu {
            position: absolute;
            top: 10px;
            right: 10px; /* Changed from left: 10px to right: 10px */
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
            right: 0; /* Changed from left: 0 to right: 0 */
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
    console.log("Hamburger menu styles added and positioned to the right."); // Debugging
})();
