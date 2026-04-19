// ============================================================
// OpenRealm - Client Game Logic
// ============================================================
// This file runs in the player's browser. It connects to the
// server via Socket.IO, handles input, tracks all players, and
// draws everything onto an HTML <canvas> element every frame.
// ============================================================

// --- Socket Connection ---
// io() is provided by the Socket.IO client library (loaded via
// a <script> tag in index.html). Calling it connects this browser
// to the server and returns a socket object we use to send and
// receive events.
const socket = io();

// playerName is set by auth.js once the player logs in or registers.
// It starts empty — the game will not join the server until joinGame()
// is called with the authenticated username.
let playerName = "";

// The JWT returned by the server on login/register.
// Sent to the server on "join" so it can verify admin status server-side.
let authToken = "";

// Whether the local player has admin privileges.
// Decoded from the JWT payload — controls whether the right-click menu appears.
let isAdmin = false;

// --- Canvas Setup ---
// Grab the <canvas> element from the HTML by its ID.
const canvas = document.getElementById("gameCanvas");

// getContext("2d") gives us the 2D drawing API — this is what we
// use to draw rectangles, text, shapes, etc. onto the canvas.
const ctx = canvas.getContext("2d");

// --- Chat UI Elements ---
// These are HTML elements defined in index.html that make up the chat UI.
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");

// Spectators see chat but can't type. The input is disabled with a
// prompt until they log in. auth.js calls window.enableChat() after login.
chatInput.disabled     = true;
chatInput.placeholder  = "Log in to chat...";
sendButton.disabled    = true;

window.enableChat = function() {
    chatInput.disabled    = false;
    chatInput.placeholder = "Type a message...";
    sendButton.disabled   = false;
};

// --- Shared Player State ---
// A dictionary of all players currently in the game, keyed by socket ID.
// This mirrors the server's players object and is kept in sync via events.
const players = {};

// Our own socket ID — assigned by the server on connect.
// Used to distinguish our player from others (e.g. draw us in a different color).
// Starts as null because we don't know it until the "connect" event fires.
let myId = null;

// --- Local Player Object ---
// Tracks OUR player's position and properties on the client side.
// This is separate from players[myId] — we update this immediately
// on input so movement feels instant, then sync it to players[myId]
// and emit it to the server.
let player = {
    x: 400,      // Starting X position (pixels from the left of the canvas)
    y: 300,      // Starting Y position (pixels from the top of the canvas)
    size: 20,    // Width and height of the player square in pixels
    speed: 1     // How many pixels the player moves per frame
};

// --- Movement Throttle ---
// Track the last position we sent to the server. We only emit a
// "playerMove" event when the position actually changes — this avoids
// flooding the server with identical messages every single frame.
let lastEmittedX = player.x;
let lastEmittedY = player.y;

// --- Point-and-Click Movement ---
// When the player clicks on the canvas, we store that position as a
// movement target. Each frame, updatePlayer() moves the player toward
// it and clears it once they arrive.
// The target is the top-left corner we want the player square to reach,
// calculated by offsetting from the click so the player centers on it.
let moveTarget = null;

// Local-only click ripples — never sent to server.
// Each entry: { x, y, startTime } drawn as an expanding circle.
const clickRipples = [];
const RIPPLE_DURATION = 500; // ms
const RIPPLE_MAX_RADIUS = 18;

canvas.addEventListener("click", (e) => {
    // Only allow movement for logged-in players.
    if (!playerName) return;

    // e.offsetX/offsetY give the click position relative to the canvas
    // element itself (not the whole page), which is exactly what we need.
    // We subtract half the player size so the player centers on the click
    // rather than placing its top-left corner there.
    moveTarget = {
        x: e.offsetX - player.size / 2,
        y: e.offsetY - player.size / 2
    };

    // Spawn a ripple at the exact click point.
    clickRipples.push({ x: e.offsetX, y: e.offsetY, startTime: performance.now() });
});

// --- Duration Picker ---
// Shared picker shown when an admin selects Mute or Freeze.
// Stores the pending action and target until a duration button is clicked.
const durationPicker = document.getElementById("durationPicker");
let durationPendingAction = null;
let durationPendingTarget = null;

function showDurationPicker(action, targetId, left, top) {
    document.getElementById("durationPickerTitle").textContent =
        action === "mute" ? "Mute for how long?" : "Freeze for how long?";
    durationPendingAction = action;
    durationPendingTarget = targetId;
    durationPicker.style.left    = left;
    durationPicker.style.top     = top;
    durationPicker.style.display = "block";
}

durationPicker.addEventListener("click", (e) => e.stopPropagation());

document.querySelectorAll("#durationPicker button[data-minutes]").forEach(btn => {
    btn.addEventListener("click", () => {
        if (!durationPendingTarget || !durationPendingAction) return;
        const minutes = parseInt(btn.dataset.minutes, 10);
        socket.emit("adminAction", {
            targetId: durationPendingTarget,
            action:   durationPendingAction,
            duration: minutes > 0 ? minutes : null   // 0 = Permanent → no duration
        });
        durationPicker.style.display = "none";
        durationPendingAction = null;
        durationPendingTarget = null;
    });
});

// --- Avatar Color Customizer ---
// The avatar button in the player bar shows the current color and opens
// a swatch panel where the player can pick a preset or custom hex color.
// Changes are saved to MongoDB and broadcast live to all other players.

function syncAvatarButton(color) {
    const btn = document.getElementById("avatarColorBtn");
    if (btn) btn.style.background = color;
}

function applyAvatarColor(color) {
    if (!playerName || !myId) return;
    if (players[myId]) players[myId].avatar = { color };
    syncAvatarButton(color);
    socket.emit("updateAvatar", { color });
    document.getElementById("avatarPanel").style.display = "none";
}

document.getElementById("avatarColorBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const panel = document.getElementById("avatarPanel");
    panel.style.display = panel.style.display === "block" ? "none" : "block";
});

