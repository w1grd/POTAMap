// Initialize global variables
let activations = [];
let map; // Leaflet map instance
let parks = []; // Global variable to store parks data
let userLat = null;
let userLng = null;
// Declare a global variable to store current search results
let currentSearchResults = [];


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
                    <button id="uploadActivations">Upload Activations File</button>
                    <input type="file" id="fileUpload" accept=".csv, text/csv" style="display:none;" />
                </li>
                <li>
                    <button id="toggleActivations" class="toggle-button">Show My Activations</button>
                </li>
                <li id="searchBoxContainer">
                    <label for="searchBox">Search Parks:</label>
                    <input type="text" id="searchBox" placeholder="Enter park name, ID, location..." />
                    <button id="clearSearch" title="Clear Search">&times;</button>
                </li>
                <li id="activationSliderContainer">
                    <label for="activationSlider">Minimum Activations: <span id="sliderValue">0</span></label>
                    <input type="range" id="activationSlider" min="0" max="100" value="0" />
                </li>
            </ul>
        </div>
    `;
    document.body.appendChild(menu);

    // Add event listeners for the menu options
    document.getElementById('uploadActivations').addEventListener('click', () => {
        document.getElementById('fileUpload').click();
    });
    document.getElementById('fileUpload').addEventListener('change', handleFileUpload);
    document.getElementById('toggleActivations').addEventListener('click', toggleActivations);

    // Add event listeners for the search box
    document.getElementById('searchBox').addEventListener('input', debounce(handleSearchInput, 300));
    document.getElementById('clearSearch').addEventListener('click', clearSearchInput);

    // Add event listener for 'Enter' key in the search box
    document.getElementById('searchBox').addEventListener('keydown', handleSearchEnter);

    console.log("Hamburger menu initialized."); // Debugging

    // Add enhanced hamburger menu styles for mobile
    enhanceHamburgerMenuForMobile();
}

/**
 * Enhances the hamburger menu's responsiveness, touch-friendliness, and styles the activation slider.
 */
function enhanceHamburgerMenuForMobile() {
    const style = document.createElement('style');
    style.innerHTML = `
        /* Hamburger Menu Container */
        #hamburgerMenu {
            position: absolute;
            top: 10px;
            right: 10px; /* Positioned to the right */
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
            right: 0; /* Positioned to the right */
            width: 220px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            border-radius: 8px;
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
            margin: 15px 0;
        }

        /* Upload Activations Button */
        #uploadActivations {
            cursor: pointer;
            background: #007BFF;
            color: #fff;
            border: none;
            padding: 12px;
            font-size: 16px;
            width: 100%;
            border-radius: 6px;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        #uploadActivations:hover {
            background: #0056b3;
            transform: translateY(-2px);
        }

        /* Toggle Activations Button */
        .toggle-button {
            cursor: pointer;
            background: #6c757d;
            color: #fff;
            border: none;
            padding: 12px;
            font-size: 16px;
            width: 100%;
            border-radius: 6px;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        .toggle-button.active {
            background: #28a745;
        }

        .toggle-button:hover {
            background: #5a6268;
            transform: translateY(-2px);
        }

        /* Slider Container */
        #activationSliderContainer {
            margin-top: 20px;
        }

        /* Slider Label */
        #activationSliderContainer label {
            display: block;
            font-size: 16px;
            margin-bottom: 8px;
            color: #333;
        }

        /* Slider Value Display */
        #sliderValue {
            font-weight: bold;
            margin-left: 8px;
            color: #007BFF;
        }

        /* Slider Styling */
        #activationSlider {
            -webkit-appearance: none;
            width: 100%;
            height: 8px;
            border-radius: 4px;
            background: #d3d3d3;
            outline: none;
            transition: background 0.3s ease;
        }

        #activationSlider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        #activationSlider::-webkit-slider-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        #activationSlider::-moz-range-thumb {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        #activationSlider::-moz-range-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        #activationSlider::-ms-thumb {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        #activationSlider::-ms-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        /* Responsive Styles for Mobile Devices */
        @media (max-width: 600px) {
            /* Adjust hamburger menu size and positioning */
            #hamburgerMenu {
                top: 5px;
                right: 5px;
            }

            #menuToggle label span {
                width: 20px;
                height: 2px;
                margin: 4px 0;
            }

            /* Adjust menu width */
            #menu {
                width: 180px;
                padding: 10px;
            }

            /* Increase font sizes for better readability */
            #menu button,
            #menu label {
                font-size: 18px;
            }

            /* Increase button sizes for touch */
            button,
            input[type="file"] {
                padding: 10px;
                font-size: 16px;
            }

            /* Adjust map container height */
            #map {
                height: 100vh; /* Full viewport height */
            }

            /* Style Callsign Display */
            #callsignDisplay {
                position: absolute;
                top: 10px;
                left: 10px;
                background: rgba(255, 255, 255, 0.8);
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 16px;
                z-index: 1001;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
        }
