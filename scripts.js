// Initialize global variables
let activations = [];
let map; // Leaflet map instance
let parks = []; // Global variable to store parks data
let userLat = null;
let userLng = null;
// Declare a global variable to store current search results
let currentSearchResults = [];
let previousMapState = {
    bounds: null,
    displayedParks: [],
};
let activationToggleState = 0; // 0: Show all, 1: Show my activations, 2: Remove my activations
let spots = []; //holds spot info
const appVersion = "20250412"; // manually update as needed

/**
 * Ensures that the DOM is fully loaded before executing scripts.
 */
document.addEventListener('DOMContentLoaded', async () => {
    initializeMenu(); // Set up the menu
    setupPOTAMap(); // Set up the map
    await initializeActivationsDisplay(); // Check and display activations if available
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
                    <button id="uploadActivations" title="Download your activations from your POTA.app Stats page, upper right corner, then upload it here.">Upload Activations File</button>
                    <input type="file" id="fileUpload" accept=".csv, text/csv" style="display:none;" />
                </li>
                <li>
                    <button id="toggleActivations" class="toggle-button">Show My Activations</button>
                </li>
                <li id="searchBoxContainer">
                    <!-- <label for="searchBox">Search Parks:</label> -->
                    <input type="text" id="searchBox" placeholder="Search name, ID, location..." />
                    <br/>
                    <button id="clearSearch" title="Clear Search" aria-label="Clear Search">Clear Search</button>
                </li>
                <li>
                    <button id="centerOnGeolocation" title="Center the map based on your current location.">Center on My Location</button>
                </li>

                <li>
                <button id="potaNewsButton" onclick="window.open('https://pota.review', '_blank')">Visit POTA News & Review</button>
            </li>
            <!-- Removing slider functionality for now, it doesn't seem useful (also listener))
<div id="activationSliderContainer">
    <label for="activationSlider">Maximum Activations to Display:</label>
    <input
        type="range"
        id="activationSlider"
        min="0"
        max="100"
        value="10"
        data-value="10"
    />
</div>
-->
<li>
<div id="versionInfo" style="font-size: 0.75em; color: #888; margin-top: 1em;"></div>
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

    // Add event listeners for the search box
    document.getElementById('searchBox').addEventListener('input', debounce(handleSearchInput, 300));
    document.getElementById('clearSearch').addEventListener('click', clearSearchInput);

    // Add event listener for 'Enter' key in the search box
    document.getElementById('searchBox').addEventListener('keydown', handleSearchEnter);

    //Removing slider functionality for now, it doesn't seem useful
    // Add event listener for the activation slider
    //document.getElementById('activationSlider').addEventListener('input', handleSliderChange);
    // document.getElementById('activationSlider').addEventListener('input', (event) => {
    //     const slider = event.target;
    //     const sliderValue = slider.value === "51" ? "All" : slider.value;
    //     slider.setAttribute('data-value', sliderValue);
    // });
    //Listener for Activations button
    document.getElementById('toggleActivations').addEventListener('click', toggleActivations);

    document.getElementById('centerOnGeolocation').addEventListener('click', centerMapOnGeolocation);

    console.log("Hamburger menu initialized."); // Debugging

    // Add enhanced hamburger menu styles for mobile
    enhanceHamburgerMenuForMobile();

    displayVersionInfo();

}

async function displayVersionInfo() {
//    const appVersion = "20250408"; // manually update as needed

    let parksDate = "unknown";
    let changesDate = "unknown";

    try {
        const parksResponse = await fetch("/potamap/data/allparks.json", { method: 'HEAD' });
        const parksHeader = parksResponse.headers.get("last-modified");
        if (parksHeader) {
            parksDate = formatAsYYYYMMDD(new Date(parksHeader));
        }
    } catch (e) {
        console.warn("Could not fetch allparks.json HEAD:", e);
    }

    try {
        const changesResponse = await fetch("/potamap/data/changes.json", { method: 'HEAD' });
        const changesHeader = changesResponse.headers.get("last-modified");
        if (changesHeader) {
            changesDate = formatAsYYYYMMDD(new Date(changesHeader));
        }
    } catch (e) {
        console.warn("Could not fetch changes.json HEAD:", e);
    }

    const versionString = `<center>App-${appVersion} <br/> Parks-${parksDate} <br/>Delta-${changesDate}</center>`;
    document.getElementById("versionInfo").innerHTML = versionString;
}

function formatAsYYYYMMDD(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}${m}${d}`;
}

function enhancePOTAMenuStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
        #hamburgerMenu {
    position: absolute;
    top: 10px;
    right: 10px; /* Keep it positioned to the right */
    z-index: 1000;
    width: auto; /* Allow the width to adapt to the content */
    max-width: 350px; /* Set a reasonable maximum width */
    min-width: 250px; /* Prevent it from being too narrow */
    box-sizing: border-box; /* Include padding and border in width calculations */
    /* background-color: #ffffff;  Add a background color for visibility */
    border-radius: 8px; /* Slightly rounded corners for aesthetics */
    /* box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);  Add a subtle shadow */
    padding: 10px; /* Add padding to give the content breathing room */
}

#menu {
    display: none;
    list-style: none;
    margin: 0;
    padding: 0;
    position: absolute;
    right: 0; /* Ensure alignment with the right edge */
    width: 200px; /* Adjust width as needed */
    max-width: 100%; /* Prevent it from overflowing */
    box-sizing: border-box;
    background-color: #ffffff;
    border: 1px solid #ccc; /* Add a border for clarity */
    border-radius: 8px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
}

#menuToggle {
    display: flex;
    flex-direction: column;
    align-items: flex-end; /* Align toggle to the right */
    cursor: pointer;
    user-select: none;
}

#menuToggle input[type="checkbox"]:checked ~ #menu {
    display: block; /* Show the menu when the checkbox is checked */
}

#menuToggle label span {
    background: #333;
    height: 3px;
    margin: 4px 0;
    width: 25px;
    transition: all 0.3s ease;
    display: block;
}

        /* Hide the checkbox */
        #menuToggle input[type="checkbox"] {
            display: none;
        }

        /* Hamburger Lines */
        #menuToggle label span {
            background: #336633; /* Forest green */
            height: 4px;
            margin: 4px 0;
            width: 30px;
            transition: all 0.3s ease;
            display: block;
        }

        /* Menu Styling */
        #menu {
            display: none;
            list-style: none;
            padding: 10px;
            background: #f8f8f2; /* Light parchment */
            border: 2px solid #336633; /* Forest green border */
            position: absolute;
            top: 35px;
            left: 0;
            width: 260px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
            border-radius: 8px;
        }

        #menuToggle input[type="checkbox"]:checked ~ #menu {
            display: block;
        }

        /* Animate Hamburger to "X" */
        #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(1) {
            transform: translateY(8px) rotate(45deg);
        }

        #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(2) {
            opacity: 0;
        }

        #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(3) {
            transform: translateY(-8px) rotate(-45deg);
        }

        /* Menu Items */
        #menu li {
            margin: 10px 0;
        }

        /* Buttons */
        button {
            cursor: pointer;
            background: #336633; /* Forest green */
            color: #fff;
            border: none;
            padding: 10px;
            font-size: 16px;
            width: 100%;
            border-radius: 6px;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        button:hover {
            background: #264d26; /* Darker green */
            transform: translateY(-2px);
        }

/* Container for Slider */
.sliderWrapper {
    position: relative;
    width: 100%;
}
/* Style the slider container to position relative for proper placement */
#activationSliderContainer {
    position: relative;
    margin-bottom: 20px; /* Adjust spacing as needed */
}

/* Style for the slider */
#activationSlider {
    -webkit-appearance: none;
    width: 100%;
    height: 8px;
    border-radius: 4px;
    background: #d3d3d3;
    outline: none;
    transition: background 0.3s ease;
}

#activationSlider::before {
    content: attr(data-value); /* Display the slider value */
    position: absolute;
    top: 30px; /* Adjust to place below the slider */
    left: 50%; /* Center horizontally */
    transform: translateX(-50%); /* Adjust for tooltip alignment */
    font-size: 14px;
    color: #333;
    background: #fff;
    padding: 5px;
    border: 1px solid #ccc;
    border-radius: 4px;
    white-space: nowrap;
    z-index: 9999;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}


/* Adjust the position dynamically for better centering */
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

#activationSlider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #007BFF;
    cursor: pointer;
    transition: background 0.3s ease, transform 0.2s ease;
}

#sliderTooltip {
    position: absolute;
    background: #336633;
    color: #fff;
    font-size: 12px;
    font-weight: bold;
    padding: 4px 8px;
    border-radius: 4px;
    transform: translate(-50%, -150%);
    white-space: nowrap;
    z-index: 9999; /* Ensure it's above other elements */
    display: none; /* Hidden until interaction */
}


#sliderTooltip::after {
    content: '';
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    border-width: 6px;
    border-style: solid;
    border-color: #336633 transparent transparent transparent;
}

        /* Responsive Adjustments */
        @media (max-width: 600px) {
            #menu {
                width: 200px;
            }

            button {
                font-size: 14px;
                padding: 8px;
            }
        }
    `;
    document.head.appendChild(style);
    console.log("Enhanced POTA menu styles applied.");
}