document.getElementById("avatarPanel").addEventListener("click", (e) => e.stopPropagation());

document.querySelectorAll("#avatarSwatches .swatch").forEach(swatch => {
    swatch.addEventListener("click", () => applyAvatarColor(swatch.dataset.color));
});

document.getElementById("avatarCustomColor").addEventListener("input", (e) => {
    applyAvatarColor(e.target.value);
});

// --- Canvas Right-Click Context Menu (Admin only) ---
// Right-clicking on the canvas checks whether the cursor is over a bot.
// If so, show "Remove Bot". Otherwise show "Spawn Bot Here".
const canvasMenu = document.getElementById("canvasContextMenu");

canvas.addEventListener("contextmenu", (e) => {
    // Any logged-in player can right-click. Admin-only options are hidden below.
    if (!playerName) return;
    e.preventDefault();

    const clickX = e.offsetX;
    const clickY = e.offsetY;

    // Check if the click landed on any player or bot.
    // We iterate all players and test whether the click falls within
    // each square's bounding box (x, y) to (x+size, y+size).
    // We skip our own player — admins can't action themselves.
    let hitBot    = null;
    let hitPlayer = null;

    for (const [id, p] of Object.entries(players)) {
        if (id === myId) continue;
        const size = p.size || 20;
        if (clickX >= p.x && clickX <= p.x + size &&
            clickY >= p.y && clickY <= p.y + size) {
            if (p.isBot) hitBot    = id;
            else         hitPlayer = id;
            break;
        }
    }

    const hitTarget = hitBot || hitPlayer; // Any hit target
    const p = hitTarget ? players[hitTarget] : null;

    // Spawn Bot — admin only, empty canvas space only
    document.getElementById("ctxSpawnBot").style.display =
        isAdmin && !hitTarget ? "block" : "none";

    // Remove Bot — admin only, bot targets only
    document.getElementById("ctxRemoveBot").style.display =
        isAdmin && hitBot ? "block" : "none";

    // Mute/Unmute — admin only, any target
    const muteBtn = document.getElementById("ctxCanvasMute");
    muteBtn.style.display = isAdmin && hitTarget ? "block" : "none";
    if (p) muteBtn.textContent = p.muted ? "Unmute" : "Mute";

    // Freeze/Unfreeze — admin only, any target
    const freezeBtn = document.getElementById("ctxCanvasFreeze");
    freezeBtn.style.display = isAdmin && hitTarget ? "block" : "none";
    if (p) freezeBtn.textContent = p.frozen ? "Unfreeze" : "Freeze";

    // View Profile — any logged-in player, real players only (not bots)
    document.getElementById("ctxViewProfile").style.display =
        hitPlayer ? "block" : "none";

    // Show the "Admin" label and divider only when there are admin options
    // AND there is also a general option (View Profile) below the line.
    const hasAdminOptions = isAdmin && hitTarget;
    const hasBothSections = hasAdminOptions && hitPlayer;
    document.getElementById("ctxAdminLabel").style.display = hasAdminOptions ? "block" : "none";
    document.getElementById("ctxDivider").style.display    = hasBothSections ? "block" : "none";

    // Store context on the menu element for the button handlers below.
    canvasMenu.dataset.targetId = hitTarget || "";
    canvasMenu.dataset.botId    = hitBot    || "";
    canvasMenu.dataset.spawnX   = clickX;
    canvasMenu.dataset.spawnY   = clickY;

    canvasMenu.style.left    = e.clientX + "px";
    canvasMenu.style.top     = e.clientY + "px";
    canvasMenu.style.display = "block";
});

document.getElementById("ctxSpawnBot").addEventListener("click", () => {
    socket.emit("spawnBot", {
        x: Number(canvasMenu.dataset.spawnX),
        y: Number(canvasMenu.dataset.spawnY)
    });
    canvasMenu.style.display = "none";
});

document.getElementById("ctxRemoveBot").addEventListener("click", () => {
    const botId = canvasMenu.dataset.botId;
    if (botId) socket.emit("removeBot", { botId });
    canvasMenu.style.display = "none";
});

document.getElementById("ctxCanvasMute").addEventListener("click", (e) => {
    const targetId = canvasMenu.dataset.targetId;
    if (!targetId) return;
    const action = players[targetId]?.muted ? "unmute" : "mute";
    canvasMenu.style.display = "none";
    if (action === "unmute") {
        socket.emit("adminAction", { targetId, action });
    } else {
        e.stopPropagation();
        showDurationPicker(action, targetId, canvasMenu.style.left, canvasMenu.style.top);
    }
});

document.getElementById("ctxCanvasFreeze").addEventListener("click", (e) => {
    const targetId = canvasMenu.dataset.targetId;
    if (!targetId) return;
    const action = players[targetId]?.frozen ? "unfreeze" : "freeze";
    canvasMenu.style.display = "none";
    if (action === "unfreeze") {
        socket.emit("adminAction", { targetId, action });
    } else {
        e.stopPropagation();
        showDurationPicker(action, targetId, canvasMenu.style.left, canvasMenu.style.top);
    }
});

document.getElementById("ctxViewProfile").addEventListener("click", () => {
    const targetId = canvasMenu.dataset.targetId;
    if (!targetId) return;
    // Request the profile from the server — response comes back via "profileData"
    socket.emit("getProfile", { targetId });
    canvasMenu.style.display = "none";
});

