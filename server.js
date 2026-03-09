const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const { timeStamp } = require("console");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

//Server static files from public folder
app.use(express.static(path.join(__dirname, "public")));

//Socket connection
const players = {};

io.on("connection", (socket) =>{
    console.log("Player connected:", socket.id);

    socket.on("join", (data) =>{
        players[socket.id] = {
            name: data.name,
            x: data.x,
            y: data.y,
            chatBubble: "",
            chatTimestamp: 0
        };
        
    socket.emit("currentPlayers", players);
    
    socket.broadcast.emit("newPlayer", {
        id:socket.id,
        name: data.name,
        x: data.x,
        y: data.y
    });

    io.emit("chatMessage", {
        name: "System",
        message: `${data.name} joined OpenRealm`
    });

});

    socket.on("playerMove", (data) =>{
        if (players[socket.id]){
        players[socket.id].x = data.x;
        players[socket.id].y = data.y;

        io.emit("playerMoved", {
            id:socket.id,
            x:data.x,
            y:data.y
        });
    }
});

socket.on("chatMessage", (data) =>{
    if(players[socket.id]){
        players[socket.id].chatBubble = data.message;
        players[socket.id].chatTimestamp = Date.now();
    }
    io.emit("chatMessage", {
        id: socket.id,
        name: data.name,
        message: data.message,
        timestamp: Date.now()
    });
});

    socket.on("disconnect", () =>{
        if(players[socket.id]){
            io.emit("chatMessage", {
                name: "System",
                message: `${players[socket.id].name} left OpenRealm`
            });
        }
        console.log("Player disconnected:", socket.id);
        delete players[socket.id];
        io.emit("playerDisconnected", socket.id);
    });
});

//Start server
server.listen(PORT, () => {
    console.log(`OpenRealm server running at http://localhost:${PORT}`);
});