
// --- FIREBASE IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, get, child, update, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ==========================================
// !!! PASTE YOUR FIREBASE CONFIG HERE !!!
// ==========================================
const firebaseConfig = {

  apiKey: "AIzaSyCb88PHLYyfDCBaZ3GA4yqQzPsv936ZtlI",

  authDomain: "herowarsstats-d4a05.firebaseapp.com",

  databaseURL: "https://herowarsstats-d4a05-default-rtdb.firebaseio.com",

  projectId: "herowarsstats-d4a05",

  storageBucket: "herowarsstats-d4a05.firebasestorage.app",

  messagingSenderId: "280610051600",

  appId: "1:280610051600:web:de0ad2594e5e4191aa9c95"

};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// CONFIG
const ADMIN_PASSWORD = "Admin321"; // Change this if you want

// GLOBAL VARS
let gameAssets = null;
let processedTeamsCache = [];
let processedPlayersCache = {}; 

// ASSET LOADING
async function loadGameAssets() {
    if (gameAssets) return;
    try {
        const response = await fetch('data/game_assets.json');
        gameAssets = await response.json();
    } catch (error) { console.error("Asset error", error); }
}

// SAFE HELPERS
function getHeroName(id) { 
    if(!gameAssets || !gameAssets.heroes || !gameAssets.heroes[id]) return `Hero ${id}`;
    return gameAssets.heroes[id].name; 
}
function getPetName(id) { 
    if(!gameAssets || !gameAssets.pets || !gameAssets.pets[id]) return `Pet ${id}`;
    return gameAssets.pets[id].name; 
}
function displayMessage(msg, type='info') {
    const el = document.getElementById('message');
    if(el) { el.textContent = msg; el.style.color = type === 'error' ? '#ef4444' : '#10b981'; }
}

