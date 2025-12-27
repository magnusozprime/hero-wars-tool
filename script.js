// --- FIREBASE SETUP ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, get, child, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// PASTE YOUR FIREBASE CONFIG HERE vvvvvvvvvvv
const firebaseConfig = {

  apiKey: "AIzaSyCb88PHLYyfDCBaZ3GA4yqQzPsv936ZtlI",

  authDomain: "herowarsstats-d4a05.firebaseapp.com",

  databaseURL: "https://herowarsstats-d4a05-default-rtdb.firebaseio.com",

  projectId: "herowarsstats-d4a05",

  storageBucket: "herowarsstats-d4a05.firebasestorage.app",

  messagingSenderId: "280610051600",

  appId: "1:280610051600:web:de0ad2594e5e4191aa9c95"

};

// ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- GLOBAL VARIABLES ---
let gameAssets = null;
let processedTeamsCache = [];

// --- ASSETS LOADING ---
async function loadGameAssets() {
    if (gameAssets) return;
    try {
        const response = await fetch('data/game_assets.json');
        gameAssets = await response.json();
    } catch (error) {
        console.error("Error loading assets:", error);
    }
}

// --- HELPER FUNCTIONS ---
function getHeroName(id) { return gameAssets?.heroes[id]?.name || `Hero ${id}`; }
function getPetName(id) { return gameAssets?.pets[id]?.name || `Pet ${id}`; }

function displayMessage(msg, type = 'info') {
    const el = document.getElementById('message');
    if (el) {
        el.textContent = msg;
        el.style.color = type === 'error' ? 'red' : '#00FF00';
    }
}

// --- INPUT PAGE LOGIC ---
async function initInputPage() {
    await loadGameAssets();
    
    // Check connection
    const connectedRef = ref(db, ".info/connected");
    get(connectedRef).then(() => {
        const statusEl = document.getElementById('dbStatus');
        if(statusEl) statusEl.textContent = "🟢 Online & Ready";
    });

    const rawDataInput = document.getElementById('rawDataInput');
    const processDataBtn = document.getElementById('processDataBtn');
    const storeDataBtn = document.getElementById('storeDataBtn');
    const serverInput = document.getElementById('serverInput');
    const platformSelect = document.getElementById('platformSelect');

    // 1. PROCESS BUTTON
    if (processDataBtn) {
        processDataBtn.addEventListener('click', () => {
            processedTeamsCache = [];
            const rawData = rawDataInput.value;

            if (!rawData) { displayMessage("Paste data first.", 'error'); return; }

            try {
                const parsedData = JSON.parse(rawData);
                let teamsArray = [];

                // Parsing Logic
                if (parsedData.results && parsedData.results[0]?.result?.response?.top) {
                    teamsArray = parsedData.results[0].result.response.top;
                } else if (parsedData.teams) {
                    teamsArray = parsedData.teams;
                } else if (Array.isArray(parsedData)) {
                    teamsArray = parsedData;
                }

                let successCount = 0;
                teamsArray.forEach(entry => {
                    const rawList = entry.heroes || entry.hero_ids || [];
                    let heroIds = [];
                    let petId = null;

                    rawList.forEach(item => {
                        const isObject = typeof item === 'object' && item !== null;
                        const id = isObject ? item.id : item;
                        const type = isObject ? item.type : null;

                        if (type === 'pet' || id >= 6000) {
                            const strId = String(id);
                            petId = `6--${strId.slice(-1)}`;
                        } else {
                            let strId = String(id);
                            if (strId.length === 1) strId = '0' + strId;
                            heroIds.push(strId);
                        }
                    });

                    heroIds.sort();
                    const power = entry.power ? Number(entry.power) : 0;

                    if (heroIds.length === 5 && petId) {
                        const teamKey = `${petId}-${heroIds.join('-')}`;
                        processedTeamsCache.push({ teamKey, petId, heroIds, power });
                        successCount++;
                    }
                });

                if (successCount > 0) displayMessage(`Processed ${successCount} teams. Click UPLOAD.`);
                else displayMessage("No valid teams found.", 'error');

            } catch (e) {
                displayMessage(`JSON Error: ${e.message}`, 'error');
            }
        });
    }

    // 2. STORE (UPLOAD) BUTTON
    if (storeDataBtn) {
        storeDataBtn.addEventListener('click', async () => {
            if (processedTeamsCache.length === 0) return;
            const serverId = serverInput.value.trim().toUpperCase();
            const platform = platformSelect.value;
            const globalKey = `${serverId}_${platform}`;

            displayMessage("Uploading to Cloud...", "info");

            // Fetch existing data for this server to merge counts
            const dbRef = ref(db);
            let updates = {};

            try {
                // Get current data for this server
                const snapshot = await get(child(dbRef, `stats/${globalKey}`));
                const currentData = snapshot.exists() ? snapshot.val() : {};

                processedTeamsCache.forEach(team => {
                    if (currentData[team.teamKey]) {
                        // Update locally first to prepare upload
                        currentData[team.teamKey].count++;
                        currentData[team.teamKey].totalPower += team.power;
                    } else {
                        currentData[team.teamKey] = {
                            petId: team.petId,
                            heroIds: team.heroIds,
                            count: 1,
                            totalPower: team.power
                        };
                    }
                });

                // Prepare Firebase update
                updates[`stats/${globalKey}`] = currentData;
                
                // Send to Firebase
                await update(ref(db), updates);

                processedTeamsCache = [];
                rawDataInput.value = '';
                displayMessage("✅ Success! Data uploaded to Firebase.");

            } catch (error) {
                console.error(error);
                displayMessage("Upload Failed: " + error.message, "error");
            }
        });
    }
}

