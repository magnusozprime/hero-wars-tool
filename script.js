// --- FIREBASE IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, get, child, update, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// !!! PASTE YOUR FIREBASE CONFIG HERE !!!
const firebaseConfig = {

  apiKey: "AIzaSyCb88PHLYyfDCBaZ3GA4yqQzPsv936ZtlI",

  authDomain: "herowarsstats-d4a05.firebaseapp.com",

  databaseURL: "https://herowarsstats-d4a05-default-rtdb.firebaseio.com",

  projectId: "herowarsstats-d4a05",

  storageBucket: "herowarsstats-d4a05.firebasestorage.app",

  messagingSenderId: "280610051600",

  appId: "1:280610051600:web:de0ad2594e5e4191aa9c95"

};


const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- CONFIGURATION ---
const ADMIN_PASSWORD = "admin321"; // <--- CHANGE THIS PASSWORD!!!

// --- GLOBAL VARS ---
let gameAssets = null;
let processedTeamsCache = [];

// --- ASSETS ---
async function loadGameAssets() {
    if (gameAssets) return;
    try {
        const response = await fetch('data/game_assets.json');
        gameAssets = await response.json();
    } catch (error) { console.error("Asset Load Error", error); }
}

// --- HELPER UTILS ---
function getHeroName(id) { return gameAssets?.heroes[id]?.name || `Hero ${id}`; }
function getPetName(id) { return gameAssets?.pets[id]?.name || `Pet ${id}`; }
function displayMessage(msg, type='info') {
    const el = document.getElementById('message');
    if(el) {
        el.textContent = msg;
        el.style.color = type === 'error' ? 'var(--danger)' : 'var(--success)';
    }
}

// --- 1. ADMIN PAGE LOGIC (index.html) ---
async function initInputPage() {
    // A. LOCK SCREEN LOGIC
    const overlay = document.getElementById('loginOverlay');
    const loginBtn = document.getElementById('loginBtn');
    const passInput = document.getElementById('adminPass');
    const loginMsg = document.getElementById('loginMsg');

    // Check if already logged in this session
    if(sessionStorage.getItem('auth') === 'true') {
        overlay.classList.add('hidden');
    }

    loginBtn.addEventListener('click', () => {
        if(passInput.value === ADMIN_PASSWORD) {
            sessionStorage.setItem('auth', 'true');
            overlay.classList.add('hidden');
        } else {
            loginMsg.textContent = "Incorrect Passcode";
        }
    });

    // B. APP LOGIC (Only runs after asset load)
    await loadGameAssets();
    
    // Status Check
    get(child(ref(db), ".info/connected")).then(() => {
        const el = document.getElementById('dbStatus');
        if(el) { el.textContent = "Online"; el.style.color = "var(--success)"; }
    });

    // C. CLEAR DATABASE LOGIC
    const clearDbBtn = document.getElementById('clearDbBtn');
    if(clearDbBtn) {
        clearDbBtn.addEventListener('click', async () => {
            const confirm1 = confirm("⚠️ DANGER: This will delete ALL team data from the database.");
            if(!confirm1) return;
            
            const confirm2 = prompt("Type 'DELETE' to confirm destruction:");
            if(confirm2 === "DELETE") {
                try {
                    await remove(ref(db, 'stats'));
                    alert("Database Wiped.");
                    location.reload();
                } catch(e) {
                    alert("Error: " + e.message);
                }
            }
        });
    }

    // D. PROCESSING LOGIC (Existing Code)
    const processBtn = document.getElementById('processDataBtn');
    const uploadBtn = document.getElementById('storeDataBtn');
    const rawInput = document.getElementById('rawDataInput');
    const serverIn = document.getElementById('serverInput');
    const platSel = document.getElementById('platformSelect');

    if(processBtn) {
        processBtn.addEventListener('click', () => {
            processedTeamsCache = [];
            const rawData = rawInput.value;
            if(!rawData) { displayMessage("Input is empty", 'error'); return; }

            try {
                const parsed = JSON.parse(rawData);
                // ... (Keep your existing parsing logic here) ...
                // Quick logic recap:
                let list = [];
                if(parsed.results && parsed.results[0]?.result?.response?.top) list = parsed.results[0].result.response.top;
                else if(parsed.teams) list = parsed.teams;
                else if(Array.isArray(parsed)) list = parsed;

                let count = 0;
                list.forEach(entry => {
                    const rawList = entry.heroes || entry.hero_ids || [];
                    let h = [], p = null;
                    rawList.forEach(item => {
                        const isObj = typeof item === 'object' && item;
                        const id = isObj ? item.id : item;
                        const type = isObj ? item.type : null;
                        if(type === 'pet' || id >= 6000) p = `6--${String(id).slice(-1)}`;
                        else {
                            let s = String(id);
                            h.push(s.length===1 ? '0'+s : s);
                        }
                    });
                    h.sort();
                    if(h.length === 5 && p) {
                        processedTeamsCache.push({
                            teamKey: `${p}-${h.join('-')}`,
                            petId: p, heroIds: h,
                            power: entry.power ? Number(entry.power) : 0
                        });
                        count++;
                    }
                });

                if(count > 0) displayMessage(`Ready to upload ${count} teams.`);
                else displayMessage("No valid teams found.", 'error');
            } catch(e) { displayMessage(e.message, 'error'); }
        });
    }

    if(uploadBtn) {
        uploadBtn.addEventListener('click', async () => {
            if(!processedTeamsCache.length) return;
            const key = `${serverIn.value.toUpperCase()}_${platSel.value}`;
            
            try {
                // Fetch current server stats to merge
                const snap = await get(child(ref(db), `stats/${key}`));
                const current = snap.exists() ? snap.val() : {};

                processedTeamsCache.forEach(t => {
                    if(current[t.teamKey]) {
                        current[t.teamKey].count++;
                        current[t.teamKey].totalPower += t.power;
                    } else {
                        current[t.teamKey] = { ...t, count: 1, totalPower: t.power };
                    }
                });

                await update(ref(db), { [`stats/${key}`]: current });
                processedTeamsCache = [];
                rawInput.value = "";
                displayMessage("Upload Successful!", 'success');
            } catch(e) { displayMessage(e.message, 'error'); }
        });
    }
}