document.addEventListener('DOMContentLoaded', () => {
    enhancePOTAMenuStyles();
});

/**
 * Enhances the hamburger menu's responsiveness, touch-friendliness, and styles the activation slider.
 */
function enhanceHamburgerMenuForMobile() {
    const style = document.createElement('style');
    style.innerHTML = `
       @media (max-width: 600px) {
    #hamburgerMenu {
        top: 5px;
        right: 5px;
        max-width: 200px; /* Reduce the width slightly on small screens */
    }

    #menu {
        width: 150px;
    }
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
            
            #centerOnGeolocation {
    cursor: pointer;
    background: #336633; /* Forest green */
    color: #fff;
    border: none;
    padding: 10px;
    font-size: 16px;
    width: 100%;
    border-radius: 6px;
    transition: background 0.3s ease, transform 0.2s ease;
}

#centerOnGeolocation:hover {
    background: #264d26; /* Darker green */
    transform: translateY(-2px);
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
/* Container for the search box and clear button */
#searchBoxContainer {
    position: relative;
    width: 100%; /* Constrain to parent width */
    box-sizing: border-box;
    margin-bottom: 10px;
    z-index: 10;
}

#searchBox {
    width: 100%;
    padding: 10px;
    font-size: 16px;
    border: 1px solid #ccc;
    border-radius: 4px;
    outline: none;
    box-sizing: border-box; /* Include padding in width */
    margin-bottom: 10px; /* Add spacing between input and button */
}

#clearSearch {
    display: block; /* Make it behave as a block element */
    width: 100%; /* Full width for alignment */
    padding: 10px;
    font-size: 16px; /* Adjust font size */
    color: #fff; /* Text color */
    background-color: #336633; /* Forest green background */
    border: none; /* Remove border */
    border-radius: 4px; /* Round edges */
    cursor: pointer;
    text-align: center; /* Center-align text */
    transition: background-color 0.3s ease, transform 0.2s ease; /* Add hover/active effects */
}

#clearSearch:hover {
    background-color: #264d26; /* Darker green background on hover */
    transform: scale(1.02); /* Slightly enlarge on hover */
}

#clearSearch:active {
    transform: scale(0.98); /* Slightly shrink when clicked */
}

/* Make the search box and button responsive */
@media (max-width: 600px) {
    #searchBox {
        font-size: 14px;
    }

    #clearSearch {
        font-size: 16px;
        height: 36px;
        width: 36px;
    }
}

#clearSearch:active {
    transform: translateY(-50%) scale(1.2);
}

/* Icon Styling */
#clearSearch i {
    pointer-events: none; /* Prevent icon from blocking button clicks */
    color: inherit;
}

/* Responsive Styles for Search Box */
@media (max-width: 600px) {
    #searchBoxContainer label {
        font-size: 18px;
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
 * Fetches *all* activations for a specific park from the POTA API,
 * with *no* caching in IndexedDB.
 * @param {string} reference - The park reference code (e.g. "K-1234").
 * @returns {Promise<Array>} Array of activation objects from the API.
 */
async function fetchParkActivations(reference) {
    // Always fetch from the POTA API, no cache check
    const url = `https://api.pota.app/park/activations/${reference}?count=all`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch activations for park ${reference}: ${response.statusText}`);
        }
        const data = await response.json();
        console.log(`Fetched ${data.length} activations for park ${reference} from API.`);

        // Return the fresh data
        return data;
    } catch (error) {
        console.error(error);
        // Return empty array if fetch fails
        return [];
    }
}


/**
 * Formats a QSO date string into a human‑readable date.
 * If the date contains a dash, it is assumed to be in ISO format.
 * Otherwise, it is assumed to be in YYYYMMDD format.
 *
 * @param {string} qsoDate - The QSO date string.
 * @returns {string} The formatted date.
 */