// --- Event: "profileData" ---
// Response to a "getProfile" request. Populates and opens the profile modal.
socket.on("profileData", (profile) => {
    // Draw the player icon onto the mini canvas inside the modal.
    const iconCanvas = document.getElementById("profileIcon");
    const iconCtx    = iconCanvas.getContext("2d");
    iconCtx.clearRect(0, 0, iconCanvas.width, iconCanvas.height);
    iconCtx.fillStyle = profile.avatar?.color || (profile.isBot ? "#ffa726" : "#4caf50");
    iconCtx.fillRect(10, 10, 44, 44); // Centered square in the 64x64 canvas

    // Name
    document.getElementById("profileName").textContent = profile.name
        + (profile.isBot ? " (Bot)" : "");

    // Registered date — bots have no account
    const regEl = document.getElementById("profileRegistered");
    if (profile.createdAt) {
        regEl.textContent = "Registered: " + new Date(profile.createdAt).toLocaleDateString(
            undefined, { year: "numeric", month: "long", day: "numeric" }
        );
    } else {
        regEl.textContent = profile.isBot ? "Bot — no account" : "Registration date unavailable";
    }

    // Session time — how long they've been online this visit
    const sessionEl = document.getElementById("profileSession");
    if (profile.joinedAt) {
        const ms      = Date.now() - profile.joinedAt;
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        sessionEl.textContent = `Online this session: ${minutes}m ${seconds}s`;
    } else {
        sessionEl.textContent = "";
    }

    document.getElementById("profileOverlay").style.display = "flex";
});

// Clicking anywhere else closes the canvas menu, duration picker, and avatar panel.
document.addEventListener("click", () => {
    canvasMenu.style.display     = "none";
    durationPicker.style.display = "none";
    document.getElementById("avatarPanel").style.display = "none";
});

// --- WASD Keyboard Input (commented out — may restore later) ---
// let keys = {};
//
// document.addEventListener("keydown", (e) => {
//     const activeTag = document.activeElement.tagName.toLowerCase();
//     if (activeTag === "input") return;
//     keys[e.key.toLowerCase()] = true;
// });
//
// document.addEventListener("keyup", (e) => {
//     keys[e.key.toLowerCase()] = false;
// });

// ============================================================
// Socket.IO Event Handlers
// These listen for messages coming FROM the server.
// ============================================================

// --- Event: "connect" ---
// Fires automatically when our connection to the server is established.
// We just store our socket ID here. The actual "join" is sent later
// by joinGame() once the player has authenticated via the login screen.
socket.on("connect", () => {
    myId = socket.id;

    // If auth.js already called joinGame() before the socket connected
    // (a race condition that can happen with a fast auto-login), the
    // name will already be set — emit join now to catch up.
    if (playerName) {
        socket.emit("join", { name: playerName, x: player.x, y: player.y, token: authToken });
    }
});

// ============================================================
// joinGame()
// ============================================================
// Called by auth.js after the player successfully logs in or
// registers. Sets the player's name and tells the server we've
// joined. Exposed on window so auth.js can call it even though
// that file is loaded separately.
// ============================================================
window.joinGame = function(username, token) {
    playerName = username;
    authToken  = token || "";

    // Decode isAdmin from the JWT payload.
    // The JWT payload is base64-encoded and readable by anyone —
    // the signature is the secret part. We decode it here just to
    // know whether to show the admin context menu. The server
    // independently re-verifies the full token on "join".
    if (authToken) {
        try {
            const payload = JSON.parse(atob(authToken.split(".")[1]));
            isAdmin = payload.isAdmin || false;
        } catch (e) {
            isAdmin = false;
        }
    }

    // Only emit if the socket is already connected. If not,
    // the "connect" handler above will catch it when it fires.
    if (myId) {
        socket.emit("join", { name: playerName, x: player.x, y: player.y, token: authToken });
    }

    // Re-render the list so the local player's entry gets the "you" label
    // and green highlight as soon as they log in.
    updatePlayerList();
};

// --- Event: "joinConfirmed" ---
// Server sends back the verified admin status after the join event is processed.
// This overrides the client-side JWT decode so the two stay in sync.
socket.on("joinConfirmed", (data) => {
    isAdmin = data.isAdmin || false;
});

// --- Event: "currentPlayers" ---
// Sent by the server to the newly joined player only.
// Contains a snapshot of every player currently in the game,
// so we can populate our local players dictionary from the start.
socket.on("currentPlayers", (serverPlayers) => {
    // Clear our local dictionary first to avoid stale entries.
    Object.keys(players).forEach((id) => delete players[id]);

    // Copy all players from the server snapshot into our local dictionary.
    Object.assign(players, serverPlayers);

    // Sync the avatar color button to whatever color was loaded from the DB.
    if (myId && players[myId]?.avatar?.color) {
        syncAvatarButton(players[myId].avatar.color);
    }

    updatePlayerList();
});

// --- Event: "newPlayer" ---
// Sent to all existing players when someone new joins.
// We add them to our local dictionary so they appear on screen.
socket.on("newPlayer", (playerData) => {
    players[playerData.id] = {
        ...playerData,
        chatBubble:    "",
        chatTimestamp: 0,
        isBot:         playerData.isBot || false
    };
    updatePlayerList();
});

// --- Event: "playerMoved" ---
// Sent by the server when another player moves.
// We update their position in our local dictionary.
// Note: the server uses broadcast.emit for this, so we never
// receive our own movement back — we handle that locally instead.
socket.on("playerMoved", (playerData) => {
    if (players[playerData.id]) {
        players[playerData.id].x = playerData.x;
        players[playerData.id].y = playerData.y;
    }
});

// --- Event: "playerDisconnected" ---
// Sent when a player leaves the game.
// We remove them from our dictionary so they disappear from the canvas.
socket.on("playerDisconnected", (id) => {
    delete players[id];
    updatePlayerList();
});

// --- Event: "playerAvatarUpdate" ---
// Sent by the server when any player changes their avatar color.
// We update the local players dictionary so the new color renders immediately.
socket.on("playerAvatarUpdate", ({ id, avatar }) => {
    if (players[id]) players[id].avatar = avatar;
    // If it's our own update, keep the button preview in sync too.
    if (id === myId) syncAvatarButton(avatar.color);
});