/* Search Box Container */
#searchBoxContainer {
    margin-top: 20px;
    position: relative;
}

/* Search Box Label */
#searchBoxContainer label {
    display: block;
    font-size: 16px;
    margin-bottom: 8px;
    color: #333;
}

/* Search Box Input */
#searchBox {
    width: 100%;
    padding: 10px 40px 10px 12px; /* Padding to accommodate the clear button */
    font-size: 16px;
    border: 1px solid #ccc;
    border-radius: 6px;
    outline: none;
    transition: border-color 0.3s ease;
}

#searchBox:focus {
    border-color: #007BFF;
}

/* Clear Search Button */
#clearSearch {
    position: absolute;
    top: 35px; /* Align with the input box */
    right: 12px;
    background: transparent;
    border: none;
    font-size: 18px;
    color: #aaa;
    cursor: pointer;
    display: none; /* Hidden by default */
    transition: color 0.3s ease;
}

#searchBox:not(:placeholder-shown) + #clearSearch {
    display: block;
}

#clearSearch:hover {
    color: #333;
}

/* Responsive Styles for Search Box */
@media (max-width: 600px) {
    #searchBoxContainer label {
        font-size: 18px;
    }

    #searchBox {
        font-size: 18px;
    }

    #clearSearch {
        font-size: 20px;
    }
}

