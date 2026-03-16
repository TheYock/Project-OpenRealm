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

// Prompt the player for their name before anything else happens.
// prompt() is a built-in browser function that shows a dialog box.
// The || "Player" fallback is used if they dismiss the dialog or
// leave it blank.
const playerName = prompt("Enter your name:", "Player") || "Player";

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

// --- Keyboard Input ---
// A dictionary that tracks which keys are currently held down.
// Keys are stored as lowercase strings, e.g. keys["w"] = true.
let keys = {};

// When a key is pressed down, record it as active.
// We first check if the user is typing in an input field —
// if so, we skip recording the key so chat doesn't accidentally
// move the player.
document.addEventListener("keydown", (e) => {
    const activeTag = document.activeElement.tagName.toLowerCase();
    if (activeTag === "input") return;

    keys[e.key.toLowerCase()] = true;
});

// When a key is released, mark it as inactive.
document.addEventListener("keyup", (e) => {
    keys[e.key.toLowerCase()] = false;
});

// ============================================================
// Socket.IO Event Handlers
// These listen for messages coming FROM the server.
// ============================================================

// --- Event: "connect" ---
// Fires automatically when our connection to the server is established.
// This is when we learn our socket ID and officially join the game.
socket.on("connect", () => {
    myId = socket.id;

    // Tell the server we've joined, along with our name and starting position.
    socket.emit("join", {
        name: playerName,
        x: player.x,
        y: player.y
    });
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
});

// --- Event: "newPlayer" ---
// Sent to all existing players when someone new joins.
// We add them to our local dictionary so they appear on screen.
socket.on("newPlayer", (playerData) => {
    players[playerData.id] = {
        ...playerData,       // Spread copies all properties (id, name, x, y)
        chatBubble: "",      // New players start with no chat bubble
        chatTimestamp: 0
    };
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
});

// --- Event: "chatMessage" ---
// Sent to all clients when any player (or the system) sends a message.
// We add it to the chat log and update the sender's chat bubble.
socket.on("chatMessage", (data) => {
    // Append the message to the scrollable chat panel.
    addChatMessage(`${data.name}: ${data.message}`);

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

// Creates a new div for a message and appends it to the chat panel.
// textContent is used (not innerHTML) to prevent XSS — any HTML in
// the message is treated as plain text rather than executed.
function addChatMessage(message) {
    const messageDiv = document.createElement("div");
    messageDiv.className = "chatMessage";
    messageDiv.textContent = message;
    chatMessages.appendChild(messageDiv);

    // Auto-scroll to the bottom so the latest message is always visible.
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Reads the chat input, sends the message to the server, and clears the field.
function sendChatMessage() {
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
    // Move the player based on which keys are currently held down.
    // Y increases downward on a canvas, so W subtracts from Y (move up)
    // and S adds to Y (move down).
    if (keys["w"]) player.y -= player.speed;
    if (keys["s"]) player.y += player.speed;
    if (keys["a"]) player.x -= player.speed;
    if (keys["d"]) player.x += player.speed;

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

    // Loop over every player in our dictionary and draw them.
    for (let id in players) {
        let p = players[id];

        // Fall back to 20 if the player object doesn't have a size property
        // (e.g. players received from the server before size was added).
        const size = p.size || 20;

        // Draw the player square.
        // Our own player is lime green; everyone else is red.
        ctx.fillStyle = id === myId ? "lime" : "red";
        ctx.fillRect(p.x, p.y, size, size);

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

        // Measure the text width so we can clamp the horizontal position.
        // This prevents the name from being cut off at the left or right edges.
        const nameWidth = ctx.measureText(p.name).width;

        // Math.max clamps to the left boundary; Math.min clamps to the right.
        // The + 5 / - 5 adds a small padding gap from the canvas edge.
        const nameX = Math.max(
            nameWidth / 2 + 5,
            Math.min(canvas.width - nameWidth / 2 - 5, p.x + size / 2)
        );

        ctx.fillText(p.name, nameX, nameY);

        // --- Draw Chat Bubble ---
        // How long (in milliseconds) the bubble stays visible after a message.
        const bubbleDuration = 3000;

        // Only draw the bubble if there's a message AND it hasn't expired yet.
        if (p.chatBubble && Date.now() - p.chatTimestamp < bubbleDuration) {
            const bubbleText = p.chatBubble;

            ctx.font = "12px Arial";
            ctx.textAlign = "center";

            // Measure the message text so we can size the bubble to fit it.
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
            // We use bubbleX + bubbleWidth/2 (bubble center) rather than player center,
            // because the bubble may have been pushed sideways by the edge clamping.
            ctx.fillStyle = "black";
            ctx.fillText(bubbleText, bubbleX + bubbleWidth / 2, bubbleY + 16);

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