// --- Event: "spectatorCount" ---
// Sent by the server whenever the number of connected but unauthenticated
// visitors changes. We update the spectator counter in the player list header.
socket.on("spectatorCount", (count) => {
    const el = document.getElementById("spectatorCount");
    if (el) el.textContent = count;
});

// --- Event: "playerStatusUpdate" ---
// Sent by the server when an admin mutes or freezes a player.
// We update the affected player's flags and re-render the list
// so the badges appear (or disappear) immediately for everyone.
socket.on("playerStatusUpdate", ({ id, muted, frozen }) => {
    if (players[id]) {
        players[id].muted  = muted;
        players[id].frozen = frozen;
        updatePlayerList();
    }
});

// --- Event: "forcedDisconnect" ---
// Sent by the server when the same account logs in from another window.
// We alert the player and reload the page, putting them back into
// spectator mode so the new session can take over cleanly.
socket.on("forcedDisconnect", (reason) => {
    alert(reason);
    location.reload();
});

// --- Event: "chatMessage" ---
// Sent to all clients when any player (or the system) sends a message.
// We add it to the chat log and update the sender's chat bubble.
socket.on("chatMessage", (data) => {
    // Append the message to the scrollable chat panel.
    addChatMessage(data.name, data.message);

    // Update the chat bubble above that player's head (if they're in our dictionary).
    // System messages don't have an id, so players[undefined] will just be falsy.
    if (players[data.id]) {
        players[data.id].chatBubble = data.message;
        players[data.id].chatTimestamp = data.timestamp;
    }
});

// ============================================================
// Chat UI Functions
// ============================================================

// ============================================================
// Player List Sort State
// ============================================================
// Tracks the active sort field ("join" or "name") and direction
// ("asc" or "desc"). Clicking a sort button updates these and
// re-renders the list. Clicking the already-active button toggles
// the direction.
// ============================================================
let sortField = "join";
let sortDir   = "asc";

// Wire up sort buttons once the DOM is ready.
document.querySelectorAll(".sortBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const field = btn.dataset.sort;

        if (sortField === field) {
            // Same field clicked — toggle direction.
            // asc → desc → asc ...
            sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
            // New field — switch to it, default to ascending.
            sortField = field;
            sortDir   = "asc";
        }

        // Sync the arrow label and active highlight across all buttons.
        document.querySelectorAll(".sortBtn").forEach((b) => {
            const isActive = b.dataset.sort === sortField;
            b.classList.toggle("active", isActive);
            if (isActive) {
                // Update the arrow to reflect current direction.
                const label = field === "join" ? "Join" : "Name";
                b.textContent = label + (sortDir === "asc" ? " ↑" : " ↓");
            }
        });

        updatePlayerList();
    });
});

// Rebuilds the player list panel from the current players dictionary.
// Called whenever someone joins, leaves, or the sort option changes.
function updatePlayerList() {
    const listEl = document.getElementById("playerList");
    const countEl = document.getElementById("playerCount");

    // Remove all existing entries but keep the header row.
    listEl.querySelectorAll(".playerEntry").forEach((el) => el.remove());

    // Convert the players dictionary into an array of [id, playerObj] pairs
    // so we can sort them before rendering.
    // Using Object.entries() gives us both the key (socket ID) and the value
    // (player data) together, which is more convenient than sorting just IDs.
    const entries = Object.entries(players);

    // --- Sorting ---
    // Array.sort() takes a comparator function that returns:
    //   negative  → a comes first
    //   positive  → b comes first
    //   zero      → order unchanged
    //
    // For ascending order we do (a - b) for numbers or a.localeCompare(b) for strings.
    // For descending we flip the operands: (b - a) or b.localeCompare(a).
    entries.sort(([, a], [, b]) => {
        if (sortField === "name") {
            // localeCompare does a proper alphabetical comparison that handles
            // accented characters and is case-insensitive when used with the
            // sensitivity option — better than a simple < / > comparison.
            const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
            return sortDir === "asc" ? cmp : -cmp;
        } else {
            // Sort by join time (Unix timestamp, numeric comparison).
            const cmp = (a.joinedAt || 0) - (b.joinedAt || 0);
            return sortDir === "asc" ? cmp : -cmp;
        }
    });

    const ids = Object.keys(players);
    countEl.textContent = ids.length;

    entries.forEach(([id, p]) => {

        const entry = document.createElement("div");
        entry.className = "playerEntry" + (id === myId ? " me" : "");
        // Store the socket ID so the right-click handler knows who was clicked.
        entry.dataset.playerId = id;

        // Green dot to indicate the player is online.
        const dot = document.createElement("span");
        dot.className = "dot";

        // Player name — "(you)" appended for the local player.
        const nameSpan = document.createElement("span");
        nameSpan.textContent = p.name + (id === myId ? " (you)" : "");

        entry.appendChild(dot);
        entry.appendChild(nameSpan);

        // Status badges — shown when an admin has muted or frozen the player.
        if (p.muted) {
            const badge = document.createElement("span");
            badge.className = "statusBadge muted";
            badge.textContent = "muted";
            entry.appendChild(badge);
        }
        if (p.frozen) {
            const badge = document.createElement("span");
            badge.className = "statusBadge frozen";
            badge.textContent = "frozen";
            entry.appendChild(badge);
        }

        listEl.appendChild(entry);
    });
}

// ============================================================
// Admin Context Menu
// ============================================================
// Right-clicking a player entry in the list opens a small menu
// with Mute/Unmute and Freeze/Unfreeze options.
// Only visible when the local player is an admin.
// ============================================================

let contextTargetId = null;
const contextMenu = document.getElementById("contextMenu");