@media (min-width: 601px) and (max-width: 1024px) {
    #searchBoxContainer label {
        font-size: 16px;
    }

    #searchBox {
        font-size: 16px;
    }

    #clearSearch {
        font-size: 18px;
    }
}

        @media (min-width: 601px) and (max-width: 1024px) {
            /* Tablet-specific styles */
            #hamburgerMenu {
                top: 10px;
                right: 10px;
            }

            #menuToggle label span {
                width: 25px;
                height: 3px;
                margin: 5px 0;
            }

            /* Adjust menu width */
            #menu {
                width: 200px;
                padding: 12px;
            }

            /* Increase font sizes moderately */
            #menu button,
            #menu label {
                font-size: 16px;
            }

            /* Adjust map container height */
            #map {
                height: 90vh; /* Slightly less than viewport height */
            }

            /* Increase button sizes */
            button,
            input[type="file"] {
                padding: 8px;
                font-size: 14px;
            }

            /* Style Callsign Display */
            #callsignDisplay {
                position: absolute;
                top: 10px;
                left: 10px;
                background: rgba(255, 255, 255, 0.8);
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 14px;
                z-index: 1001;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
        }

        /* General Responsive Enhancements */
        body, html {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
        }

        #map {
            width: 100%;
            height: 90vh; /* Adjust height as needed */
        }

        /* Adjust Leaflet Controls for Mobile */
        .leaflet-control-attribution {
            font-size: 12px;
        }

        .leaflet-control {
            font-size: 16px; /* Increase control sizes */
        }

        /* Popup Content Adjustments */
        .leaflet-popup-content {
            font-size: 14px;
        }

        /* Tooltip Adjustments */
        .custom-tooltip {
            font-size: 14px;
            padding: 5px;
        }

        /* Ensure buttons and inputs have adequate size and spacing */
        button, label, input[type="file"] {
            min-height: 40px;
            padding: 10px;
            font-size: 16px;
        }
    `;
    document.head.appendChild(style);
    console.log("Responsive styles with enhanced slider added."); // Debugging

    // Add styles for the activation slider
    const sliderStyle = document.createElement('style');
    sliderStyle.innerHTML = `
        /* Slider Container */
        #activationSliderContainer {
            margin-top: 20px;
        }

        /* Slider Label */
        #activationSliderContainer label {
            display: block;
            font-size: 16px;
            margin-bottom: 8px;
            color: #333;
        }

        /* Slider Value Display */
        #sliderValue {
            font-weight: bold;
            margin-left: 8px;
            color: #007BFF;
        }

        /* Slider Styling */
        #activationSlider {
            -webkit-appearance: none;
            width: 100%;
            height: 8px;
            border-radius: 4px;
            background: #d3d3d3;
            outline: none;
            transition: background 0.3s ease;
        }

        #activationSlider:hover {
            background: #c0c0c0;
        }

        #activationSlider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
            box-shadow: 0 0 2px rgba(0,0,0,0.5);
        }

        #activationSlider::-webkit-slider-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        #activationSlider::-moz-range-thumb {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
            box-shadow: 0 0 2px rgba(0,0,0,0.5);
        }

        #activationSlider::-moz-range-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        #activationSlider::-ms-thumb {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
            box-shadow: 0 0 2px rgba(0,0,0,0.5);
        }

        #activationSlider::-ms-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        /* Track Styling */
        #activationSlider::-webkit-slider-runnable-track {
            height: 8px;
            border-radius: 4px;
            background: linear-gradient(to right, #90ee90, #ffa500, #ff6666);
        }

        #activationSlider::-moz-range-track {
            height: 8px;
            border-radius: 4px;
            background: linear-gradient(to right, #90ee90, #ffa500, #ff6666);
        }

        #activationSlider::-ms-track {
            height: 8px;
            border-radius: 4px;
            background: linear-gradient(to right, #90ee90, #ffa500, #ff6666);
            border: none;
            color: transparent;
        }

        /* Active Range Styling */
        #activationSlider::-webkit-slider-thumb:active {
            transform: scale(1.2);
        }

        #activationSlider::-moz-range-thumb:active {
            transform: scale(1.2);
        }

        #activationSlider::-ms-thumb:active {
            transform: scale(1.2);
        }
    `;
    document.head.appendChild(sliderStyle);
    console.log("Activation slider custom styles added."); // Debugging
}

/**
 * Initializes and returns the IndexedDB database.
 * @returns {Promise<IDBDatabase>} The IndexedDB database instance.
 */
async function getDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('potaDatabase', 3); // Incremented version to add 'parkActivations' store

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

            // Create object store for park activations if it doesn't exist
            if (!db.objectStoreNames.contains('parkActivations')) {
                db.createObjectStore('parkActivations', { keyPath: 'reference' });
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
        request.onsuccess = () => {
            console.log("Retrieved Activations from IndexedDB:", request.result); // Debugging
            resolve(request.result);
        };
        request.onerror = () => {
            console.error("Error retrieving activations from IndexedDB:", request.error); // Debugging
            reject('Error retrieving activations from IndexedDB');
        };
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
 * Retrieves activations for a specific park from IndexedDB.
 * @param {string} reference - The park reference code.
 * @returns {Promise<Array>} Array of activation objects.
 */
async function getParkActivationsFromIndexedDB(reference) {
    const db = await getDatabase();
    const transaction = db.transaction('parkActivations', 'readonly');
    const store = transaction.objectStore('parkActivations');
    return new Promise((resolve, reject) => {
        const request = store.get(reference);
        request.onsuccess = () => {
            if (request.result) {
                resolve(request.result.activations);
            } else {
                resolve(null);
            }
        };
        request.onerror = () => {
            console.error(`Error retrieving park activations for ${reference} from IndexedDB:`, request.error);
            reject('Error retrieving park activations from IndexedDB');
        };
    });
}

/**
 * Saves activations for a specific park to IndexedDB.
 * @param {string} reference - The park reference code.
 * @param {Array} activations - Array of activation objects to save.
 * @returns {Promise<void>}
 */
async function saveParkActivationsToIndexedDB(reference, activations) {
    const db = await getDatabase();
    const transaction = db.transaction('parkActivations', 'readwrite');
    const store = transaction.objectStore('parkActivations');
    return new Promise((resolve, reject) => {
        const data = { reference, activations };
        const request = store.put(data);
        request.onsuccess = () => {
            console.log(`Park activations for ${reference} saved successfully to IndexedDB.`);
            resolve();
        };
        request.onerror = (event) => {
            console.error(`Error saving park activations for ${reference} to IndexedDB:`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Fetches activations for a specific park from the POTA API.
 * @param {string} reference - The park reference code.
 * @returns {Promise<Array>} Array of activation objects.
 */
async function fetchParkActivations(reference) {
    const url = `https://api.pota.app/park/activations/${reference}?count=all`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch activations for park ${reference}: ${response.statusText}`);
        }
        const data = await response.json();
        console.log(`Fetched ${data.length} activations for park ${reference} from API.`);
        return data;
    } catch (error) {
        console.error(error);
        return [];
    }
}