// ======================================================
// 1. INPUT PAGE LOGIC
// ======================================================
async function initInputPage() {
    await loadGameAssets();
    
    // Auth
    const overlay = document.getElementById('loginOverlay');
    if(overlay && sessionStorage.getItem('auth') === 'true') overlay.classList.add('hidden');
    const loginBtn = document.getElementById('loginBtn');
    if(loginBtn) {
        loginBtn.addEventListener('click', () => {
            if(document.getElementById('adminPass').value === ADMIN_PASSWORD) {
                sessionStorage.setItem('auth', 'true');
                overlay.classList.add('hidden');
            } else { document.getElementById('loginMsg').textContent = "Wrong Password"; }
        });
    }

    // Status
    get(child(ref(db), ".info/connected")).then(() => {
        const el = document.getElementById('dbStatus');
        if(el) { el.textContent = "Online"; el.style.color = "#10b981"; }
    });

    // Delete Button
    const deleteBtn = document.getElementById('deleteSpecificServerBtn');
    if(deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            const key = `${document.getElementById('serverInput').value.trim().toUpperCase()}_${document.getElementById('platformSelect').value}`;
            if(confirm(`DELETE ALL DATA FOR ${key}?`)) {
                await remove(ref(db, `stats/${key}`));
                alert("Deleted.");
            }
        });
    }

    // Process
    const processBtn = document.getElementById('processDataBtn');
    const uploadBtn = document.getElementById('storeDataBtn');
    const rawInput = document.getElementById('rawDataInput');

    if(processBtn) {
        processBtn.addEventListener('click', () => {
            processedTeamsCache = []; processedPlayersCache = {};
            const raw = rawInput.value;
            if(!raw) return displayMessage("Empty Input", "error");

            try {
                const json = JSON.parse(raw);
                
                const usersDict = json.results?.[0]?.result?.response?.users || json.users || {};
                const topList = json.results?.[0]?.result?.response?.top || [];

                // Process Players
                Object.values(usersDict).forEach(u => {
                    processedPlayersCache[u.id] = {
                        id: u.id, name: u.name || "Unknown", level: u.level || 0,
                        serverId: u.serverId, guild: u.clanTitle || "", // Fix undefined guild
                        guildId: u.clanId || 0, role: u.clanRole || 0,
                        lastLogin: u.lastLoginTime || 0, avatar: u.avatarId || 0, power: 0
                    };
                });
                topList.forEach(t => {
                    if(t.userId && processedPlayersCache[t.userId]) {
                        processedPlayersCache[t.userId].power = Number(t.sumPower || 0);
                    }
                });

                // Process Teams
                let teamList = [];
                if (json.results && json.results[0]?.result?.response?.top) teamList = json.results[0].result.response.top;
                else if (json.results && json.results[0]?.result?.response?.defense_teams) teamList = json.results[0].result.response.defense_teams;
                else if (json.teams) teamList = json.teams;

                let teamCount = 0;
                teamList.forEach(entry => {
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
                        const power = entry.power ? Number(entry.power) : 0;
                        let pName = "Unknown", gName = "";
                        if(entry.userId && usersDict[entry.userId]) {
                            pName = usersDict[entry.userId].name || "Unknown";
                            gName = usersDict[entry.userId].clanTitle || "";
                        }
                        processedTeamsCache.push({
                            teamKey: `${p}-${h.join('-')}`, petId: p, heroIds: h, power: power,
                            playerName: pName, guildName: gName
                        });
                        teamCount++;
                    }
                });
                const playerCount = Object.keys(processedPlayersCache).length;
                displayMessage(`Found ${teamCount} Teams / ${playerCount} Players. Ready.`, "success");
            } catch(e) { displayMessage("JSON Error: " + e.message, 'error'); }
        });
    }

    if(uploadBtn) {
        uploadBtn.addEventListener('click', async () => {
            if(!processedTeamsCache.length && Object.keys(processedPlayersCache).length === 0) return;
            const key = `${document.getElementById('serverInput').value.trim().toUpperCase()}_${document.getElementById('platformSelect').value}`;
            displayMessage("Uploading...", "info");
            try {
                let updates = {};
                // Upload Stats
                if(processedTeamsCache.length > 0) {
                    const snap = await get(child(ref(db), `stats/${key}`));
                    const current = snap.exists() ? snap.val() : {};
                    processedTeamsCache.forEach(t => {
                        if(current[t.teamKey]) {
                            current[t.teamKey].count++;
                            current[t.teamKey].totalPower += t.power;
                            if(t.power > (current[t.teamKey].maxPower || 0)) {
                                current[t.teamKey].maxPower = t.power;
                                current[t.teamKey].topPlayer = t.playerName;
                                current[t.teamKey].topGuild = t.guildName;
                            }
                        } else {
                            current[t.teamKey] = {
                                ...t, count: 1, totalPower: t.power,
                                maxPower: t.power, topPlayer: t.playerName, topGuild: t.guildName
                            };
                        }
                    });
                    updates[`stats/${key}`] = current;
                }
                // Upload Players
                Object.values(processedPlayersCache).forEach(p => updates[`players/${p.id}`] = p);
                
                await update(ref(db), updates);
                processedTeamsCache = []; processedPlayersCache = {}; rawInput.value = "";
                displayMessage("✅ Success! Upload Complete.", "success");
            } catch(e) { displayMessage("Upload Failed: " + e.message, "error"); }
        });
    }
}