function formatQsoDate(qsoDate) {
    let date;
    if (qsoDate.includes("-")) {
        // Date is already in ISO format (e.g., "2025-01-10")
        date = new Date(qsoDate);
    } else {
        // Date is in YYYYMMDD format (e.g., "20250110")
        const year = qsoDate.substring(0, 4);
        const month = qsoDate.substring(4, 6);
        const day = qsoDate.substring(6, 8);
        date = new Date(`${year}-${month}-${day}`);
    }
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
// async function saveParksToIndexedDB(parks) {
//     const db = await getDatabase();
//     const transaction = db.transaction('parks', 'readwrite');
//     const store = transaction.objectStore('parks');
//
//     // Clear existing parks to prevent duplicates
//    // store.clear();
//
//     return new Promise((resolve, reject) => {
//         parks.forEach(park => {
//             store.put(park);
//         });
//
//         transaction.oncomplete = () => {
//             console.log('Parks saved successfully to IndexedDB.');
//             resolve();
//         };
//
//         transaction.onerror = (event) => {
//             console.error('Error saving parks to IndexedDB:', event.target.error);
//             reject(event.target.error);
//         };
//     });
// }

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

async function toggleActivations() {
    const toggleButton = document.getElementById('toggleActivations');

    // Cycle through states: 0 -> 1 -> 2 -> 3 -> back to 0
    activationToggleState = (activationToggleState + 1) % 4;

    // Update button text for clarity
    const buttonTexts = [
        "Show My Activations",
        "Hide My Activations",
        "Show Currently On Air",
        "Show All Spots",
    ];
    toggleButton.innerText = buttonTexts[activationToggleState];
    console.log(`Toggled activation state: ${activationToggleState}`);

    // Clear activationsLayer before updating map
    if (map.activationsLayer) {
        map.activationsLayer.clearLayers();
    } else {
        map.activationsLayer = L.layerGroup().addTo(map);
    }

    const userActivatedReferences = activations.map((act) => act.reference);

    switch (activationToggleState) {
        case 0: // Show all spots
            displayParksOnMap(map, parks, userActivatedReferences, map.activationsLayer);
            break;

        case 1: // Show just user's activations
            const userActivatedParks = parks.filter((park) =>
                userActivatedReferences.includes(park.reference)
            );
            displayParksOnMap(map, userActivatedParks, userActivatedReferences, map.activationsLayer);
            break;

        case 2: // Show all spots except user's activations
            const nonUserActivatedParks = parks.filter((park) =>
                !userActivatedReferences.includes(park.reference)
            );
            displayParksOnMap(map, nonUserActivatedParks, [], map.activationsLayer);
            break;

        case 3: // Show only currently active parks (on air)
            const onAirReferences = spots.map((spot) => spot.reference);
            const onAirParks = parks.filter((park) =>
                onAirReferences.includes(park.reference)
            );
            displayParksOnMap(map, onAirParks, userActivatedReferences, map.activationsLayer);
            break;

        default:
            console.error("Invalid activation state.");
            break;
    }
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
 * Maps the slider's linear value (0-100) to the desired non-linear scale.
 * @param {number} value - The linear slider value (0-100).
 * @returns {number|string} The mapped value ('All' for the maximum).
 */
function mapSliderValue(value) {
    if (value <= 33) {
        // Map the first third (0–33) to 0–10
        return Math.round((value / 33) * 10);
    } else if (value <= 66) {
        // Map the middle third (34–66) to 11–50
        return Math.round(11 + ((value - 33) / 33) * 39);
    } else {
        // Map the last third (67–100) to 51–All
        const mappedValue = Math.round(51 + ((value - 66) / 34) * 948); // Maps 67-100 to 51-999
        return mappedValue >= 999 ? 'All' : mappedValue;
    }
}

/**
 * Handles changes to the activation slider.
 * @param {Event} event - The input event from the slider.
 */
function handleSliderChange(event) {
    const slider = event.target;
    const linearValue = parseInt(slider.value, 10);
    const nonLinearValue = mapSliderValue(linearValue);

    // Update the slider's data-value attribute for display
    slider.setAttribute('data-value', nonLinearValue);

    console.log(`Slider Linear Value: ${linearValue}, Mapped Non-Linear Value: ${nonLinearValue}`);

    // Apply filtering logic
    if (nonLinearValue === 'All') {
        displayParksOnMap(map, parks, activations.map((act) => act.reference), map.activationsLayer);
    } else {
        const filteredParks = parks.filter((park) => park.activations <= nonLinearValue);
        const activatedReferences = activations.map((act) => act.reference);
        displayParksOnMap(map, filteredParks, activatedReferences, map.activationsLayer);
    }
}

/**
 * Centers the map on the user's current geolocation.
 */
function centerMapOnGeolocation() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;

            if (map) {
                map.setView([latitude, longitude], 12, {
                    animate: true,
                    duration: 1.5, // Smooth animation to the location
                });
                console.log(`Map centered on user location: [${latitude}, ${longitude}]`);
            } else {
                console.error("Map instance is not initialized.");
            }
        },
        (error) => {
            console.error("Geolocation error:", error.message);
            switch (error.code) {
                case error.PERMISSION_DENIED:
                    alert("Permission to access location was denied.");
                    break;
                case error.POSITION_UNAVAILABLE:
                    alert("Location information is unavailable.");
                    break;
                case error.TIMEOUT:
                    alert("Request to get user location timed out.");
                    break;
                default:
                    alert("An unknown error occurred while retrieving your location.");
                    break;
            }
        }
    );
}

/**
 * Handles input in the search box and dynamically highlights matching parks within the visible map bounds.
 * @param {Event} event - The input event from the search box.
 */