// Delegate right-click handling to the player list container.
// This means we only need one listener regardless of how many entries exist.
document.getElementById("playerList").addEventListener("contextmenu", (e) => {
    // Any logged-in player can right-click. Admin options are hidden below for non-admins.
    if (!playerName) return;

    const entry = e.target.closest(".playerEntry");
    if (!entry) return;

    e.preventDefault();

    const targetId = entry.dataset.playerId;
    if (!targetId || targetId === myId) return;

    contextTargetId = targetId;
    const p = players[targetId];
    if (!p) return;

    // Header — player name
    document.getElementById("contextPlayerName").textContent = p.name;

    // Admin section — only visible to admins, hidden for bots on View Profile
    const isRealPlayer = !p.isBot;
    document.getElementById("ctxListAdminLabel").style.display = isAdmin ? "block" : "none";
    document.getElementById("ctxMute").style.display           = isAdmin ? "block" : "none";
    document.getElementById("ctxFreeze").style.display         = isAdmin ? "block" : "none";
    if (isAdmin) {
        document.getElementById("ctxMute").textContent   = p.muted  ? "Unmute"   : "Mute";
        document.getElementById("ctxFreeze").textContent = p.frozen ? "Unfreeze" : "Freeze";
    }

    // Divider and View Profile — shown for real players only
    document.getElementById("ctxListDivider").style.display    = isAdmin && isRealPlayer ? "block" : "none";
    document.getElementById("ctxListViewProfile").style.display = isRealPlayer ? "block" : "none";

    contextMenu.style.left    = e.clientX + "px";
    contextMenu.style.top     = e.clientY + "px";
    contextMenu.style.display = "block";
});

// Mute / Unmute button
document.getElementById("ctxMute").addEventListener("click", (e) => {
    if (!contextTargetId) return;
    const action = players[contextTargetId]?.muted ? "unmute" : "mute";
    contextMenu.style.display = "none";
    if (action === "unmute") {
        socket.emit("adminAction", { targetId: contextTargetId, action });
    } else {
        e.stopPropagation();
        showDurationPicker(action, contextTargetId, contextMenu.style.left, contextMenu.style.top);
    }
});

// Freeze / Unfreeze button
document.getElementById("ctxFreeze").addEventListener("click", (e) => {
    if (!contextTargetId) return;
    const action = players[contextTargetId]?.frozen ? "unfreeze" : "freeze";
    contextMenu.style.display = "none";
    if (action === "unfreeze") {
        socket.emit("adminAction", { targetId: contextTargetId, action });
    } else {
        e.stopPropagation();
        showDurationPicker(action, contextTargetId, contextMenu.style.left, contextMenu.style.top);
    }
});

// View Profile button (player list)
document.getElementById("ctxListViewProfile").addEventListener("click", () => {
    if (!contextTargetId) return;
    socket.emit("getProfile", { targetId: contextTargetId });
    contextMenu.style.display = "none";
});

// Clicking anywhere else closes the player list menu, duration picker, and avatar panel.
document.addEventListener("click", () => {
    contextMenu.style.display    = "none";
    durationPicker.style.display = "none";
    document.getElementById("avatarPanel").style.display = "none";
});

// Creates a new div for a message and appends it to the chat panel.
// Builds DOM nodes manually (never innerHTML) to prevent XSS.
// @mentions are wrapped in <span class="mentionTag">; if the local
// player is mentioned, the whole row gets the .chatMention class.
function addChatMessage(name, message) {
    const messageDiv = document.createElement("div");
    messageDiv.className = "chatMessage";

    // Prepend "Name: " as plain text.
    messageDiv.appendChild(document.createTextNode(`${name}: `));

    // Split message on @tokens, alternating plain text and mention spans.
    const parts = message.split(/(@\S+)/g);
    let isMentioned = false;
    parts.forEach(part => {
        if (/^@\S+$/.test(part)) {
            const token = part.slice(1).toLowerCase();
            if (playerName && token === playerName.toLowerCase()) isMentioned = true;
            const span = document.createElement("span");
            span.className = "mentionTag";
            span.textContent = part;
            messageDiv.appendChild(span);
        } else {
            messageDiv.appendChild(document.createTextNode(part));
        }
    });

    if (isMentioned) messageDiv.classList.add("chatMention");

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Reads the chat input, sends the message to the server, and clears the field.
function sendChatMessage() {
    // Spectators can watch chat but not send messages.
    if (!playerName) return;

    const message = chatInput.value.trim();

    // Don't send empty messages.
    if (message === "") return;

    // We only send the message text — the server looks up our name
    // from its own player record, so clients can't fake their identity.
    socket.emit("chatMessage", {
        message: message
    });

    chatInput.value = "";
}

// Allow sending by clicking the button...
sendButton.addEventListener("click", sendChatMessage);

// --- Profile Modal ---
const profileOverlay = document.getElementById("profileOverlay");

document.getElementById("profileClose").addEventListener("click", () => {
    profileOverlay.style.display = "none";
});

profileOverlay.addEventListener("click", (e) => {
    if (e.target === profileOverlay) profileOverlay.style.display = "none";
});

// --- Help Modal ---
const helpOverlay = document.getElementById("helpOverlay");

document.getElementById("helpButton").addEventListener("click", () => {
    helpOverlay.style.display = "flex";
});

document.getElementById("helpClose").addEventListener("click", () => {
    helpOverlay.style.display = "none";
});

// Clicking the dark backdrop behind the card also closes it.
helpOverlay.addEventListener("click", (e) => {
    if (e.target === helpOverlay) helpOverlay.style.display = "none";
});

// ...or by pressing Enter while focused on the chat input.
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        sendChatMessage();
    }
});

// ============================================================
// Game Logic
// ============================================================

