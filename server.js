// ============================================================
// OpenRealm - Server
// ============================================================
// This file runs on Node.js and is the backbone of the game.
// It handles all communication between players using a system
// called WebSockets (via Socket.IO), which keeps a live
// two-way connection open between each browser and the server.
// ============================================================

// --- Load Environment Variables ---
// dotenv reads the .env file and adds its values to process.env,
// making them accessible anywhere in the server via process.env.KEY.
// This must be called before any other code that uses process.env.
require("dotenv").config();

// --- Dependencies ---
// Express is a web framework that makes it easy to serve files
// and handle HTTP requests.
const express = require("express");

// 'path' is a built-in Node module that helps build file paths
// correctly across different operating systems
const path = require("path");

// 'http' is a built-in Node module used to create the web server.
// We need it separately from Express so Socket.IO can attach to it.
const http = require("http");

// Socket.IO handles real-time communication. It runs on top of the
// HTTP server and opens a persistent connection with each client so
// they can send and receive messages instantly without refreshing.
const { Server } = require("socket.io");

// jsonwebtoken lets us verify the JWT the client sends on join,
// so we can confirm admin status server-side (never trust the client).
const jwt = require("jsonwebtoken");

// Mongoose is an ODM (Object Document Mapper) for MongoDB.
// It lets us define schemas and interact with the database using
// JavaScript objects instead of raw MongoDB queries.
const mongoose = require("mongoose");

// Our auth routes — handles /api/register and /api/login.
const authRoutes = require("./routes/auth");
const User       = require("./models/User");

// --- Database Connection ---
// Connect to MongoDB Atlas using the URI stored in .env.
// mongoose.connect() returns a promise, so we use .then/.catch
// to log success or failure when the server starts.
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("MongoDB connection error:", err));

// --- App Setup ---
const app = express();

// express.json() is middleware that parses incoming request bodies
// with a Content-Type of "application/json". Without this, req.body
// would be undefined in our auth routes.
app.use(express.json());

// Wrap Express inside a raw HTTP server. Socket.IO needs access to
// this lower-level server to handle WebSocket upgrades.
const server = http.createServer(app);

// Attach Socket.IO to the HTTP server. 'io' is our main object for
// broadcasting messages to all connected clients.
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Tell Express to automatically serve any files in the "public" folder.
// When a browser requests "/game.js", Express finds and returns
// "public/game.js" without us needing to write a route for every file.
app.use(express.static(path.join(__dirname, "public")));

// Mount the auth routes under "/api".
// Any request to /api/register or /api/login will be handled by routes/auth.js.
app.use("/api", authRoutes);

// --- Game State ---
// A plain object used as a dictionary to track every connected player.
// Keys are socket IDs (unique strings assigned by Socket.IO).
// Values are player data objects: { name, x, y, chatBubble, chatTimestamp }
const players = {};

// Maps username → socket ID so we can detect and kick duplicate logins.
// When the same account joins from a second tab/window, the first
// connection is disconnected before the new one is registered.
const userSockets = {};

// Validation constants — used to sanitize data coming from clients.
// Never trust data from the client directly; a bad actor could send
// anything, so we clamp and validate everything on the server.
const MAX_NAME_LENGTH = 20;
const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;

// ============================================================
// Bot System
// ============================================================
// Bots are fake players stored in the players dictionary just
// like real ones, but keyed with a "bot_" prefix and driven by
// a server-side interval rather than socket input.
// botIntervals maps botId → intervalId so we can clear it on removal.
// ============================================================
const botIntervals = {};
let botCounter = 0; // Incremented each time a bot is created for unique IDs