/**
 * Formats a QSO date string from 'YYYYMMDD' to a human-readable date.
 * @param {string} qsoDate - The QSO date in 'YYYYMMDD' format.
 * @returns {string} The formatted date.
 */
function formatQsoDate(qsoDate) {
    const year = qsoDate.substring(0, 4);
    const month = qsoDate.substring(4, 6);
    const day = qsoDate.substring(6, 8);
    const date = new Date(`${year}-${month}-${day}`);
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
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
 * (Removed as per user request)
 */

/**
 * Handles file upload and appends activations to IndexedDB.
 */
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            // Parse the CSV file using PapaParse
            const parsedData = parseCSV(e.target.result);
            let newActivations = parsedData;

            console.log("Uploaded Activations from CSV:", newActivations); // Debugging

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
                // Basic validation: Check for required fields
                if (act.Reference && act["Park Name"] && act["First QSO Date"] && act.QSOs) {
                    const reference = act.Reference.trim();
                    const name = act["Park Name"].trim();
                    const qso_date = act["First QSO Date"].trim();
                    const totalQSOs = parseInt(act.QSOs, 10) || 0;
                    const activationsCount = parseInt(act.Activations, 10) || 0;
                    const attempts = parseInt(act.Attempts, 10) || 0;

                    // Create the activation object
                    const activationObject = {
                        reference: reference,
                        name: name,
                        qso_date: qso_date,
                        activeCallsign: act.activeCallsign ? act.activeCallsign.trim() : "", // Extracted from CSV
                        totalQSOs: totalQSOs,
                        qsosCW: 0, // Assign default value
                        qsosDATA: 0, // Assign default value
                        qsosPHONE: 0, // Assign default value
                        attempts: attempts,
                        activations: activationsCount
                    };

                    if (!activationMap.has(reference)) {
                        activationMap.set(reference, activationObject);
                        appendedCount++;
                        console.log(`Appended new activation: ${reference}`); // Debugging
                    } else {
                        duplicateCount++;
                        console.log(`Duplicate activation ignored: ${reference}`); // Debugging
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

            // If Show My Activations is active, display callsign
            const toggleButton = document.getElementById('toggleActivations');
            if (toggleButton.classList.contains('active')) {
                displayCallsign();
            }
        } catch (err) {
            console.error('Error uploading activations:', err);
            alert('Invalid CSV file or incorrect data format.');
        }
    };
    reader.readAsText(file);
}

/**
 * Handles changes to the activation slider.
 * @param {Event} event - The input event from the slider.
 */
function handleSliderChange(event) {
    const minActivations = parseInt(event.target.value, 10);
    document.getElementById('sliderValue').innerText = minActivations;
    console.log(`Minimum activations set to: ${minActivations}`); // Debugging

    // Update the map based on the new slider value
    filterParksByActivations(minActivations);
}
/**
 * Handles input in the search box and filters parks based on the query.
 * @param {Event} event - The input event from the search box.
 */
function handleSearchInput(event) {
    const query = normalizeString(event.target.value);
    console.log(`Search query received: "${query}"`); // Debugging

    if (query === '') {
        // If the search box is empty, reset the park display based on current filters
        currentSearchResults = [];
        resetParkDisplay();
        return;
    }

    // Filter parks based on the search query
    const filteredParks = parks.filter(park => {
        return (
            normalizeString(park.name).includes(query) ||
            normalizeString(park.reference).includes(query) ||
            normalizeString(park.location).includes(query) // Ensure 'location' exists
        );
    });

    console.log(`Parks matching search: ${filteredParks.length}`); // Debugging

    // Update the global search results
    currentSearchResults = filteredParks;

    // Update the map to display only the filtered parks
    updateMapWithFilteredParks(filteredParks);
}

/**
 * Handles the 'Enter' key press in the search box to zoom to the searched park(s).
 * @param {KeyboardEvent} event - The keyboard event triggered by key presses.
 */
