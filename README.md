# POTAMap

POTAMap is a web‑based mapping application for POTA activators. The app displays parks on a Leaflet map, integrates activation data stored in IndexedDB, and provides features for searching parks, filtering activations, and viewing details (including recent activations) for each park. POTAMap also supports uploading CSV files with activation data and merging updates from a remote API.

## Features

- **Interactive Map Display:**  
  Uses the [Leaflet](https://leafletjs.com/) library to show park markers, center on your current location, and automatically update markers based on map bounds.

- **Activation Data Management:**
    - Load and display user activation data stored locally via IndexedDB.
    - Upload CSV files (using [PapaParse](https://www.papaparse.com/)) to import new activations.
    - Merge activation data from a remote API endpoint (when available) or scrape recent activations from the page.

- **Search and Filter:**  
  Dynamic search functionality lets you filter parks by name, reference, or location. The search input automatically highlights matching parks and adjusts the map view accordingly.

- **Responsive Design:**  
  The user interface is optimized for both mobile and desktop devices, including an enhanced hamburger menu for navigation and responsive Leaflet controls.

- **Recent Activations View:**  
  The application can scrape a table of recent activations from the logged-in user's page, showing details such as date, park, CW, Data, Phone, and Total QSOs.

## Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/<username>/POTAMap.git
   cd POTAMap

## Technologies and Libraries Used

- Leaflet:
For interactive map rendering and geolocation handling.
- IndexedDB:
For offline storage and caching of park and activation data.
- PapaParse:
For parsing CSV activation files uploaded by the user.
- Fetch API:
For data retrieval from remote endpoints and for scraping the activation data page.
- Vanilla JavaScript & CSS:
For application logic and responsive design styling.

## Contributing

Contributions are welcome! If you have improvements, bug fixes, or additional features you’d like to see, please fork this repository and submit a pull request.You may also send a note to perry@w1grd.radio.