function createBot(x, y) {
    const id   = `bot_${++botCounter}`;
    const name = `Bot${botCounter}`;

    players[id] = {
        name,
        x,
        y,
        size:          20,
        chatBubble:    "",
        chatTimestamp: 0,
        muted:         false,
        frozen:        false,
        isAdmin:       false,
        isBot:         true,        // Flag so clients can distinguish bots
        joinedAt:      Date.now()
    };

    // Tell all clients a new "player" (bot) has appeared.
    io.emit("newPlayer", { id, name, x, y, isBot: true, joinedAt: players[id].joinedAt });

    // Bots wander by picking a new random target every 2–4 seconds
    // and moving toward it in small steps each tick (100ms).
    let targetX = x;
    let targetY = y;

    const pickTarget = () => {
        // Pick a random destination within world bounds.
        targetX = Math.floor(Math.random() * (WORLD_WIDTH  - 20));
        targetY = Math.floor(Math.random() * (WORLD_HEIGHT - 20));
    };

    pickTarget();
    // Pick a new wander target every 2–4 seconds.
    const wanderTimer = setInterval(pickTarget, 2000 + Math.random() * 2000);

    // Move the bot 2px per tick toward its current target.
    const moveTimer = setInterval(() => {
        if (!players[id] || players[id].frozen) return;

        const dx = targetX - players[id].x;
        const dy = targetY - players[id].y;
        const dist = Math.hypot(dx, dy);

        if (dist > 2) {
            players[id].x += (dx / dist) * 2;
            players[id].y += (dy / dist) * 2;
            io.emit("playerMoved", { id, x: players[id].x, y: players[id].y });
        }
    }, 100);

    // Store both interval IDs so removeBot() can clean them up.
    botIntervals[id] = [wanderTimer, moveTimer];

    return id;
}

function removeBot(id) {
    if (!players[id] || !players[id].isBot) return;

    // Stop the bot's movement and wander timers.
    if (botIntervals[id]) {
        botIntervals[id].forEach(clearInterval);
        delete botIntervals[id];
    }

    delete players[id];
    io.emit("playerDisconnected", id);
}

// --- Socket.IO Connection Handler ---
// This callback runs every time a new client connects.
// Each client gets their own 'socket' object — think of it as a
// dedicated phone line between the server and that one player.
// Calculates and broadcasts the current spectator count to all clients.
// Spectators are sockets that are connected but haven't sent a "join" event.
// Total connected sockets minus the number of active (non-bot) players gives us the count.
function broadcastSpectatorCount() {
    const activePlayers = Object.values(players).filter(p => !p.isBot).length;
    const totalSockets  = io.sockets.sockets.size;
    const spectators    = Math.max(0, totalSockets - activePlayers);
    io.emit("spectatorCount", spectators);
}

// --- scheduleExpiry ---
// Sets a setTimeout to auto-reverse a timed mute or freeze for `targetId`.
// Expects players[targetId].muteExpiresAt / freezeExpiresAt to already be set.
// When the timer fires it clears the in-memory state, updates MongoDB,
// and broadcasts the change to all clients.
function scheduleExpiry(targetId, type) {
    const timerKey  = type === "mute" ? "muteTimer"       : "freezeTimer";
    const expiryKey = type === "mute" ? "muteExpiresAt"   : "freezeExpiresAt";
    const statusKey = type === "mute" ? "muted"           : "frozen";
    const dbKey     = type === "mute" ? "muteRemainingMs" : "freezeRemainingMs";

    const remaining = players[targetId][expiryKey] - Date.now();

    if (remaining <= 0) {
        // Expiry already passed (e.g. player was offline longer than the duration).
        players[targetId][statusKey] = false;
        User.updateOne({ username: players[targetId].name }, { [dbKey]: null }).catch(() => {});
        return;
    }

    players[targetId][timerKey] = setTimeout(async () => {
        if (!players[targetId]) return; // player disconnected in the meantime
        players[targetId][statusKey] = false;
        players[targetId][timerKey]  = null;
        players[targetId][expiryKey] = null;

        await User.updateOne({ username: players[targetId].name }, { [dbKey]: null });

        io.emit("playerStatusUpdate", {
            id:     targetId,
            muted:  players[targetId].muted,
            frozen: players[targetId].frozen
        });
        io.emit("chatMessage", {
            name:    "System",
            message: `${players[targetId].name}'s ${type} has expired`
        });
    }, remaining);
}