// updatePlayer runs every frame and handles movement input.
function updatePlayer() {
    // Spectators haven't logged in yet — don't move anything.
    if (!playerName) return;

    // Frozen players cannot move — the server will also reject any
    // playerMove events they send, but we skip client-side movement
    // too so the player gets instant feedback.
    if (players[myId] && players[myId].frozen) {
        moveTarget = null;
        return;
    }

    // --- Point-and-Click Movement ---
    // If there's an active target, move the player toward it each frame.
    if (moveTarget) {
        const dx = moveTarget.x - player.x; // Horizontal distance to target
        const dy = moveTarget.y - player.y; // Vertical distance to target

        // Math.hypot() gives us the straight-line distance between the
        // player and the target using the Pythagorean theorem (a²+b²=c²).
        const distance = Math.hypot(dx, dy);

        if (distance <= player.speed) {
            // Close enough — snap to the target and stop moving.
            // Without this snap, the player would jitter back and forth
            // around the target because it keeps overshooting by tiny amounts.
            player.x = moveTarget.x;
            player.y = moveTarget.y;
            moveTarget = null;
        } else {
            // Normalize the direction vector (dx/distance, dy/distance) to get
            // a unit vector — a vector of length 1 pointing toward the target.
            // Multiplying by player.speed then gives a step of exactly that length,
            // so the player always moves at a consistent speed regardless of angle.
            player.x += (dx / distance) * player.speed;
            player.y += (dy / distance) * player.speed;
        }
    }

    // --- WASD Movement (commented out — may restore later) ---
    // if (keys["w"]) player.y -= player.speed;
    // if (keys["s"]) player.y += player.speed;
    // if (keys["a"]) player.x -= player.speed;
    // if (keys["d"]) player.x += player.speed;

    // Clamp the player's position so they can't move off the canvas edges.
    // player.size is subtracted from the right/bottom edges so the whole
    // square stays visible, not just the top-left corner.
    if (player.x < 0) player.x = 0;
    if (player.y < 0) player.y = 0;
    if (player.x > canvas.width - player.size) player.x = canvas.width - player.size;
    if (player.y > canvas.height - player.size) player.y = canvas.height - player.size;

    // Only send an update to the server if we actually moved.
    // Without this check, we'd emit hundreds of identical messages per
    // second even while standing still, wasting bandwidth.
    if (player.x !== lastEmittedX || player.y !== lastEmittedY) {
        socket.emit("playerMove", {
            x: player.x,
            y: player.y
        });

        // Record the position we just sent so we can compare next frame.
        lastEmittedX = player.x;
        lastEmittedY = player.y;

        // Update our entry in the shared players dictionary directly.
        // The server uses broadcast.emit for moves, meaning it doesn't
        // echo our own move back to us. So we update players[myId] here
        // ourselves to keep the drawn position in sync.
        if (myId && players[myId]) {
            players[myId].x = player.x;
            players[myId].y = player.y;
        }
    }
}

// ============================================================
// Drawing Functions
// ============================================================

// ============================================================
// Chat Text Effects (RuneScape-style)
// ============================================================
// Players can prefix their message with an effect name followed
// by a colon to trigger a visual effect on their chat bubble.
//
// Supported prefixes (case-insensitive):
//   wave:    — characters bob up and down in a sine wave
//   wave2:   — wave with alternating red/yellow colouring
//   shake:   — each character jitters randomly every frame
//   scroll:  — text slides back and forth horizontally
//   glow1:   — red → yellow colour gradient cycling across characters
//   glow2:   — blue → cyan colour gradient cycling
//   glow3:   — green → white colour gradient cycling
//   flash1:  — whole text flashes between red and yellow
//   flash2:  — whole text flashes between blue and cyan
//   flash3:  — whole text flashes between green and white
//
// Example: typing "wave:Hello!" displays "Hello!" with a wave effect.
// ============================================================

// Ordered longest-first so "wave2" is matched before "wave".
const EFFECT_PREFIXES = [
    "wave2", "wave", "shake", "scroll",
    "glow1", "glow2", "glow3",
    "flash1", "flash2", "flash3"
];

// Named colours available as chat prefixes.
// Values are valid CSS colour strings passed directly to fillStyle.
const COLOUR_MAP = {
    red:     "#cc0000",
    green:   "#008800",
    blue:    "#0000cc",
    yellow:  "#cccc00",
    cyan:    "#00aaaa",
    purple:  "#880088",
    white:   "#ffffff",
    orange:  "#cc6600",
    pink:    "#cc0066",
    lime:    "#00cc00"
};

// Parses an optional colour prefix then an optional effect prefix from a message.
// Supports any combination in the order: [colour:][effect:]text
//
// Examples:
//   "red:wave:Hello!"  → { colour: "#cc0000", effect: "wave",  text: "Hello!" }
//   "blue:Hello!"      → { colour: "#0000cc", effect: null,    text: "Hello!" }
//   "wave:Hello!"      → { colour: null,      effect: "wave",  text: "Hello!" }
//   "Hello!"           → { colour: null,      effect: null,    text: "Hello!" }
function parseEffect(message) {
    let colour = null;
    let effect = null;
    let remaining = message;

    // Check for a colour prefix first.
    const lowerRemaining = remaining.toLowerCase();
    for (const name of Object.keys(COLOUR_MAP)) {
        if (lowerRemaining.startsWith(name + ":")) {
            colour    = COLOUR_MAP[name];
            remaining = remaining.slice(name.length + 1);
            break;
        }
    }

    // Then check for an effect prefix in what's left.
    const lowerEffect = remaining.toLowerCase();
    for (const fx of EFFECT_PREFIXES) {
        if (lowerEffect.startsWith(fx + ":")) {
            effect    = fx;
            remaining = remaining.slice(fx.length + 1);
            break;
        }
    }

    return { colour, effect, text: remaining };
}

