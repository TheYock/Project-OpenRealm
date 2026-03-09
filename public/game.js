const socket = io();

const playerName = prompt("Enter your name:", "Player") || "Player";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");

const players = {};

let myId = null;

let player = {
    x: 400,
    y: 300,
    size: 20,
    speed: 1
};

let keys = {};

// Listen for key presses, but ignore movement when typing in chat
document.addEventListener("keydown", (e) => {
    const activeTag = document.activeElement.tagName.toLowerCase();
    if (activeTag === "input") return;

    keys[e.key.toLowerCase()] = true;
});

document.addEventListener("keyup", (e) => {
    keys[e.key.toLowerCase()] = false;
});

socket.on("connect", () => {
    myId = socket.id;

    socket.emit("join", {
        name: playerName,
        x: player.x,
        y: player.y
    });
});

socket.on("currentPlayers", (serverPlayers) => {
    Object.keys(players).forEach((id) => delete players[id]);
    Object.assign(players, serverPlayers);
});

socket.on("newPlayer", (playerData) => {
    players[playerData.id] = {
    ...playerData,
    chatBubble: "",
    chatTimestamp: 0
    }
});

socket.on("playerMoved", (playerData) => {
    if (players[playerData.id]) {
        players[playerData.id].x = playerData.x;
        players[playerData.id].y = playerData.y;
    }
});

socket.on("playerDisconnected", (id) => {
    delete players[id];
});

socket.on("chatMessage", (data) => {
    addChatMessage(`${data.name}: ${data.message}`);

    if(players[data.id]){
        players[data.id].chatBubble = data.message;
        players[data.id].chatTimestamp = data.timestamp;
    }
});

function addChatMessage(message) {
    const messageDiv = document.createElement("div");
    messageDiv.className = "chatMessage";
    messageDiv.textContent = message;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChatMessage() {
    const message = chatInput.value.trim();

    if (message === "") return;

    socket.emit("chatMessage", {
        name: playerName,
        message: message
    });

    chatInput.value = "";
}

sendButton.addEventListener("click", sendChatMessage);

chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        sendChatMessage();
    }
});

function updatePlayer() {
    if (keys["w"]) player.y -= player.speed;
    if (keys["s"]) player.y += player.speed;
    if (keys["a"]) player.x -= player.speed;
    if (keys["d"]) player.x += player.speed;

    // world boundaries
    if (player.x < 0) player.x = 0;
    if (player.y < 0) player.y = 0;
    if (player.x > canvas.width - player.size) player.x = canvas.width - player.size;
    if (player.y > canvas.height - player.size) player.y = canvas.height - player.size;

    socket.emit("playerMove", {
        x: player.x,
        y: player.y
    });
}
function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let id in players) {
        let p = players[id];

        ctx.fillStyle = id === myId ? "lime" : "red";
        ctx.fillRect(p.x, p.y, 20, 20);

        ctx.fillStyle = "white";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";

        let nameY = p.y - 5;
        if (p.y < 20) {
            nameY = p.y + 30;
        }

        ctx.fillText(p.name, p.x + 10, nameY);

        const bubbleDuration = 3000;

        if (p.chatBubble && Date.now() - p.chatTimestamp < bubbleDuration) {
            const bubbleText = p.chatBubble;

            ctx.font = "12px Arial";
            ctx.textAlign = "center";

            const textWidth = ctx.measureText(bubbleText).width;
            const bubbleWidth = textWidth + 20;
            const bubbleHeight = 24;

            let bubbleX = p.x + 10 - bubbleWidth / 2;
            let bubbleY = p.y - 50;

            //keep bubble in canvas
            if(bubbleX < 5) bubbleX = 5;
            if(bubbleX + bubbleWidth > canvas.width - 5)
                bubbleX = canvas.width - bubbleWidth - 5;

            if (bubbleY < 0) {
                bubbleY = p.y + 35;
            }

            ctx.fillStyle = "white";
            drawRoundedRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 6);
            ctx.fill();

            ctx.strokeStyle = "black";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = "black";
            ctx.fillText(bubbleText, p.x + 10, bubbleY + 16);

            // Tail centered under bubble
            let tailX = p.x + 10;
            let tailY = bubbleY + bubbleHeight;

            ctx.beginPath();
            ctx.moveTo(tailX - 6, tailY);
            ctx.lineTo(tailX + 6, tailY);
            ctx.lineTo(tailX, tailY + 8);
            ctx.closePath();

            ctx.fillStyle = "white";
            ctx.fill();

            ctx.strokeStyle = "black";
            ctx.stroke();
        }
    }
}

function gameLoop() {
    updatePlayer();
    draw();
    requestAnimationFrame(gameLoop);
}

gameLoop();