function handleSearchEnter(event) {
    if (event.key === 'Enter') {
        event.preventDefault(); // Prevent form submission or other default actions
        console.log("'Enter' key pressed in search box."); // Debugging

        if (currentSearchResults.length === 0) {
            alert('No parks found matching your search criteria.');
            return;
        }

        if (currentSearchResults.length === 1) {
            // If only one park matches, center and zoom to it
            const park = currentSearchResults[0];
            zoomToPark(park);
        } else {
            // If multiple parks match, fit the map bounds to include all
            zoomToParks(currentSearchResults);
        }
    }
}
/**
 * Zooms the map to a single park's location with increased magnification.
 * @param {Object} park - The park object to zoom into.
 */
function zoomToPark(park) {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    const { latitude, longitude } = park;
    const zoomLevel = 16; // Adjust zoom level as desired

    map.setView([latitude, longitude], zoomLevel, {
        animate: true,
        duration: 1.5 // Duration in seconds for the animation
    });

    console.log(`Zoomed to park: ${park.name} (${park.reference}) at [${latitude}, ${longitude}].`); // Debugging

    // Optionally, open the popup for the park
    // Find the corresponding marker and open its popup
    map.activationsLayer.eachLayer(layer => {
        if (layer.getLatLng().lat === latitude && layer.getLatLng().lng === longitude) {
            layer.openPopup();
        }
    });
}

/**
 * Zooms the map to fit all searched parks within the view.
 * @param {Array} parks - An array of park objects to include in the view.
 */
function zoomToParks(parks) {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    const latLngs = parks.map(park => [park.latitude, park.longitude]);

    if (latLngs.length === 0) {
        console.warn("No valid park locations to zoom to.");
        return;
    }

    const bounds = L.latLngBounds(latLngs);
    const zoomLevel = 12; // Adjust zoom level as desired when multiple parks are selected

    map.fitBounds(bounds, {
        padding: [50, 50], // Padding in pixels
        animate: true,
        duration: 1.5 // Duration in seconds for the animation
    });

    console.log(`Zoomed to fit ${parks.length} parks within the view.`); // Debugging

    // Optionally, open popups for all filtered parks
    parks.forEach(park => {
        map.activationsLayer.eachLayer(layer => {
            if (layer.getLatLng().lat === park.latitude && layer.getLatLng().lng === park.longitude) {
                layer.openPopup();
            }
        });
    });
}


/**
 * Normalizes a string for consistent comparison.
 * Converts to lowercase and trims whitespace.
 * If the input is not a string, returns an empty string.
 * @param {string} str - The string to normalize.
 * @returns {string} The normalized string.
 */
function normalizeString(str) {
    return typeof str === 'string' ? str.toLowerCase().trim() : '';
}



/**
 * Filters and displays parks based on the minimum number of activations.
 * @param {number} minActivations - The minimum number of activations to display.
 */
function filterParksByActivations(minActivations) {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    // Get current map bounds
    const bounds = getCurrentMapBounds();
    console.log("Current Map Bounds:", bounds.toBBoxString()); // Debugging

    // Get all parks within the current bounds and meeting the activation criteria
    const parksInBounds = parks.filter(park => {
        if (park.latitude && park.longitude) {
            const latLng = L.latLng(park.latitude, park.longitude);
            return bounds.contains(latLng) && park.activations >= minActivations;
        }
        console.warn(`Invalid park data for reference: ${park.reference}`); // Debugging
        return false;
    });

    console.log("Parks in Current View with Activations >= min:", parksInBounds); // Debugging

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

    console.log("Activated References in Filtered View:", activatedReferences); // Debugging

    // Display activated parks within current view based on slider
    displayParksOnMap(map, parksInBounds, activatedReferences, map.activationsLayer);
    console.log("Displayed activated parks within filtered view."); // Debugging
}


/**
 * Toggles the display of user's activations.
 */