function handleSearchInput(event) {
    const query = normalizeString(event.target.value);
    console.log(`Search query received: "${query}"`); // Debugging

    // Clear previous highlights
    if (map.highlightLayer) {
        map.highlightLayer.clearLayers();
    } else {
        map.highlightLayer = L.layerGroup().addTo(map);
    }

    // Save the map's state before searching (only once)
    if (query && !previousMapState.bounds) {
        previousMapState = {
            bounds: map.getBounds(),
            displayedParks: [...parks], // Save the currently displayed parks
        };
        console.log("Saved map state before search:", previousMapState); // Debugging
    }

    if (query === '') {
        // If the search box is empty, reset the park display based on current filters
        currentSearchResults = [];
        resetParkDisplay();
        return;
    }

    // Get current map bounds
    const bounds = getCurrentMapBounds();

    // Filter parks within the visible map bounds based on the search query
    const filteredParks = parks.filter(park => {
        const isWithinBounds =
            park.latitude && park.longitude && bounds.contains([park.latitude, park.longitude]);
        return (
            isWithinBounds &&
            (normalizeString(park.name).includes(query) ||
                normalizeString(park.reference).includes(query))
        );
    });

    console.log(`Parks matching search within bounds: ${filteredParks.length}`); // Debugging

    // Update the global search results
    currentSearchResults = filteredParks;

    // Highlight matching parks dynamically
    filteredParks.forEach((park, index) => {
        const markerSize = index === 0 ? 20 : 15; // Larger size for the top result
        const markerColor = index === 0 ? "#ff6600" : "#ffa500"; // Different color for emphasis

        const highlightMarker = L.circleMarker([park.latitude, park.longitude], {
            radius: markerSize,
            fillColor: markerColor,
            color: "#000",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(map.highlightLayer);

        highlightMarker.bindTooltip(`${park.name} (${park.reference})`, {
            direction: "top",
            className: "custom-tooltip"
        });

        // Optionally bind the full popup content
        highlightMarker.on('click', async () => {
            const popupContent = await fetchFullPopupContent(park);
            highlightMarker.bindPopup(popupContent).openPopup();
        });
    });

    // If there is a single match, zoom to it
    if (filteredParks.length === 1) {
        zoomToPark(filteredParks[0]);
    }
}

/**
 * Handles the 'Enter' key press in the search box to zoom to the searched park(s).
 * @param {KeyboardEvent} event - The keyboard event triggered by key presses.
 */
function handleSearchEnter(event) {
    if (event.key === 'Enter') {
        event.preventDefault(); // Prevent form submission or other default actions
        console.log("'Enter' key pressed in search box."); // Debugging

        // Ensure the search box has a value
        const searchBox = document.getElementById('searchBox');
        if (!searchBox || !searchBox.value.trim()) {
            console.warn("Search box is empty. No action taken."); // Debugging
            return;
        }

        // Search for parks matching the input query
        const query = normalizeString(searchBox.value.trim());
        console.log(`Searching for parks matching: "${query}"`); // Debugging

        if (currentSearchResults.length > 0) {
            if (currentSearchResults.length === 1) {
                // If only one park matches, center and zoom to it
                const park = currentSearchResults[0];
                zoomToPark(park);
            } else {
                // If multiple parks match, fit the map bounds to include all
                zoomToParks(currentSearchResults);
            }
        } else {
            // Handle "Go To Park" functionality for the global dataset
            const matchingPark = parks.find(park =>
                normalizeString(park.name).includes(query) ||
                normalizeString(park.reference).includes(query)
            );

            if (matchingPark) {
                zoomToPark(matchingPark);
            } else {
                // Display message only if no matches are found after searching
                alert('No parks found matching your search criteria.');
            }
        }
    }
}

/**
 * Zooms the map to a single park's location and shows its full information popup,
 * including current activation details, as if clicked by the user.
 * @param {Object} park - The park object to zoom into (must have .latitude, .longitude).
 */
async function zoomToPark(park) {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    const { latitude, longitude } = park;
    if (!latitude || !longitude) {
        console.warn("Park has no valid coordinates:", park.reference);
        return;
    }

    // Zoom in closer
    const currentZoom = map.getZoom();
    const maxZoom = map.getMaxZoom();
    const newZoomLevel = Math.min(currentZoom + 2, maxZoom); // or pick any desired zoom
    map.setView([latitude, longitude], newZoomLevel, {
        animate: true,
        duration: 1.5, // animation in seconds
    });
    console.log(`Zoomed to park [${latitude}, ${longitude}] - ${park.reference}.`);

    // Close the hamburger menu (if open)
    const menuCheckbox = document.getElementById('menuCheckbox');
    if (menuCheckbox && menuCheckbox.checked) {
        menuCheckbox.checked = false;
        console.log("Hamburger menu closed.");
    }

    // 1) Try to find the existing marker in map activations/spots layers
    //    We'll assume your "parks" go in map.activationsLayer, but if spots are separate, check map.spotsLayer too.
    let foundMarker = null;

    // If you have a single group for parks:
    if (map.activationsLayer) {
        map.activationsLayer.eachLayer((layer) => {
            // If it's a circleMarker, check if it belongs to the park
            // For your code, you might store the park reference in layer.options or layer.parkReference
            // or match lat/long. For instance:
            if (layer.getLatLng) {
                const latLng = layer.getLatLng();
                if (latLng.lat === park.latitude && latLng.lng === park.longitude) {
                    foundMarker = layer;
                }
            }
        });
    }

    // If you also keep "spot" markers in map.spotsLayer, you might do the same loop there:
    if (!foundMarker && map.spotsLayer) {
        map.spotsLayer.eachLayer((layer) => {
            if (layer.getLatLng) {
                const latLng = layer.getLatLng();
                if (latLng.lat === park.latitude && latLng.lng === park.longitude) {
                    foundMarker = layer;
                }
            }
        });
    }

    // 2) If we found an existing marker, open its popup so it triggers the normal "popupopen" logic
    if (foundMarker) {
        // Ensure the popup is bound (it should be, from your displayParksOnMap or fetchAndDisplaySpots function)
        if (foundMarker._popup) {
            // This will automatically trigger the 'popupopen' event if you have it set
            foundMarker.openPopup();
            console.log(`Opened popup for existing marker of park ${park.reference}.`);
        } else {
            console.warn(`Marker has no bound popup for ${park.reference}.`);
        }
    } else {
        console.warn(`No existing marker found for park ${park.reference}.`);
        // Optionally, create a *temporary* marker if you like
        // ...
    }
}

/**
 * Fetches the full popup content for a park, including recent activations,
 * plus optionally showing "current activation" (spot) details if provided.
 *
 * @param {Object} park - The park object containing its details.
 *   e.g. { reference: "K-1234", name: "Some Park", latitude: 12.345, longitude: -98.765, ... }
 * @param {Object} [currentActivation] - Optional activation/spot details
 *   (e.g. { activator, frequency, mode, comments }).
 * @returns {Promise<string>} The full popup HTML content.
 */
async function fetchFullPopupContent(park, currentActivation = null, parkActivations = null) {
    const { reference, name, latitude, longitude } = park;

    // Generate POTA.app link
    const potaAppLink =
        `<a href="https://pota.app/#/park/${reference}" target="_blank" rel="noopener noreferrer">
         <b>${name} (${reference})</b>
       </a>`.trim();

    // Generate "Get Directions" link if user location is available
    const directionsLink =
        userLat !== null && userLng !== null
            ? `<a href="https://www.google.com/maps/dir/?api=1&origin=${userLat},${userLng}&destination=${latitude},${longitude}&travelmode=driving"
                 target="_blank" rel="noopener noreferrer">Get Directions</a>`
            : '';

    // Use passed-in activations or fetch fresh
    if (!parkActivations) {
        try {
            parkActivations = await fetchParkActivations(reference);
            await saveParkActivationsToIndexedDB(reference, parkActivations);
        } catch (err) {
            console.warn(`Unable to fetch activations for ${reference}:`, err);
            parkActivations = [];
        }
    }

    // Start building popup content
    const activationCount = parkActivations.length;
    let popupContent = `${potaAppLink}<br>Activations: ${activationCount}`;
    if (directionsLink) popupContent += `<br>${directionsLink}`;

    if (parkActivations.length > 0) {
        const cwTotal = parkActivations.reduce((sum, act) => sum + (act.qsosCW || act.cw || 0), 0);
        const phoneTotal = parkActivations.reduce((sum, act) => sum + (act.qsosPHONE || act.phone || 0), 0);
        const dataTotal = parkActivations.reduce((sum, act) => sum + (act.qsosDATA || act.data || 0), 0);

        const recentActivations = parkActivations
            .sort((a, b) => {
                const dateA = parseInt(a.qso_date || a.date || '0', 10);
                const dateB = parseInt(b.qso_date || b.date || '0', 10);
                return dateB - dateA;
            })
            .slice(0, 3)
            .map((act) => {
                const dateStr = formatQsoDate(act.qso_date || act.date);
                const total = act.totalQSOs || act.total || 0;
                const callsign = act.activeCallsign || act.callsign || 'Unknown';
                return `${callsign} on ${dateStr} (${total} QSOs)`;
            })
            .join('<br>') || 'No recent activations.';

        popupContent += `
        <br><br><b>Total QSOs (All Activations):</b><br>
        CW: ${cwTotal} &nbsp;|&nbsp; PHONE: ${phoneTotal} &nbsp;|&nbsp; DATA: ${dataTotal}
        <br><br><b>Recent Activations:</b><br>${recentActivations}`;
    }

    if (currentActivation) {
        const { activator, frequency, mode, comments } = currentActivation;
        popupContent += `
            <br><br><b>Current Activation:</b><br>
            <b>Activator:</b> ${activator}<br>
            <b>Frequency:</b> ${frequency} kHz<br>
            <b>Mode:</b> ${mode}<br>
            <b>Comments:</b> ${comments || 'N/A'}`;
    }

    return popupContent.trim();
}

/**
 * Zooms the map to fit all searched parks within the view and increases the zoom level by one.
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
    map.fitBounds(bounds, {
        padding: [50, 50], // Padding in pixels
        animate: true,
        duration: 1.5 // Duration in seconds for the animation
    });

    console.log(`Zoomed to fit ${parks.length} parks within the view.`); // Debugging

    // After fitting bounds, increase the zoom level by one
    map.once('moveend', function() {
        const currentZoom = map.getZoom();
        const maxZoom = map.getMaxZoom();
        const newZoomLevel = Math.min(currentZoom + 1, maxZoom);
        map.setZoom(newZoomLevel, {
            animate: true,
            duration: 1.0 // Duration in seconds for the zoom animation
        });
        console.log(`Increased zoom level to ${newZoomLevel}.`); // Debugging
    });

    // Optionally, open popups for all filtered parks
    parks.forEach(park => {
        map.activationsLayer.eachLayer(layer => {
            const layerLatLng = layer.getLatLng();
            if (layerLatLng.lat === park.latitude && layerLatLng.lng === park.longitude) {
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
 * Filters and displays parks based on the maximum number of activations.
 * @param {number} maxActivations - The maximum number of activations to display.
 */
function filterParksByActivations(maxActivations) {
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
            return bounds.contains(latLng) && park.activations <= maxActivations;
        }
//        console.warn(`Invalid park data for reference: ${park.reference}`); // Debugging
        return false;
    });

    console.log("Parks in Current View with Activations <= max:", parksInBounds); // Debugging

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
       // console.warn(`Invalid park data for reference: ${activation.reference}`); // Debugging
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

    //Make sure we have current data in order to pick up .changed field
    const allParks = await getAllParksFromIndexedDB();
    const parksInBounds = allParks.filter(park => {

        if (park.latitude && park.longitude) {
            const latLng = L.latLng(park.latitude, park.longitude);
            return bounds.contains(latLng);
        }
       // console.warn(`Invalid park data for reference: ${park.reference}`); // Debugging
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
function clearSearchInput() {
    const searchBox = document.getElementById('searchBox');
    if (searchBox) {
        searchBox.value = ''; // Clear the input
        console.log("Search input cleared."); // Debugging
    }

    // Clear highlights and reset the map view
    if (map.highlightLayer) {
        map.highlightLayer.clearLayers();
    }

    if (previousMapState.bounds) {
        // Restore the previous map bounds
        map.fitBounds(previousMapState.bounds);

        // Display the previously shown parks
        const activatedReferences = activations.map((act) => act.reference);
        displayParksOnMap(map, previousMapState.displayedParks, activatedReferences, map.activationsLayer);

        console.log("Map view restored to prior state."); // Debugging

        // Clear the saved state
        previousMapState = { bounds: null, displayedParks: [] };
    }
}

/**
 * Adds event listeners to the search box and Clear button.
 */
function setupSearchBoxListeners() {
    const searchBox = document.getElementById('searchBox');
    const clearButton = document.getElementById('clearSearch');

    if (!searchBox || !clearButton) {
        console.error("Search box or Clear button not found.");
        return;
    }

    // Show the Clear button only when there is input
    searchBox.addEventListener('input', () => {
        if (searchBox.value.trim() !== '') {
            clearButton.style.display = 'block';
        } else {
            clearButton.style.display = 'none';
        }
    });

    // Attach the Clear button functionality
    clearButton.addEventListener('click', clearSearchInput);
}

// Call the setup function when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    setupSearchBoxListeners();
    console.log("Search box listeners initialized."); // Debugging
});

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
 * Initializes and displays activations on startup.
 * If activations exist in the local store, this function attempts to update them
 * by fetching data from the API at https://pota.app/#/user/activations.
 */
