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

// Mongoose is an ODM (Object Document Mapper) for MongoDB.
// It lets us define schemas and interact with the database using
// JavaScript objects instead of raw MongoDB queries.
const mongoose = require("mongoose");

// Our auth routes — handles /api/register and /api/login.
const authRoutes = require("./routes/auth");

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

const PORT = 3000;

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

// Validation constants — used to sanitize data coming from clients.
// Never trust data from the client directly; a bad actor could send
// anything, so we clamp and validate everything on the server.
const MAX_NAME_LENGTH = 20;
const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;

// --- Socket.IO Connection Handler ---
// This callback runs every time a new client connects.
// Each client gets their own 'socket' object — think of it as a
// dedicated phone line between the server and that one player.
io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

    // Send the current player list to spectators immediately on connect.
    // This lets unauthenticated visitors see other players moving around
    // before they decide to register. They receive the same playerMoved
    // broadcasts as everyone else, so the view stays live.
    socket.emit("currentPlayers", players);

    // --- Event: "join" ---
    // Fired by the client right after connecting, sending the player's
    // chosen name and starting position.
    socket.on("join", (data) => {

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

        // Store this player in our server-side dictionary.
        players[socket.id] = {
            name,
            x,
            y,
            chatBubble: "",    // The last message this player sent (shown above their head)
            chatTimestamp: 0   // When they sent it (used to expire the bubble after 3 seconds)
        };

        // Send the full current player list back to THIS player only.
        // socket.emit() targets only the sender — the new player needs to
        // know about everyone already in the game.
        socket.emit("currentPlayers", players);

        // Tell all OTHER connected clients that a new player has arrived.
        // socket.broadcast.emit() sends to everyone except the sender.
        socket.broadcast.emit("newPlayer", {
            id: socket.id,
            name,
            x,
            y
        });

        // Announce in chat that this player joined.
        // io.emit() sends to ALL clients including the sender.
        io.emit("chatMessage", {
            name: "System",
            message: `${name} joined OpenRealm`
        });
    });

    // --- Event: "playerMove" ---
    // Fired by the client whenever the player's position changes.
    // We update the server's record and relay the new position to
    // all other players so their screens stay in sync.
    socket.on("playerMove", (data) => {
        // Guard: make sure this socket has a registered player before acting.
        if (players[socket.id]) {
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
        // Guard: ignore messages from sockets that haven't joined yet.
        if (!players[socket.id]) return;

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

        // Remove them from the server's player dictionary so they
        // no longer take up memory or appear in currentPlayers snapshots.
        delete players[socket.id];

        // Tell all clients to remove this player from their local state.
        io.emit("playerDisconnected", socket.id);
    });
});

// --- Start the Server ---
// Begin listening for incoming connections on the specified port.
// The callback runs once the server is ready.
server.listen(PORT, () => {
    console.log(`OpenRealm server running at http://localhost:${PORT}`);
});