io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

    // Send the current player list to spectators immediately on connect.
    // This lets unauthenticated visitors see other players moving around
    // before they decide to register. They receive the same playerMoved
    // broadcasts as everyone else, so the view stays live.
    socket.emit("currentPlayers", players);

    // A new socket just connected — spectator count goes up.
    broadcastSpectatorCount();

    // --- Event: "join" ---
    // Fired by the client right after connecting, sending the player's
    // chosen name and starting position.
    socket.on("join", async (data) => {

        // Sanitize the name: make sure it's a string, remove leading/trailing
        // spaces, and cap it at MAX_NAME_LENGTH characters.
        // If the result is empty (e.g. the player typed only spaces), default to "Player".
        const name = typeof data.name === "string"
            ? data.name.trim().slice(0, MAX_NAME_LENGTH) || "Player"
            : "Player";

        // Clamp x and y to keep the player inside the world.
        // Math.max(0, ...) prevents negative values (off the left/top edge).
        // Math.min(..., WORLD_WIDTH) prevents values beyond the right/bottom edge.
        // Number() converts the value to a number; || 400 provides a safe default
        // if the conversion fails (e.g. the client sent a string like "abc").
        const x = Math.max(0, Math.min(Number(data.x) || 400, WORLD_WIDTH));
        const y = Math.max(0, Math.min(Number(data.y) || 300, WORLD_HEIGHT));

        // --- Duplicate Login Check ---
        // If this username is already connected on another socket, disconnect
        // that old session before registering the new one. This prevents two
        // copies of the same player appearing when someone opens a second tab.
        if (userSockets[name]) {
            const oldSocket = io.sockets.sockets.get(userSockets[name]);
            if (oldSocket) {
                oldSocket.emit("forcedDisconnect", "You logged in from another window.");
                oldSocket.disconnect(true);
            }
        }

        // Track which socket owns this username.
        userSockets[name] = socket.id;

        // --- Verify Token & Extract Admin Status ---
        // The client sends its JWT on join. We verify it server-side so
        // a player can't simply set isAdmin = true in their browser console.
        let isAdmin = false;
        if (data.token) {
            try {
                const decoded = jwt.verify(data.token, process.env.JWT_SECRET);
                isAdmin = decoded.isAdmin || false;
            } catch (e) {
                console.warn("JWT verify failed:", e.message);
            }
        }
        socket.data.isAdmin = isAdmin;

        // Store this player in our server-side dictionary.
        players[socket.id] = {
            name,
            x,
            y,
            chatBubble:    "",
            chatTimestamp: 0,
            muted:         false,  // Muted players cannot send chat messages
            frozen:        false,  // Frozen players cannot move
            isAdmin,
            joinedAt:      Date.now()  // Unix timestamp — used for join-time sort on the client
        };

        // --- Restore active mute/freeze from MongoDB ---
        // The timer was paused when the player last disconnected. We resume it
        // here using the remaining milliseconds stored in their DB record.
        // -1 = permanent (no timer needed), positive = resume countdown.
        try {
            const user = await User.findOne(
                { username: name },
                "muteRemainingMs freezeRemainingMs avatar"
            );
            if (user) {
                // Restore avatar color saved from a previous session.
                players[socket.id].avatar = { color: user.avatar?.color || "#4caf50" };

                if (user.muteRemainingMs !== null && user.muteRemainingMs !== undefined) {
                    players[socket.id].muted = true;
                    if (user.muteRemainingMs > 0) {
                        players[socket.id].muteExpiresAt = Date.now() + user.muteRemainingMs;
                        scheduleExpiry(socket.id, "mute");
                    }
                    // -1 = permanent: muted stays true, no timer set
                }
                if (user.freezeRemainingMs !== null && user.freezeRemainingMs !== undefined) {
                    players[socket.id].frozen = true;
                    if (user.freezeRemainingMs > 0) {
                        players[socket.id].freezeExpiresAt = Date.now() + user.freezeRemainingMs;
                        scheduleExpiry(socket.id, "freeze");
                    }
                }
            }
        } catch (e) {
            console.error("join DB restore error:", e.message);
        }

        // Confirm verified admin status back to the joining client.
        // The client also decodes isAdmin from the JWT payload, but that
        // doesn't validate the signature. This event is the ground truth.
        socket.emit("joinConfirmed", { isAdmin });

        // Send the full current player list back to THIS player only.
        // socket.emit() targets only the sender — the new player needs to
        // know about everyone already in the game.
        socket.emit("currentPlayers", players);

        // Tell all OTHER connected clients that a new player has arrived.
        // socket.broadcast.emit() sends to everyone except the sender.
        socket.broadcast.emit("newPlayer", {
            id:       socket.id,
            name,
            x,
            y,
            muted:    players[socket.id].muted,
            frozen:   players[socket.id].frozen,
            avatar:   players[socket.id].avatar,
            joinedAt: players[socket.id].joinedAt
        });

        // If the rejoining player has an active restriction, broadcast their
        // status so all clients show the correct badges immediately.
        if (players[socket.id].muted || players[socket.id].frozen) {
            io.emit("playerStatusUpdate", {
                id:     socket.id,
                muted:  players[socket.id].muted,
                frozen: players[socket.id].frozen
            });
        }

        // Announce in chat that this player joined.
        // io.emit() sends to ALL clients including the sender.
        io.emit("chatMessage", {
            name: "System",
            message: `${name} joined OpenRealm`
        });

        // A spectator just became a player — spectator count goes down.
        broadcastSpectatorCount();
    });

    // --- Event: "playerMove" ---
    // Fired by the client whenever the player's position changes.
    // We update the server's record and relay the new position to
    // all other players so their screens stay in sync.
    socket.on("playerMove", (data) => {
        // Guard: make sure this socket has a registered player and is not frozen.
        if (players[socket.id] && !players[socket.id].frozen) {
            // Clamp the incoming coordinates to valid world bounds,
            // just like we did in "join" — clients could send anything.
            const x = Math.max(0, Math.min(Number(data.x) || 0, WORLD_WIDTH));
            const y = Math.max(0, Math.min(Number(data.y) || 0, WORLD_HEIGHT));

            // Update the server's authoritative record of this player's position.
            players[socket.id].x = x;
            players[socket.id].y = y;

            // Relay the new position to everyone else.
            // We use socket.broadcast.emit (not io.emit) because the moving
            // player already updated their own position locally on the client —
            // there's no need to send it back to them.
            socket.broadcast.emit("playerMoved", {
                id: socket.id,
                x,
                y
            });
        }
    });

    // --- Event: "chatMessage" ---
    // Fired when a player sends a chat message.
    socket.on("chatMessage", (data) => {
        // Guard: ignore messages from sockets that haven't joined or are muted.
        if (!players[socket.id]) return;
        if (players[socket.id].muted) return;

        // Sanitize the message: must be a string, trimmed, max 200 characters.
        // This prevents spam, XSS attempts, or oversized payloads.
        const message = typeof data.message === "string"
            ? data.message.trim().slice(0, 200)
            : "";

        // If the message is empty after sanitization, ignore it entirely.
        if (!message) return;

        // Use the server's stored name rather than any name the client sent.
        // This prevents a player from faking another player's name in chat.
        const name = players[socket.id].name;

        // Store the message on the player so the chat bubble can be drawn.
        players[socket.id].chatBubble = message;
        players[socket.id].chatTimestamp = Date.now();

        // Broadcast the message to all clients (including the sender so
        // their own chat log and bubble update correctly).
        io.emit("chatMessage", {
            id: socket.id,
            name,
            message,
            timestamp: Date.now()
        });

        // --- Bot @mention replies ---
        // If the message contains @BotName matching a live bot, the bot
        // replies with a random message after a short natural-feeling delay.
        const BOT_REPLIES = [
            "Hi!", "Hello there!", "Hey!", "Greetings!",
            "Oh, you talking to me?", "Beep boop.", "...",
            "What do you want?", "I'm just a bot!",
            "👋", "Leave me alone, I'm wandering."
        ];

        const mentions = [...message.matchAll(/@(\S+)/g)].map(m => m[1].toLowerCase());
        mentions.forEach(mentioned => {
            const botEntry = Object.entries(players).find(
                ([, p]) => p.isBot && p.name.toLowerCase() === mentioned
            );
            if (!botEntry) return;
            const [botId, bot] = botEntry;
            const reply = BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
            setTimeout(() => {
                if (!players[botId]) return;
                players[botId].chatBubble    = reply;
                players[botId].chatTimestamp = Date.now();
                io.emit("chatMessage", {
                    id:        botId,
                    name:      bot.name,
                    message:   reply,
                    timestamp: Date.now()
                });
            }, 800 + Math.random() * 1000);
        });
    });

    // --- Event: "spawnBot" ---
    // Admin places a bot at a specific canvas position.
    socket.on("spawnBot", ({ x, y }) => {
        if (!socket.data.isAdmin) return;
        const cx = Math.max(0, Math.min(Number(x) || 0, WORLD_WIDTH));
        const cy = Math.max(0, Math.min(Number(y) || 0, WORLD_HEIGHT));
        const botId = createBot(cx, cy);
        const adminName = players[socket.id]?.name || "Admin";
        io.emit("chatMessage", {
            name: "System",
            message: `${adminName} created ${players[botId].name}`
        });
    });

    // --- Event: "removeBot" ---
    // Admin removes a bot by its ID.
    socket.on("removeBot", ({ botId }) => {
        if (!socket.data.isAdmin) return;
        if (!players[botId]) return;
        const adminName = players[socket.id]?.name || "Admin";
        const botName   = players[botId].name;
        removeBot(botId);
        io.emit("chatMessage", {
            name: "System",
            message: `${adminName} removed ${botName}`
        });
    });

    // --- Event: "adminAction" ---
    // Sent by admin clients to mute, unmute, freeze, or unfreeze a player.
    // Optional `duration` (minutes) auto-reverses mute/freeze after that time.
    // Timed actions are persisted to MongoDB so the timer pauses between sessions —
    // re-logging resumes the countdown from where it left off, not from zero.
    // `duration` null = permanent; omitted entirely for unmute/unfreeze.
    // We verify isAdmin server-side — the client's claim alone is never trusted.
    socket.on("adminAction", async ({ targetId, action, duration }) => {
        if (!socket.data.isAdmin) return;
        if (!players[targetId]) return;

        // Note whether a timed restriction was active before we clear it —
        // used below to include a "timer cleared" note in the chat message.
        const hadActiveTimer = (action === "unmute"   && !!players[targetId].muteTimer)
                            || (action === "unfreeze" && !!players[targetId].freezeTimer);

        // Clear any existing auto-expire timer for this status type before changing it.
        if (action === "mute" || action === "unmute") {
            clearTimeout(players[targetId].muteTimer);
            players[targetId].muteTimer     = null;
            players[targetId].muteExpiresAt = null;
        }
        if (action === "freeze" || action === "unfreeze") {
            clearTimeout(players[targetId].freezeTimer);
            players[targetId].freezeTimer     = null;
            players[targetId].freezeExpiresAt = null;
        }

        if      (action === "mute")     players[targetId].muted  = true;
        else if (action === "unmute")   players[targetId].muted  = false;
        else if (action === "freeze")   players[targetId].frozen = true;
        else if (action === "unfreeze") players[targetId].frozen = false;
        else return;

        // Persist to MongoDB for real players so the restriction survives re-logins.
        // Bots have no DB record, so we skip them.
        if (!players[targetId].isBot) {
            const isMuteType = action === "mute"   || action === "unmute";
            const isRemoving = action === "unmute" || action === "unfreeze";
            const dbKey      = isMuteType ? "muteRemainingMs" : "freezeRemainingMs";
            // null = cleared, -1 = permanent sentinel, positive = ms remaining
            const dbValue    = isRemoving ? null
                             : duration   ? duration * 60 * 1000
                             :              -1;
            try {
                await User.updateOne({ username: players[targetId].name }, { [dbKey]: dbValue });
            } catch (e) {
                console.error("adminAction DB error:", e.message);
            }
        }

        // Broadcast the updated status to every client so badges update live.
        io.emit("playerStatusUpdate", {
            id:     targetId,
            muted:  players[targetId].muted,
            frozen: players[targetId].frozen
        });

        // Announce the action in chat so everyone can see it.
        const adminName  = players[socket.id]?.name  || "Admin";
        const targetName = players[targetId]?.name   || "Player";
        const pastTense  = { mute: "muted", unmute: "unmuted", freeze: "froze", unfreeze: "unfroze" };
        const durationLabel   = duration       ? ` for ${duration} minute${duration === 1 ? "" : "s"}` : "";
        const timerClearedNote = hadActiveTimer ? " (timer cleared)" : "";
        io.emit("chatMessage", {
            name: "System",
            message: `${adminName} ${pastTense[action]} ${targetName}${durationLabel}${timerClearedNote}`
        });

        // Schedule auto-expiry for timed mute/freeze (not permanent).
        if (duration && (action === "mute" || action === "freeze")) {
            const expiryKey = action === "mute" ? "muteExpiresAt" : "freezeExpiresAt";
            players[targetId][expiryKey] = Date.now() + duration * 60 * 1000;
            scheduleExpiry(targetId, action);
        }
    });

    // --- Event: "updateAvatar" ---
    // Sent when a player picks a new avatar color from the swatch panel.
    // We validate the hex value server-side before saving to prevent injection,
    // update the in-memory player, persist to MongoDB, and broadcast to all
    // clients so the change is visible to everyone immediately.
    socket.on("updateAvatar", async ({ color }) => {
        if (!players[socket.id]) return;
        if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return;

        players[socket.id].avatar = { color };

        try {
            await User.updateOne({ username: players[socket.id].name }, { "avatar.color": color });
        } catch (e) {
            console.error("updateAvatar DB error:", e.message);
        }

        io.emit("playerAvatarUpdate", { id: socket.id, avatar: { color } });
    });

    // --- Event: "getProfile" ---
    // Any logged-in player can request the public profile of another player.
    // We respond only to the requester (socket.emit, not io.emit) with:
    //   - name, avatar colour, joinedAt (from live players dict)
    //   - createdAt (from MongoDB — when they registered their account)
    // Bots don't have a DB record, so we return a simplified profile for them.
    socket.on("getProfile", async ({ targetId }) => {
        if (!players[socket.id]) return; // Must be logged in to view profiles
        const target = players[targetId];
        if (!target) return;

        // Base profile from the live players dictionary.
        const profile = {
            id:       targetId,
            name:     target.name,
            avatar:   target.avatar || { color: target.isBot ? "#ffa726" : "#4caf50" },
            joinedAt: target.joinedAt,
            isBot:    target.isBot || false,
            createdAt: null
        };

        // For real players, look up their registration date from MongoDB.
        if (!target.isBot) {
            try {
                const user = await User.findOne({ username: target.name }, "createdAt");
                if (user) profile.createdAt = user.createdAt;
            } catch (e) {
                console.error("getProfile DB error:", e.message);
            }
        }

        socket.emit("profileData", profile);
    });

    // --- Event: "disconnect" ---
    // Fires automatically when a player closes their browser tab,
    // loses connection, or navigates away.
    socket.on("disconnect", () => {
        // If the player had joined, announce their departure in chat.
        if (players[socket.id]) {
            io.emit("chatMessage", {
                name: "System",
                message: `${players[socket.id].name} left OpenRealm`
            });
        }

        console.log("Player disconnected:", socket.id);

        // Pause timed mute/freeze: write the remaining ms back to MongoDB so the
        // countdown resumes from where it left off when the player rejoins.
        if (players[socket.id] && !players[socket.id].isBot) {
            const p = players[socket.id];
            const updates = {};

            if (p.muteTimer && p.muteExpiresAt) {
                updates.muteRemainingMs = Math.max(0, p.muteExpiresAt - Date.now());
            }
            if (p.freezeTimer && p.freezeExpiresAt) {
                updates.freezeRemainingMs = Math.max(0, p.freezeExpiresAt - Date.now());
            }

            if (Object.keys(updates).length) {
                User.updateOne({ username: p.name }, updates).catch(() => {});
            }

            clearTimeout(p.muteTimer);
            clearTimeout(p.freezeTimer);
        }

        // Remove them from the server's player dictionary so they
        // no longer take up memory or appear in currentPlayers snapshots.
        delete players[socket.id];

        // Clean up the username → socket mapping, but only if it still
        // points to this socket. If a duplicate login already replaced it
        // with a new socket ID, we don't want to wipe that newer entry.
        for (const [username, sid] of Object.entries(userSockets)) {
            if (sid === socket.id) {
                delete userSockets[username];
                break;
            }
        }

        // Tell all clients to remove this player from their local state.
        io.emit("playerDisconnected", socket.id);

        // Someone left — recalculate the spectator count.
        broadcastSpectatorCount();
    });
});

// --- Start the Server ---
// Begin listening for incoming connections on the specified port.
// The callback runs once the server is ready.
server.listen(PORT, () => {
    console.log(`OpenRealm server running at http://localhost:${PORT}`);
});