// Renders text character-by-character with the given effect and colour applied.
// colour overrides the default black — effects that cycle colour internally
// will ignore it (glow/flash), but positional effects (wave/shake/scroll) use it.
// centerX/baseY are the centre-bottom anchor.
function drawEffectText(ctx, text, centerX, baseY, effect, colour) {
    // t is a continuously increasing time value (seconds) used to animate effects.
    const t = Date.now() / 1000;

    ctx.font      = "12px Arial";
    ctx.textAlign = "left"; // We'll position each character manually

    // Measure total width so we can start at the correct X to keep
    // the text centred inside the bubble.
    const totalWidth = ctx.measureText(text).width;
    let x = centerX - totalWidth / 2;

    for (let i = 0; i < text.length; i++) {
        const ch       = text[i];
        const charWidth = ctx.measureText(ch).width;
        let dx = 0, dy = 0;

        switch (effect) {
            // ---- Positional effects ----

            // Positional effects — colour prefix applies; falls back to black.
            case "wave":
                dy = Math.sin(t * 4 + i * 0.6) * 3;
                ctx.fillStyle = colour || "black";
                break;

            case "wave2":
                // wave2 has its own built-in alternating colours; colour prefix ignored.
                dy = Math.sin(t * 4 + i * 0.8) * 4;
                ctx.fillStyle = i % 2 === 0 ? "#cc0000" : "#ffcc00";
                break;

            case "shake":
                dx = (Math.random() - 0.5) * 4;
                dy = (Math.random() - 0.5) * 4;
                ctx.fillStyle = colour || "black";
                break;

            case "scroll": {
                const slideRange = Math.min(totalWidth * 0.4, 20);
                dx = Math.sin(t * 1.5) * slideRange;
                ctx.fillStyle = colour || "#006600";
                break;
            }

            // Colour-cycling effects — colour prefix ignored (they manage their own hues).
            case "glow1":
                ctx.fillStyle = `hsl(${(t * 40 + i * 15) % 60}, 100%, 40%)`;
                break;

            case "glow2":
                ctx.fillStyle = `hsl(${180 + (t * 40 + i * 15) % 60}, 100%, 45%)`;
                break;

            case "glow3":
                ctx.fillStyle = `hsl(${90 + (t * 40 + i * 15) % 60}, 100%, 38%)`;
                break;

            case "flash1":
                ctx.fillStyle = Math.sin(t * 6) > 0 ? "#dd0000" : "#ffcc00";
                break;

            case "flash2":
                ctx.fillStyle = Math.sin(t * 6) > 0 ? "#0000cc" : "#00cccc";
                break;

            case "flash3":
                ctx.fillStyle = Math.sin(t * 6) > 0 ? "#008800" : "#ffffff";
                break;

            default:
                // No effect — just apply the colour if one was set.
                ctx.fillStyle = colour || "black";
        }

        ctx.fillText(ch, x + dx, baseY + dy);
        x += charWidth; // Advance to the next character position
    }

    // Reset state so subsequent drawing calls aren't affected.
    ctx.textAlign = "center";
    ctx.fillStyle = "black";
}

// Draws a rectangle with rounded corners using canvas arc/curve commands.
// Parameters: ctx = drawing context, x/y = top-left corner, w/h = size, r = corner radius
function drawRoundedRect(ctx, x, y, w, h, r) {
    // beginPath() starts a new shape — without this, new lines would
    // connect to whatever was drawn previously.
    ctx.beginPath();

    // We trace the outline of the rounded rectangle by:
    // 1. Drawing straight lines along each edge (stopping before the corners)
    // 2. Using quadraticCurveTo() to draw each rounded corner
    ctx.moveTo(x + r, y);                              // Start just inside top-left corner
    ctx.lineTo(x + w - r, y);                          // Top edge
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);     // Top-right corner
    ctx.lineTo(x + w, y + h - r);                      // Right edge
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); // Bottom-right corner
    ctx.lineTo(x + r, y + h);                          // Bottom edge
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);     // Bottom-left corner
    ctx.lineTo(x, y + r);                              // Left edge
    ctx.quadraticCurveTo(x, y, x + r, y);             // Top-left corner
    ctx.closePath();                                   // Connect back to the start
}