async function initializeActivationsDisplay() {
    try {
        const storedActivations = await getActivationsFromIndexedDB();
        if (storedActivations.length > 0) {
            // Set the toggle button to active if activations exist.
            const toggleButton = document.getElementById('toggleActivations');
            if (toggleButton) {
                toggleButton.classList.add('active');
                console.log("Activations exist in IndexedDB. Enabling 'Show My Activations' by default.");
            }

            // Load stored activations.
            activations = storedActivations;

            // If we have stored activations (and by extension a valid callsign), try updating from the API.
//            await updateUserActivationsFromAPI();
            // await updateActivationsFromScrape();
            // Refresh the map view and display the user's callsign.
            updateActivationsInView();
            displayCallsign();
        } else {
            console.log("No activations found in IndexedDB. Starting with default view.");
        }
    } catch (error) {
        console.error('Error initializing activations display:', error);
    }
}

async function updateUserActivationsFromAPI() {
    try {
        // Correct endpoint returning JSON.
        const apiUrl = 'https://api.pota.app/#/user/activations?all=1';

        // Fetch using credentials so that cookies are sent
        const response = await fetch(apiUrl, {
            credentials: 'include', // Include cookies and credentials in cross-origin requests.
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
                // If needed, you can add:
                // 'Authorization': `Bearer YOUR_TOKEN_HERE`
            }
        });

        // Parse the JSON response.
        const apiData = await response.json();
        console.log("Fetched API activations:", apiData.activations);

        // Check if activations were returned.
        if (!apiData || !Array.isArray(apiData.activations) || apiData.activations.length === 0) {
            console.log("No activation data returned from API, skipping update.");
            return;
        }

        // Create a map keyed by 'reference' from existing activations.
        const activationMap = new Map();
        activations.forEach(act => {
            activationMap.set(act.reference, act);
        });

        // Merge each API activation into the map.
        apiData.activations.forEach(apiAct => {
            const reference = apiAct.reference.trim();
            const newActivation = {
                reference: reference,
                name: apiAct.name.trim(),
                qso_date: apiAct.date.trim(),  // e.g., "2025-01-10"
                activeCallsign: apiAct.callsign.trim(),
                totalQSOs: parseInt(apiAct.total, 10) || 0,
                qsosCW: parseInt(apiAct.cw, 10) || 0,
                qsosDATA: parseInt(apiAct.data, 10) || 0,
                qsosPHONE: parseInt(apiAct.phone, 10) || 0,
                attempts: parseInt(apiAct.total, 10) || 0,
                activations: parseInt(apiAct.total, 10) || 0,
            };

            if (activationMap.has(reference)) {
                const existingAct = activationMap.get(reference);
                activationMap.set(reference, {
                    ...existingAct,
                    ...newActivation,
                    // Optionally aggregate numeric values:
                    totalQSOs: existingAct.totalQSOs + newActivation.totalQSOs,
                    qsosCW: existingAct.qsosCW + newActivation.qsosCW,
                    qsosDATA: existingAct.qsosDATA + newActivation.qsosDATA,
                    qsosPHONE: existingAct.qsosPHONE + newActivation.qsosPHONE,
                    activations: existingAct.activations + newActivation.activations,
                });
                console.log(`Updated activation: ${reference}`);
            } else {
                activationMap.set(reference, newActivation);
                console.log(`Added new activation: ${reference}`);
            }
        });

        // Update the global activations array.
        activations = Array.from(activationMap.values());
        await saveActivationsToIndexedDB(activations);
        console.log("Successfully merged API activations into local store.");
    } catch (error) {
        console.error("Error fetching or merging user activations from API:", error);
    }
}