// --- 2. RESULTS PAGE LOGIC (results.html) ---
async function initResultsPage() {
    await loadGameAssets();
    const display = document.getElementById('resultsDisplay');
    const sFilter = document.getElementById('serverFilter');
    const pFilter = document.getElementById('platformFilter');
    const refresh = document.getElementById('refreshBtn');

    async function fetchData() {
        display.innerHTML = '<p style="text-align:center; padding:20px;">Fetching live data...</p>';
        try {
            const snap = await get(child(ref(db), 'stats'));
            if(snap.exists()) {
                const data = snap.val();
                updateFilters(data);
                render(data);
            } else {
                display.innerHTML = '<p style="text-align:center;">Database is empty.</p>';
            }
        } catch(e) { display.innerHTML = `<p style="color:var(--danger)">Error: ${e.message}</p>`; }
    }

    function updateFilters(data) {
        if(sFilter.options.length > 1) return;
        const servers = new Set();
        Object.keys(data).forEach(k => servers.add(k.split('_')[0]));
        Array.from(servers).sort().forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            sFilter.appendChild(opt);
        });
    }

    function render(data) {
        display.innerHTML = '';
        const sVal = sFilter.value, pVal = pFilter.value;
        let agg = {};

        Object.entries(data).forEach(([gKey, list]) => {
            const [srv, plt] = gKey.split('_');
            if((sVal === 'all' || sVal === srv) && (pVal === 'all' || pVal === plt)) {
                Object.values(list).forEach(t => {
                    // FIX: Ensure Key exists
                    const k = t.teamKey || `${t.petId}-${t.heroIds.join('-')}`;
                    if(agg[k]) agg[k].count += t.count;
                    else agg[k] = { ...t, teamKey: k };
                });
            }
        });

        const sorted = Object.values(agg).sort((a,b) => b.count - a.count);
        
        sorted.forEach(t => {
            const row = document.createElement('div');
            row.className = 'team-row';
            let h = `<div class="team-cell">${getPetName(t.petId)}</div>`;
            t.heroIds.forEach(id => h += `<div class="team-cell">${getHeroName(id)}</div>`);
            h += `<div class="team-cell count-cell">${t.count}</div>`;
            row.innerHTML = h;
            display.appendChild(row);
        });
        
        const tot = document.getElementById('totalTeamsCount');
        if(tot) tot.textContent = `Total Teams: ${sorted.length}`;
    }

    sFilter.addEventListener('change', () => fetchData());
    pFilter.addEventListener('change', () => fetchData());
    if(refresh) refresh.addEventListener('click', () => fetchData());

    fetchData();
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    if(document.getElementById('rawDataInput')) initInputPage();
    else if(document.getElementById('resultsDisplay')) initResultsPage();
});