// draw() renders every player onto the canvas each frame.
function draw() {
    // Wipe the entire canvas before redrawing — without this, movement
    // would leave a trail of squares across the screen.
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw local click ripples (purely cosmetic, never synced to server).
    const now = performance.now();
    for (let i = clickRipples.length - 1; i >= 0; i--) {
        const r = clickRipples[i];
        const t = (now - r.startTime) / RIPPLE_DURATION; // 0 → 1
        if (t >= 1) { clickRipples.splice(i, 1); continue; }
        const radius = t * RIPPLE_MAX_RADIUS;
        const alpha  = 1 - t;
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Loop over every player in our dictionary and draw them.
    for (let id in players) {
        let p = players[id];

        // Fall back to 20 if the player object doesn't have a size property
        // (e.g. players received from the server before size was added).
        const size = p.size || 20;

        // Draw the player square in their chosen avatar color.
        // Bots are always orange; real players use their saved color (default green).
        ctx.fillStyle = p.isBot ? "#ffa726" : (p.avatar?.color || "#4caf50");
        ctx.fillRect(p.x, p.y, size, size);

        // Frozen players get a blue outline drawn inside the square.
        if (p.frozen) {
            ctx.strokeStyle = "#64b5f6";
            ctx.lineWidth   = 2;
            ctx.strokeRect(p.x + 1, p.y + 1, size - 2, size - 2);
        }

        // The local player gets a white outline drawn outside the square
        // so they can always find themselves on screen regardless of color.
        if (id === myId) {
            ctx.strokeStyle = "white";
            ctx.lineWidth   = 2;
            ctx.strokeRect(p.x - 1, p.y - 1, size + 2, size + 2);
        }

        // --- Draw Player Name ---
        ctx.fillStyle = "white";
        ctx.font = "14px Arial";
        ctx.textAlign = "center"; // Coordinates passed to fillText will be the text's center

        // Default: name sits just above the player square.
        let nameY = p.y - 5;

        // If the player is near the top edge, flip the name below the square
        // so it doesn't get clipped by the canvas boundary.
        if (p.y < 20) {
            nameY = p.y + 30;
        }

        // Build the display name with status suffixes appended.
        // e.g. "PlayerName", "PlayerName - Muted", "PlayerName - Frozen", "PlayerName - Muted - Frozen"
        let displayName = p.name;
        if (p.muted)  displayName += " - Muted";
        if (p.frozen) displayName += " - Frozen";

        // Measure the full display name for edge clamping.
        const nameWidth = ctx.measureText(displayName).width;

        const nameX = Math.max(
            nameWidth / 2 + 5,
            Math.min(canvas.width - nameWidth / 2 - 5, p.x + size / 2)
        );

        // Draw each part of the name in the appropriate colour.
        // We split into segments so "PlayerName" stays white while
        // the status suffixes are coloured orange/blue.
        if (!p.muted && !p.frozen) {
            ctx.fillStyle = "white";
            ctx.fillText(displayName, nameX, nameY);
        } else {
            // Measure just the base name to find the split point.
            const baseWidth  = ctx.measureText(p.name).width;
            const totalWidth = ctx.measureText(displayName).width;
            const startX     = nameX - totalWidth / 2; // left edge of the full string

            ctx.fillStyle = "white";
            ctx.textAlign = "left";
            ctx.fillText(p.name, startX, nameY);

            let offsetX = startX + baseWidth;
            if (p.muted) {
                ctx.fillStyle = "#ffa726"; // Orange
                const seg = p.frozen ? " - Muted" : " - Muted";
                ctx.fillText(seg, offsetX, nameY);
                offsetX += ctx.measureText(seg).width;
            }
            if (p.frozen) {
                ctx.fillStyle = "#64b5f6"; // Blue
                ctx.fillText(" - Frozen", offsetX, nameY);
            }

            ctx.textAlign = "center"; // Restore for the rest of the draw loop
        }

        // --- Draw Chat Bubble ---
        // How long (in milliseconds) the bubble stays visible after a message.
        const bubbleDuration = 3000;

        // Only draw the bubble if there's a message AND it hasn't expired yet.
        if (p.chatBubble && Date.now() - p.chatTimestamp < bubbleDuration) {

            // Strip any colour/effect prefixes from the raw message.
            // e.g. "red:wave:Hello!" → { colour: "#cc0000", effect: "wave", text: "Hello!" }
            const { colour, effect, text: bubbleText } = parseEffect(p.chatBubble);

            ctx.font = "12px Arial";
            ctx.textAlign = "center";

            // Measure the display text (without the prefix) to size the bubble.
            const textWidth = ctx.measureText(bubbleText).width;
            const bubbleWidth = textWidth + 20;  // 10px padding on each side
            const bubbleHeight = 24;

            // Default: bubble appears 50px above the player's top edge.
            // Center it horizontally over the player.
            let bubbleX = p.x + size / 2 - bubbleWidth / 2;
            let bubbleY = p.y - 50;

            // Clamp the bubble horizontally so it doesn't go off the canvas sides.
            if (bubbleX < 5) bubbleX = 5;
            if (bubbleX + bubbleWidth > canvas.width - 5)
                bubbleX = canvas.width - bubbleWidth - 5;

            // If the bubble would go above the canvas top, move it below the player instead.
            if (bubbleY < 0) {
                bubbleY = p.y + 35;
            }

            // Draw the rounded white bubble background.
            ctx.fillStyle = "white";
            drawRoundedRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 6);
            ctx.fill();    // Fill with the current fillStyle (white)

            // Draw a thin black border around the bubble.
            ctx.strokeStyle = "black";
            ctx.lineWidth = 2;
            ctx.stroke();  // Stroke uses the path we already defined with drawRoundedRect

            // Draw the message text centered inside the bubble.
            // If an effect prefix was found, drawEffectText handles per-character
            // animation. Otherwise it falls back to plain black text.
            if (effect || colour) {
                // drawEffectText handles both animated effects and plain colour.
                // Passing effect=null with a colour just applies the solid colour.
                drawEffectText(ctx, bubbleText, bubbleX + bubbleWidth / 2, bubbleY + 16, effect, colour);
            } else {
                ctx.fillStyle = "black";
                ctx.fillText(bubbleText, bubbleX + bubbleWidth / 2, bubbleY + 16);
            }

            // --- Draw the Tail ---
            // The tail is a small triangle that points from the bubble toward the player,
            // making it clear which player the bubble belongs to.
            let tailX = p.x + size / 2; // Horizontally centered on the player
            let tailY, tailTipY;

            if (bubbleY < p.y) {
                // Bubble is ABOVE the player — tail hangs down from the bubble's bottom.
                tailY = bubbleY + bubbleHeight; // Base of the triangle sits at bubble bottom
                tailTipY = tailY + 8;           // Tip points downward toward the player
            } else {
                // Bubble is BELOW the player — tail rises up from the bubble's top.
                tailY = bubbleY;                // Base sits at bubble top
                tailTipY = tailY - 8;           // Tip points upward toward the player
            }

            // Draw the triangle.
            ctx.beginPath();
            ctx.moveTo(tailX - 6, tailY);   // Left base point
            ctx.lineTo(tailX + 6, tailY);   // Right base point
            ctx.lineTo(tailX, tailTipY);    // Tip (pointing toward the player)
            ctx.closePath();

            ctx.fillStyle = "white";
            ctx.fill();

            ctx.strokeStyle = "black";
            ctx.stroke();
        }
    }
}

// ============================================================
// Game Loop
// ============================================================

// gameLoop runs once per animation frame (typically 60 times per second).
// It updates the game state and then redraws everything.
function gameLoop() {
    updatePlayer(); // Process input and sync position
    draw();         // Redraw the canvas with updated state

    // requestAnimationFrame tells the browser to call gameLoop again
    // before the next screen repaint. This syncs our game to the display's
    // refresh rate and pauses automatically when the tab is hidden.
    requestAnimationFrame(gameLoop);
}

// Kick off the game loop for the first time.
gameLoop();