// --- RESULTS PAGE LOGIC ---
async function initResultsPage() {
    await loadGameAssets();
    const resultsDisplay = document.getElementById('resultsDisplay');
    const serverFilter = document.getElementById('serverFilter');
    const platformFilter = document.getElementById('platformFilter');
    const refreshBtn = document.getElementById('refreshBtn');

    async function loadAndRender() {
        resultsDisplay.innerHTML = '<p style="text-align: center;">Fetching latest data...</p>';
        
        try {
            const dbRef = ref(db);
            const snapshot = await get(child(dbRef, `stats`));
            
            if (snapshot.exists()) {
                const allData = snapshot.val();
                renderData(allData);
                populateFilters(allData);
            } else {
                resultsDisplay.innerHTML = '<p style="text-align: center;">No data in database yet.</p>';
            }
        } catch (error) {
            resultsDisplay.innerHTML = `<p style="text-align: center; color: red;">Error: ${error.message}</p>`;
        }
    }

    function populateFilters(allData) {
        // Only populate if empty
        if (serverFilter.options.length > 1) return; 

        const uniqueServers = new Set();
        Object.keys(allData).forEach(key => uniqueServers.add(key.split('_')[0]));
        
        serverFilter.innerHTML = '<option value="all">All Servers</option>';
        Array.from(uniqueServers).sort().forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            serverFilter.appendChild(opt);
        });
    }

    function renderData(allData) {
        resultsDisplay.innerHTML = '';
        const selectedServer = serverFilter.value;
        const selectedPlatform = platformFilter.value;

        let aggregatedTeams = {};

        Object.entries(allData).forEach(([globalKey, serverPlatformData]) => {
            const [server, platform] = globalKey.split('_');
            
            if ((selectedServer === 'all' || server === selectedServer) &&
                (selectedPlatform === 'all' || platform === selectedPlatform)) {
                
                Object.values(serverPlatformData).forEach(team => {
                    if (aggregatedTeams[team.teamKey]) {
                        aggregatedTeams[team.teamKey].count += team.count;
                    } else {
                        aggregatedTeams[team.teamKey] = { ...team };
                    }
                });
            }
        });

        const sorted = Object.values(aggregatedTeams).sort((a,b) => b.count - a.count);
        
        if (sorted.length === 0) {
            resultsDisplay.innerHTML = '<p style="text-align: center;">No teams found for filters.</p>';
            return;
        }

        sorted.forEach(team => {
            const row = document.createElement('div');
            row.className = 'team-row';
            
            let html = `<div class="team-cell pet-cell">${getPetName(team.petId)}</div>`;
            team.heroIds.forEach(id => {
                html += `<div class="team-cell hero-cell">${getHeroName(id)}</div>`;
            });
            html += `<div class="team-cell count-cell">${team.count}</div>`;
            row.innerHTML = html;
            resultsDisplay.appendChild(row);
        });

        document.getElementById('totalTeamsCount').textContent = `Total Unique Teams: ${sorted.length}`;
    }

    // Events
    serverFilter.addEventListener('change', () => loadAndRender());
    platformFilter.addEventListener('change', () => loadAndRender());
    refreshBtn.addEventListener('click', () => loadAndRender());

    loadAndRender(); // Initial load
}

// --- INITIALIZATION ---
// Determine which page we are on
if (document.getElementById('rawDataInput')) {
    initInputPage();
} else if (document.getElementById('resultsDisplay')) {
    initResultsPage();
}