/**
 * Scrapes recent activations data from the returned HTML string.
 * Assumes that the table rows in the first table inside an element
 * with class "v-data-table__wrapper" contain the data.
 *
 * Each row is assumed to have these columns (in order):
 *  - Date (e.g. "01/09/2025")
 *  - Park (an <a> element whose href contains a reference like "#/park/US-0891" and text with the park name)
 *  - CW (a number)
 *  - Data (a number)
 *  - Phone (a number)
 *  - Total QSOs (a number)
 *
 * @param {string} html - The full HTML from the page.
 * @returns {Array<Object>} Array of activation objects.
 */
function scrapeActivationsFromHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    // Find the table that holds the activations.
    // Adjust this selector if needed.
    const table = doc.querySelector('.v-data-table__wrapper table');
    if (!table) {
        console.error('Activations table not found in HTML.');
        return [];
    }

    // Query all rows within the table body.
    const rows = Array.from(table.querySelectorAll('tbody > tr'));
    if (!rows.length) {
        console.warn('No rows found in the activations table.');
        return [];
    }

    // Map over each row to extract the data.
    const activations = rows.map(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 6) {
            // If for some reason there are not enough cells, skip this row.
            return null;
        }

        // Column indices:
        // 0: Date (assumed format "MM/DD/YYYY")
        // 1: Park information (contains an <a> tag with href and text)
        // 2: CW
        // 3: Data
        // 4: Phone
        // 5: Total QSOs
        const date = cells[0].textContent.trim();

        // Extract park reference from the <a> tag.
        let parkReference = '';
        let parkName = '';
        const parkAnchor = cells[1].querySelector('a');
        if (parkAnchor) {
            // Example href: "#/park/US-0891"
            const href = parkAnchor.getAttribute('href');
            const match = href.match(/\/park\/(.+)/);
            if (match) {
                parkReference = match[1].trim();
            }
            parkName = parkAnchor.textContent.trim();
        }

        const cw = parseInt(cells[2].textContent.trim(), 10) || 0;
        const dataVal = parseInt(cells[3].textContent.trim(), 10) || 0;
        const phone = parseInt(cells[4].textContent.trim(), 10) || 0;
        const totalQSOs = parseInt(cells[5].textContent.trim(), 10) || 0;

        // Return an object matching (or easily mappable to) your activation format.
        return {
            qso_date: date,  // if using qso_date everywhere
            reference: parkReference,
            name: parkName,
            callsign: '',
            totalQSOs: totalQSOs,  // Always use totalQSOs
            qsosCW: cw,
            qsosDATA: dataVal,
            qsosPHONE: phone
        };
    }).filter(item => item !== null);

    return activations;
}

/**
 * An example function that fetches the page containing the recent activations,
 * scrapes the activations from its HTML, and then merges them with your local data.
 *
 * You can call this function in place of, or in addition to, your API call.
 */
async function updateActivationsFromScrape() {
    try {
        // Replace with the URL of the page you want to scrape.
        const url = 'https://api.pota.app/#/user/activations?all=1';
        const response = await fetch(url, { credentials: 'include' });

        if (!response.ok) {
            throw new Error(`Failed to fetch activations page. Status: ${response.status}`);
        }

        const html = await response.text();
        console.log("Fetched HTML (first 300 chars):", html.substring(0, 300));

        // Scrape activations from the HTML.
        const scrapedActivations = scrapeActivationsFromHTML(html);
        console.log("Scraped activations:", scrapedActivations);

        // Merge scrapedActivations into your existing global 'activations' array.
        // For merging, we’ll build a map keyed by the activation reference.
        const activationMap = new Map();
        activations.forEach(act => {
            activationMap.set(act.reference, act);
        });

        scrapedActivations.forEach(scraped => {
            const ref = scraped.reference;
            if (activationMap.has(ref)) {
                // Merge the activation. Adjust merge logic as needed.
                const existing = activationMap.get(ref);
                activationMap.set(ref, {
                    ...existing,
                    ...scraped,
                    // Optionally combine numeric fields.
                    total: existing.total + scraped.total
                });
                console.log(`Merged scraped activation: ${ref}`);
            } else {
                activationMap.set(ref, scraped);
                console.log(`Added new scraped activation: ${ref}`);
            }
        });

        // Update the global array.
        activations = Array.from(activationMap.values());
        await saveActivationsToIndexedDB(activations);
        console.log("Successfully saved merged scraped activations.");
        updateActivationsInView();

    } catch (error) {
        console.error("Error updating activations from scrape:", error);
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
        attributionControl: true,
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
            iconUrl:
                "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
            iconSize: [30, 30], // Increased icon size for better visibility on mobile
            iconAnchor: [15, 30],
            popupAnchor: [0, -30],
        }),
    })
        .addTo(mapInstance)
//Remove initial popup
//        .bindPopup("Your Location")
//        .openPopup();

    console.log("Added user location marker."); // Debugging

    // Attach dynamic spot fetching to map movement
    mapInstance.on(
        "moveend",
        debounce(() => {
            console.log("Map moved or zoomed. Updating spots...");
            fetchAndDisplaySpotsInCurrentBounds(mapInstance);
        }, 300) // Debounce to reduce API calls
    );

    return mapInstance;
}


/**
 * Displays parks on the map.
 */
/**
 * Displays parks on the map with proper popups that include activation information.
 */
async function displayParksOnMap(map, parks, userActivatedReferences = null, layerGroup = map.activationsLayer) {
    console.log(`Displaying ${parks.length} parks on the map.`); // Debugging

    if (!layerGroup) {
        map.activationsLayer = L.layerGroup().addTo(map);
        layerGroup = map.activationsLayer;
        console.log("Created a new activations layer.");
    } else {
        console.log("Using existing activations layer.");
    }

    layerGroup.clearLayers(); // Clear existing markers before adding new ones

    parks.forEach((park) => {
        const { reference, name, latitude, longitude, activations: parkActivationCount, created } = park;
        const isUserActivated = userActivatedReferences.includes(reference);
        const isNew = (Date.now() - new Date(created).getTime()) <= (30 * 24 * 60 * 60 * 1000); // 30 days
        const currentActivation = spots?.find(spot => spot.reference === reference);
        const isActive = !!currentActivation;

        // Debugging
        if (isNew) {
            const delta = Date.now() - new Date(created).getTime();
            console.log(`Park ${reference} created: ${created}, delta: ${delta}, isNew: true`);
        }

        // Determine marker class for animated divIcon
        const markerClasses = [];
        if (isNew) markerClasses.push('pulse-marker');
        if (isActive) markerClasses.push('active-pulse-marker');
        const markerClassName = markerClasses.join(' ');

        const marker = markerClasses.length > 0
            ? L.marker([latitude, longitude], {
                icon: L.divIcon({
                    className: markerClassName,
                    iconSize: [20, 20],
                })
            })
            : L.circleMarker([latitude, longitude], {
                radius: 6,
                fillColor: isUserActivated
                    ? "#ffa500" // Orange
                    : parkActivationCount > 10
                        ? "#ff6666" // Light red
                        : parkActivationCount > 0
                            ? "#90ee90" // Light green
                            : "#0000ff", // Blue
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.9,
            });

        marker.park = park;
        marker.currentActivation = currentActivation;

        marker
            .addTo(layerGroup)
            .bindPopup("<b>Loading park info...</b>")
            .bindTooltip(
                `${reference}: ${name} (${parkActivationCount} activations)`,
                {
                    direction: "top",
                    opacity: 0.9,
                    sticky: false,
                    className: "custom-tooltip",
                }
            )
            .on('click', function () {
                this.closeTooltip();
            });

        marker.on('popupopen', async function () {
            try {
                parkActivations = await fetchParkActivations(reference);
                await saveParkActivationsToIndexedDB(reference, parkActivations);

                let popupContent = await fetchFullPopupContent(park, currentActivation, parkActivations);

                if (park.change) {
                    popupContent += `
                        <div style="font-size: 0.85em; font-style: italic; margin-top: 0.5em;">
                            <b>Recent change:</b> ${park.change}
                        </div>
                    `;
                }

                this.setPopupContent(popupContent);
            } catch (error) {
                console.error(`Error fetching activations for park ${reference}:`, error);
                this.setPopupContent("<b>Error loading park info.</b>");
            }
        });
    });

    console.log("All parks displayed with appropriate highlights.");
}