async function toggleActivations() {
    const toggleButton = document.getElementById('toggleActivations');
    toggleButton.classList.toggle('active');
    const isActive = toggleButton.classList.contains('active');

    console.log(`Show My Activations toggled to: ${isActive}`); // Debugging

    if (!isActive) {
        // Hide activations by clearing the layer
        if (map.activationsLayer) {
            map.activationsLayer.clearLayers();
            console.log("Cleared activation markers."); // Debugging
        }
        // Remove callsign display
        removeCallsignDisplay();
        return;
    }

    try {
        // Get activations from IndexedDB
        let storedActivations = await getActivationsFromIndexedDB();
        console.log("Stored Activations on Toggle:", storedActivations); // Debugging

        if (storedActivations.length === 0) {
            alert('No activations available to display.');
            toggleButton.classList.remove('active');
            return;
        }

        // Update the global activations array
        activations = storedActivations;
        console.log("Activations are loaded from IndexedDB."); // Debugging

        // Update the activations on the map based on current view
        updateActivationsInView();

        // Display callsign(s) on the page
        displayCallsign();
    } catch (error) {
        console.error('Error toggling activations:', error);
        alert('Failed to toggle activations.');
        toggleButton.classList.remove('active');
    }
}


/**
 * Displays the callsign(s) of the user's activations near the upper left of the page.
 */
function displayCallsign() {
    // Create or update the callsign display element
    let callsignDiv = document.getElementById('callsignDisplay');
    if (!callsignDiv) {
        callsignDiv = document.createElement('div');
        callsignDiv.id = 'callsignDisplay';
        document.body.appendChild(callsignDiv);
    }

    // Extract unique callsigns from activations within the current filter
    const uniqueCallsigns = [...new Set(activations
        .filter(act => act.activeCallsign)
        .map(act => act.activeCallsign.trim())
    )];

    if (uniqueCallsigns.length > 0) {
        callsignDiv.innerHTML = `<strong>Callsign:</strong> ${uniqueCallsigns.join(', ')}`;
    } else {
        callsignDiv.innerHTML = '';
    }
}

/**
 * Removes the callsign display from the page.
 */