// ======================================================
// 2. RESULTS PAGE LOGIC
// ======================================================
async function initResultsPage() {
    await loadGameAssets();
    const display = document.getElementById('resultsDisplay');
    const sFilter = document.getElementById('serverFilter');
    const pFilter = document.getElementById('platformFilter');
    const refreshBtn = document.getElementById('refreshBtn');

    async function fetchData() {
        display.innerHTML = '<p style="text-align:center; padding:20px; color:#888;">Fetching...</p>';
        try {
            const snap = await get(child(ref(db), 'stats'));
            if(snap.exists()) {
                const data = snap.val();
                updateFilters(data);
                render(data);
            } else { display.innerHTML = '<p style="text-align:center;">Database Empty.</p>'; }
        } catch(e) { console.error(e); display.innerHTML = `<p style="text-align:center; color:red;">${e.message}</p>`; }
    }

    function updateFilters(data) {
        if(sFilter.options.length > 1) return;
        const servers = new Set();
        Object.keys(data).forEach(k => { if(k.includes('_')) servers.add(k.split('_')[0]); });
        Array.from(servers).sort().forEach(s => {
            const opt = document.createElement('option'); opt.value = s; opt.textContent = s; sFilter.appendChild(opt);
        });
    }

    function render(data) {
        display.innerHTML = '';
        const sVal = sFilter.value, pVal = pFilter.value;
        let agg = {}, valid = 0;

        Object.entries(data).forEach(([gKey, list]) => {
            if(!gKey.includes('_')) return;
            const [srv, plt] = gKey.split('_');
            if((sVal === 'all' || sVal === srv) && (pVal === 'all' || pVal === plt)) {
                Object.values(list).forEach(t => {
                    try {
                        if(!t || !t.petId) return;
                        const k = t.teamKey || `${t.petId}-${t.heroIds.join('-')}`;
                        if(agg[k]) agg[k].count += (t.count || 1);
                        else agg[k] = { ...t, teamKey: k, count: t.count || 1 };
                        valid++;
                    } catch(e) {}
                });
            }
        });

        if(valid === 0) return display.innerHTML = '<p style="text-align:center;">No teams found.</p>';
        const sorted = Object.values(agg).sort((a,b) => b.count - a.count);

        sorted.forEach(t => {
            const row = document.createElement('div'); row.className = 'team-row';
            let h = `<div class="team-cell">${getPetName(t.petId)}</div>`;
            t.heroIds.forEach(id => h += `<div class="team-cell">${getHeroName(id)}</div>`);
            h += `<div class="team-cell count-cell">${t.count}</div>`;
            row.innerHTML = h;
            display.appendChild(row);
        });
        const tot = document.getElementById('totalTeamsCount');
        if(tot) tot.textContent = `Total Unique Teams: ${sorted.length}`;
    }

    if(sFilter) sFilter.addEventListener('change', fetchData);
    if(pFilter) pFilter.addEventListener('change', fetchData);
    if(refreshBtn) refreshBtn.addEventListener('click', fetchData);
    fetchData();
}

// ======================================================
// 3. PLAYERS PAGE LOGIC
// ======================================================
// ======================================================
// 3. PLAYERS PAGE LOGIC (Simplified)
// ======================================================
async function initPlayersPage() {
    const grid = document.getElementById('playerGrid');
    const searchInput = document.getElementById('playerSearch');
    const countLabel = document.getElementById('resultCount');
    let allPlayers = [];

    try {
        countLabel.textContent = "Connecting...";
        const snap = await get(child(ref(db), 'players'));
        if(snap.exists()) {
            allPlayers = Object.values(snap.val());
            // Sort by Power High->Low
            allPlayers.sort((a, b) => (b.power || 0) - (a.power || 0));
            
            countLabel.textContent = `Database loaded: ${allPlayers.length} players found.`;
            
            // LIMIT: Show only top 50 initially
            renderPlayers(allPlayers.slice(0, 50));
        } else { countLabel.textContent = "Database empty."; }
    } catch(e) { countLabel.textContent = "Error loading database."; }

    function renderPlayers(list) {
        grid.innerHTML = '';
        list.forEach(p => {
            const card = document.createElement('div'); 
            card.className = 'player-card';
            
            // Format Power
            const power = p.power ? Number(p.power).toLocaleString() : "0";
            
            // Generate HTML (No Avatar, No Last Seen)
            card.innerHTML = `
                <div class="server-badge">S${p.serverId}</div>
                <div class="player-info">
                    <div class="p-name">${p.name} <span style="font-size:0.6em; color:#555;">(Lv.${p.level||"??"})</span></div>
                    <div class="p-guild">${p.guild || "-"}</div>
                    <div class="p-detail">ID: ${p.id}</div>
                    <div class="p-power">PWR: ${power}</div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            
            // If search is cleared, go back to Top 50
            if(term.length < 2) { 
                renderPlayers(allPlayers.slice(0, 50)); 
                return; 
            }
            
            const filtered = allPlayers.filter(p => 
                (p.name && String(p.name).toLowerCase().includes(term)) || 
                (p.guild && String(p.guild).toLowerCase().includes(term)) ||
                (p.id && String(p.id).includes(term))
            );
            
            countLabel.textContent = `Found ${filtered.length} matches.`;
            // Even when searching, limit results to 50 to keep it fast
            renderPlayers(filtered.slice(0, 50));
        });
    }
}

// ROUTER
document.addEventListener('DOMContentLoaded', () => {
    if(document.getElementById('rawDataInput')) initInputPage();
    else if(document.getElementById('resultsDisplay')) initResultsPage();
    else if(document.getElementById('playerSearch')) initPlayersPage();
});