async function fetchAndCacheParks(jsonUrl, cacheDuration) {
    const db = await getDatabase();
    const now = Date.now();
    const lastFullFetch = await getLastFetchTimestamp('allparks.json');
    let parks = [];

    if (!lastFullFetch || (now - lastFullFetch > cacheDuration)) {
        console.log('Fetching full park data from JSON...');
        const response = await fetch(jsonUrl);
        if (!response.ok) throw new Error(`Failed to fetch park data: ${response.statusText}`);

        const parsed = await response.json();

        parks = parsed.map(park => ({
            reference: park.reference,
            name: park.name,
            latitude: parseFloat(park.latitude),
            longitude: parseFloat(park.longitude),
            activations: parseInt(park.activations, 10) || 0
        }));

        await upsertParksToIndexedDB(parks);
        await setLastFetchTimestamp('allparks.json', now);
    } else {
        console.log('Using cached full park data');
        parks = await getAllParksFromIndexedDB();
    }

    // Apply updates from changes.json
    try {
        const changesResponse = await fetchIfModified('/potamap/data/changes.json', 'changes.json');
        if (changesResponse && changesResponse.ok) {
            const changesData = await changesResponse.json();

            const updatedParks = changesData.map(park => {
                const isNew = park.change === 'Park added';

                return {
                    reference: park.reference,
                    name: park.name,
                    latitude: park.latitude,
                    longitude: park.longitude,
                    grid: park.grid,
                    locationDesc: park.locationDesc,
                    attempts: park.attempts,
                    activations: park.activations,
                    qsos: park.qsos,
                    created: isNew ? park.timestamp : undefined,
                    change: park.change
                };
            });

            console.log("Final updatedParks going to IndexedDB:", updatedParks);

            await upsertParksToIndexedDB(updatedParks);
            await setLastModifiedHeader('changes.json', changesResponse.headers.get('last-modified'));
            console.log('Applied updates from changes.json');
        } else {
            console.log('No new changes in changes.json');
        }
    } catch (err) {
        console.warn('Failed to apply park changes:', err);
    }

    const finalList = await getAllParksFromIndexedDB();
    console.log('finalList:', finalList, 'typeof:', typeof finalList, 'isArray:', Array.isArray(finalList));

    return finalList.map(park => {
        const created = new Date(park.created).getTime();
        return {
            ...park,
            new: (now - created) < 30 * 24 * 60 * 60 * 1000
        };
    });
}

function getFromStore(store, key) {
    return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}


async function upsertParksToIndexedDB(parks) {
    const db = await getDatabase();
    const tx = db.transaction('parks', 'readwrite');
    const store = tx.objectStore('parks');

    for (const park of parks) {
        const existing = await getFromStore(store, park.reference);

        const isTrulyNew = !existing;

        const merged = {
            ...existing,
            ...park,
            created: park.created || existing?.created || (isTrulyNew ? new Date().toISOString() : undefined)
        };


        console.log(`Merged ${park.reference}`, merged);
        store.put(merged);
    }

    return tx.complete;
}


async function getAllParksFromIndexedDB() {
    const db = await getDatabase();
    const transaction = db.transaction('parks', 'readonly');
    const store = transaction.objectStore('parks');

    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}


async function getLastFetchTimestamp(key) {
    return parseInt(localStorage.getItem(`lastFetch_${key}`), 10) || null;
}

async function setLastFetchTimestamp(key, timestamp) {
    localStorage.setItem(`lastFetch_${key}`, timestamp.toString());
}

async function fetchIfModified(url, key) {
    const response = await fetch('/potamap/data/changes.json', { cache: 'no-store' });
    const data = await response;
    console.log("Bypassed fetchIfModified — data:", data);
    return data;
}


async function setLastModifiedHeader(key, value) {
    if (value) {
        localStorage.setItem(`lastModified_${key}`, value);
    }
}


/**
 * Initializes the Leaflet map and loads park data from CSV using IndexedDB.
 */
async function setupPOTAMap() {
    const csvUrl = '/potamap/data/allparks.json';
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
                //ISSUE 16 display active parks on map load
                fetchAndDisplaySpots();
            },
            (error) => {
                console.error('Error getting location:', error.message);
                alert('Unable to retrieve your location.');
            }
        );
        console.log('XX Displaying active spots')
    } catch (error) {
        console.error('Error setting up POTA map:', error.message);
        alert('Failed to set up the POTA map. Please try again later.');
    }
}
/**
 * Fetches active POTA spots from the API and displays them on the map.
 */
async function fetchAndDisplaySpots() {
    const SPOT_API_URL = 'https://api.pota.app/v1/spots';
    try {
        const response = await fetch(SPOT_API_URL);
        if (!response.ok) throw new Error(`Error fetching spots: ${response.statusText}`);
        const spots = await response.json();

        console.log('Fetched spots data:', spots); // Debugging

        // Check if the map exists and spotsLayer is initialized
        if (!map) {
            console.error('Map instance is not initialized.');
            return;
        }

        // Initialize spotsLayer if it doesn't exist
        if (!map.spotsLayer) {
            console.log('Initializing spots layer...');
            map.spotsLayer = L.layerGroup().addTo(map);
        } else {
            console.log('Clearing existing spots layer...');
            map.spotsLayer.clearLayers();
        }

        // Add new spots to the map
        spots.forEach((spot) => {
            const { reference, latitude, longitude, name, activator, frequency, mode, comments } = spot;

            if (!latitude || !longitude) {
                console.warn(`Invalid coordinates for spot: ${JSON.stringify(spot)}`);
                return;
            }

            const markerStyle = {
                radius: 10,
                color: '#3366cc',
                fillColor: '#99ccff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8,
            };

            const marker = L.circleMarker([latitude, longitude], markerStyle)
                .addTo(map.spotsLayer);

            marker.bindTooltip(`${name} (${frequency} kHz)`, {
                direction: 'top',
                className: 'custom-tooltip',
            });

            marker.on('click', async function () {
                this.closeTooltip();

                const park = parks.find(p => p.reference === reference);
                if (!park) {
                    console.warn(`No park found for spot reference ${reference}`);
                    return;
                }

                const popupContent = await fetchFullPopupContent(park, spot);
                this.bindPopup(popupContent).openPopup();
            });
        });

        console.log(`Displayed ${spots.length} spots on the map.`);
    } catch (error) {
        console.error('Error fetching or displaying POTA spots:', error);
    }
}