function removeCallsignDisplay() {
    const callsignDiv = document.getElementById('callsignDisplay');
    if (callsignDiv) {
        callsignDiv.remove();
        console.log("Calls-in display removed."); // Debugging
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
async function updateActivationsInView() {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    // Ensure 'activations' is an array
    if (!Array.isArray(activations)) {
        console.error("Activations is not an array:", activations);
        activations = []; // Fallback to an empty array
    } else {
        console.log("Activations is a valid array with length:", activations.length); // Debugging
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

    // Display activated parks within current view
    displayParksOnMap(map, parksInBounds, activatedReferences, map.activationsLayer);
    console.log("Displayed activated parks within current view."); // Debugging
}

/**
 * Updates the map to display only the filtered parks based on the search query.
 * @param {Array} filteredParks - Array of park objects that match the search criteria.
 */
function updateMapWithFilteredParks(filteredParks) {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    // Clear existing markers
    if (map.activationsLayer) {
        map.activationsLayer.clearLayers();
        console.log("Cleared existing markers for filtered search."); // Debugging
    } else {
        map.activationsLayer = L.layerGroup().addTo(map);
        console.log("Created activationsLayer for filtered search."); // Debugging
    }

    // Determine which parks are activated by the user within filtered parks
    const activatedReferences = activations
        .filter(act => filteredParks.some(p => p.reference === act.reference))
        .map(act => act.reference);

    console.log("Activated References in Filtered Search:", activatedReferences); // Debugging

    // Display the filtered parks on the map
    displayParksOnMap(map, filteredParks, activatedReferences, map.activationsLayer);
    console.log("Displayed filtered parks on the map."); // Debugging
}
/**
 * Clears the search input and resets the park display.
 */
function clearSearchInput() {
    const searchBox = document.getElementById('searchBox');
    if (searchBox) {
        searchBox.value = '';
        console.log("Search input cleared."); // Debugging
    }

    // Reset park display based on current activation filters
    resetParkDisplay();
}
/**
 * Resets the park display on the map based on current activation filters.
 * This function is called when the search input is cleared.
 */
function resetParkDisplay() {
    const activationSlider = document.getElementById('activationSlider');
    const minActivations = activationSlider ? parseInt(activationSlider.value, 10) : 0;
    console.log(`Resetting park display with Minimum Activations: ${minActivations}`); // Debugging

    // Filter parks based on the current activation slider value
    const parksToDisplay = parks.filter(park => park.activations >= minActivations);

    // Update the map with the filtered parks
    filterParksByActivations(minActivations);
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
    const toggleButton = document.getElementById('toggleActivations');
    if (toggleButton && toggleButton.classList.contains('active')) {
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
    // Determine if the device is mobile based on screen width
    const isMobile = window.innerWidth <= 600;

    const mapInstance = L.map("map", {
        center: [lat, lng],
        zoom: isMobile ? 12 : 10, // Higher zoom on mobile for better detail
        zoomControl: !isMobile, // Optionally disable zoom controls on mobile
        attributionControl: true
    });

    console.log("Initialized map at:", lat, lng); // Debugging

    // Add OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapInstance);
    console.log("Added OpenStreetMap tiles."); // Debugging

    // Add marker for user's location with adjusted icon size
    L.marker([lat, lng], {
        icon: L.icon({
            iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png', // Replace with your custom icon URL if needed
            iconSize: [30, 30], // Increased icon size for better visibility on mobile
            iconAnchor: [15, 30],
            popupAnchor: [0, -30]
        })
    })
        .addTo(mapInstance)
        .bindPopup("Your Location")
        .openPopup();
    console.log("Added user location marker."); // Debugging

    return mapInstance;
}

/**
 * Displays parks on the map, highlighting user-activated ones and filtering based on activation count.
 * @param {L.Map} map - The Leaflet map instance.
 * @param {Array} parks - The complete list of parks to display.
 * @param {Array} userActivatedReferences - List of activated park references to highlight.
 * @param {L.LayerGroup} layerGroup - The layer group to add markers to.
 */
function displayParksOnMap(map, parks, userActivatedReferences, layerGroup = map.activationsLayer) {
    console.log(`Displaying ${parks.length} parks on the map.`); // Debugging

    // Ensure 'activations' is an array
    if (!Array.isArray(activations)) {
        console.error("Activations is not an array:", activations);
        activations = []; // Fallback to an empty array to prevent further errors
    } else {
        console.log("Activations is a valid array with length:", activations.length); // Debugging
    }

    // Determine if the device is mobile
    const isMobile = window.innerWidth <= 600;
    const markerRadius = isMobile ? 8 : 6; // Larger markers on mobile

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
                .map(act => new Date(act.qso_date))
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

        // Create the directions link if user location is available
        const directionsLink = userLat !== null && userLng !== null
            ? `<a href="https://www.google.com/maps/dir/?api=1&origin=${userLat},${userLng}&destination=${latitude},${longitude}&travelmode=driving" target="_blank" rel="noopener noreferrer">Get Directions</a>`
            : '';

        // Create the POTA.app park page link
        const potaAppLink = `<a href="https://pota.app/#/park/${reference}" target="_blank" rel="noopener noreferrer"><b>${name} (${reference})</b></a>`;

        // Create the initial popup content with a placeholder for recent activations
        let popupContent = `
            ${potaAppLink}<br>
            Activations: ${parkActivationCount}<br>
            <b>Most Recent Activation:</b> ${latestActivationDate}<br>
            ${directionsLink}<br>
            <i>Loading recent activations...</i>
        `;

        // Create a custom marker with adjusted size
        const customMarker = L.circleMarker([latitude, longitude], {
            radius: markerRadius, // Adjusted radius
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

        // Add event listener for when the popup is opened
        (function(marker, reference, name, parkActivationCount, latestActivationDate, directionsLink) {
            marker.on('popupopen', async function() {
                try {
                    // Fetch activations for this park
                    let parkActivations = await getParkActivationsFromIndexedDB(reference);
                    if (!parkActivations) {
                        console.log(`Fetching activations for park ${reference} from API.`);
                        parkActivations = await fetchParkActivations(reference);
                        await saveParkActivationsToIndexedDB(reference, parkActivations);
                    } else {
                        console.log(`Using cached activations for park ${reference}.`);
                    }

                    // Get the three most recent activations
                    const recentActivations = parkActivations
                        .sort((a, b) => parseInt(b.qso_date) - parseInt(a.qso_date))
                        .slice(0, 3);

                    // Format the recent activations
                    let recentActivationsHtml = '';
                    if (recentActivations.length > 0) {
                        recentActivationsHtml += '<b>Recent Activations:</b><br>';
                        recentActivations.forEach(act => {
                            const dateStr = formatQsoDate(act.qso_date);
                            recentActivationsHtml += `${act.activeCallsign} on ${dateStr} (${act.totalQSOs} QSOs)<br>`;
                        });
                    } else {
                        recentActivationsHtml += 'No recent activations.';
                    }

                    // Create the POTA.app park page link
                    const updatedPotaAppLink = `<a href="https://pota.app/#/park/${reference}" target="_blank" rel="noopener noreferrer"><b>${name} (${reference})</b></a>`;

                    // Update the popup content
                    const updatedPopupContent = `
                        ${updatedPotaAppLink}<br>
                        Activations: ${parkActivationCount}<br>
                        <b>Most Recent Activation:</b> ${latestActivationDate}<br>
                        ${directionsLink}<br>
                        ${recentActivationsHtml}
                    `;

                    marker.setPopupContent(updatedPopupContent);
                } catch (error) {
                    console.error(`Error fetching activations for park ${reference}:`, error);
                }
            });
        })(customMarker, reference, name, parkActivationCount, latestActivationDate, directionsLink);
    });

    console.log("All parks displayed with appropriate highlights."); // Debugging
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
    const toggleButton = document.getElementById('toggleActivations');
    if (toggleButton && toggleButton.classList.contains('active')) {
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
 * Initializes the Leaflet map and loads park data from CSV using IndexedDB.
 */
async function setupPOTAMap() {
    const csvUrl = 'https://pota.review/potamap/data/usparks.csv';
    const cacheDuration = 24 * 60 * 60 * 1000; // 1 day in milliseconds

    try {
        // Fetch and cache parks data
        const parksData = await fetchAndCacheParks(csvUrl, cacheDuration);
        parks = parksData.map(park => ({
            reference: park.reference,
            name: park.name,
            latitude: parseFloat(park.latitude),
            longitude: parseFloat(park.longitude),
            activations: parseInt(park.activations, 10) || 0
        }));
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

        // Initialize the map with user's location
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                userLat = position.coords.latitude;
                userLng = position.coords.longitude;
                console.log(`User Location: Latitude ${userLat}, Longitude ${userLng}`); // Debugging

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
                const toggleButton = document.getElementById('toggleActivations');
                if (toggleButton && toggleButton.classList.contains('active')) {
                    console.log("Toggle is active. Displaying activations on load."); // Debugging
                    await updateActivationsInView(); // Display activations immediately
                    displayCallsign();
                } else {
                    // Display all parks without highlighting activations
                    if (map.activationsLayer) {
                        map.activationsLayer.clearLayers();
                        console.log("Cleared activationsLayer."); // Debugging
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
 * Optimizes Leaflet controls and popups for better mobile experience.
 */
function optimizeLeafletControlsAndPopups() {
    const style = document.createElement('style');
    style.innerHTML = `
        /* Adjust Leaflet Controls for Mobile */
        .leaflet-control-attribution {
            font-size: 12px;
        }

        .leaflet-control {
            font-size: 16px; /* Increase control sizes */
        }

        /* Adjust popup font sizes for better readability on mobile */
        .leaflet-popup-content {
            font-size: 16px;
            line-height: 1.5;
        }

        /* Ensure links are easily tappable */
        .leaflet-popup-content a {
            font-size: 16px;
            text-decoration: underline;
        }

        /* Ensure images or other media within popups are responsive */
        .leaflet-popup-content img {
            max-width: 100%;
            height: auto;
        }

        /* Adjust tooltip styles for mobile */
        .custom-tooltip {
            font-size: 14px;
            padding: 8px;
        }

        @media (min-width: 601px) {
            .custom-tooltip {
                font-size: 12px;
                padding: 5px;
            }
        }
    `;
    document.head.appendChild(style);
    console.log("Leaflet controls and popups optimized for mobile."); // Debugging
}

// Call the optimization function
optimizeLeafletControlsAndPopups();

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
    const toggleButton = document.getElementById('toggleActivations');
    if (toggleButton && toggleButton.classList.contains('active')) {
        activatedReferences = activations.map(act => act.reference);
        console.log("Activated References in Refresh:", activatedReferences); // Debugging
    }
    // Display parks with the current activations
    displayParksOnMap(map, parks, activatedReferences, map.activationsLayer);
    console.log("Displayed activated parks (if any) based on refresh."); // Debugging
}

/**
 * Adds CSS styles for the hamburger menu and other responsive elements.
 * (Already incorporated into the enhanceHamburgerMenuForMobile function)
 */

/**
 * Ensure that the map container adjusts to viewport changes
 */
window.addEventListener('resize', debounce(() => {
    if (map) {
        map.invalidateSize();
        console.log("Map size invalidated on window resize."); // Debugging
    }
}, 300));