/**
 * Fetches active POTA spots from the API, filters them to the current map bounds,
 * and displays them so that their popups show both park info + spot data.
 * Clicking on a spot now also closes any visible tooltip.
 */
async function fetchAndDisplaySpotsInCurrentBounds(mapInstance) {
    const SPOT_API_URL = "https://api.pota.app/v1/spots";
    try {
        const response = await fetch(SPOT_API_URL);
        if (!response.ok) throw new Error(`Error fetching spots: ${response.statusText}`);
        const spots = await response.json();

        console.log("Fetched spots data:", spots);

        if (!mapInstance.spotsLayer) {
            console.log("Initializing spots layer...");
            mapInstance.spotsLayer = L.layerGroup().addTo(mapInstance);
        } else {
            console.log("Clearing existing spots layer...");
            mapInstance.spotsLayer.clearLayers();
        }

        const bounds = mapInstance.getBounds();
        console.log("Current map bounds:", bounds);

        const spotsInBounds = spots.filter(({ latitude, longitude }) => {
            if (!latitude || !longitude) {
                console.warn("Invalid coordinates:", { latitude, longitude });
                return false;
            }
            return bounds.contains([latitude, longitude]);
        });

        console.log(`Displaying ${spotsInBounds.length} spots in current bounds.`);

        spotsInBounds.forEach((spot) => {
            const {
                reference,
                latitude,
                longitude,
                name,
                activator,
                frequency,
                mode,
                comments
            } = spot;

            const markerStyle = {
                radius: 10,
                color: "#3366cc",
                fillColor: "#99ccff",
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8,
            };
            const marker = L.circleMarker([latitude, longitude], markerStyle)
                .addTo(mapInstance.spotsLayer);

            marker.bindPopup(`<b>Loading park data...</b>`);
            marker.bindTooltip(`${name} (${activator} on ${frequency} kHz)`, {
                direction: "top",
                className: "custom-tooltip",
            });

            marker.on("click", function () {
                this.closeTooltip();
            });

            marker.on("popupopen", async () => {
                if (typeof marker.closeTooltip === "function") {
                    marker.closeTooltip();
                }

                const park = parks.find(p => p.reference === reference);
                if (!park) {
                    marker.setPopupContent("<b>No matching park found for this spot.</b>");
                    return;
                }

                try {
                    const popupHtml = await fetchFullPopupContent(park, spot);
                    // When popup opens, fetch all park activations and build the final popup
                    marker.on('popupopen', async function () {
                        try {
                            let parkActivations = await getParkActivationsFromIndexedDB(reference);
                            if (!parkActivations) {
                                parkActivations = await fetchParkActivations(reference);
                                await saveParkActivationsToIndexedDB(reference, parkActivations);
                            }

                            const updatedPopup = await fetchFullPopupContent(park, currentActivation, parkActivations);
                            this.setPopupContent(updatedPopup);
                        } catch (error) {
                            console.error(`Error fetching activations for park ${reference}:`, error);
                            this.setPopupContent(`${marker.originalPopupContent}<br><br><b>Error loading recent activations.</b>`);
                        }
                    });
                    marker.setPopupContent(popupHtml);
                } catch (error) {
                    console.error("Error building popup:", error);
                    marker.setPopupContent("<b>Error loading park details.</b>");
                }
            });
        });
    } catch (error) {
        console.error("Error fetching or displaying POTA spots:", error);
    }
}


/**
 * Initializes the recurring fetch for POTA spots.
 */
function initializeSpotFetching() {
    fetchAndDisplaySpots(); // Initial fetch
    setInterval(fetchAndDisplaySpots, 5 * 60 * 1000); // Fetch every 5 minutes
}

// Ensure spots fetching starts when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeSpotFetching();
});



/**
 * Determines the marker color based on activations and user activation status.
 * @param {number} activations - The number of activations for the park.
 * @param {boolean} userActivated - Whether the user has activated the park.
 * @returns {string} The color code for the marker.
 */
function getMarkerColor(activations, userActivated, created) {
    const now = new Date();
    const createdDate = new Date(created);
    const ageInDays = (now - createdDate) / (1000 * 60 * 60 * 24);

    if (ageInDays <= 30) return "#800080"; // Purple for new parks
    if (userActivated) return "#ffa500";   // Orange for user-activated parks
    if (activations > 10) return "#ff6666"; // Light red for highly active parks
    if (activations > 0) return "#90ee90";  // Light green for active parks
    return "#0000ff";                      // Vivid blue for inactive parks
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
 * Adds a "Go To Park" button below the search box for global dataset search.
 */
function addGoToParkButton() {
    const searchBoxContainer = document.getElementById('searchBoxContainer');

    if (!searchBoxContainer) {
        console.error("SearchBoxContainer not found.");
        return;
    }

    // Create Go To Park button
    const goToParkButton = document.createElement('button');
    goToParkButton.id = 'goToParkButton';
    goToParkButton.innerText = 'Go To Park';
    goToParkButton.title = 'Expand search to the full dataset and zoom to a park';
    goToParkButton.style.marginTop = '10px';

    // Add event listener for Go To Park button
    goToParkButton.addEventListener('click', () => {
        triggerGoToPark();
    });

    // Add Clear Search button if not already present
    const clearButton = document.getElementById('clearSearch');
    if (!clearButton) {
        const clearSearchButton = document.createElement('button');
        clearSearchButton.id = 'clearSearch';
        clearSearchButton.innerText = 'Clear Search';
        clearSearchButton.title = 'Clear Search';
        clearSearchButton.style.marginTop = '10px';

        clearSearchButton.addEventListener('click', clearSearchInput);
        searchBoxContainer.appendChild(clearSearchButton);
        console.log("Clear Search button added.");
    }

    // Append Go To Park button after the Clear Search button
    searchBoxContainer.appendChild(goToParkButton);
    console.log("Go To Park button added.");

    // Bind Enter key to Go To Park functionality
    const searchBox = document.getElementById('searchBox');
    if (searchBox) {
        searchBox.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                triggerGoToPark(true);
            }
        });
        console.log("Enter key bound to Go To Park functionality.");
    }
}

/**
 * Triggers the Go To Park functionality by searching and zooming to a park.
 */
function triggerGoToPark() {
    const searchBox = document.getElementById('searchBox');
    if (!searchBox || !searchBox.value.trim()) {
        alert('Please enter a search term.');
        return;
    }

    const query = normalizeString(searchBox.value);
    const matchingPark = parks.find(park =>
        normalizeString(park.name).includes(query) ||
        normalizeString(park.reference).includes(query)
    );

    if (matchingPark) {
        zoomToPark(matchingPark);
    } else {
        alert('No matching park.');
    }
}

// Initialize Go To Park button on DOMContentLoaded
addEventListener('DOMContentLoaded', () => {
    addGoToParkButton();
});

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
