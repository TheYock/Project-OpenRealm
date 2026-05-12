// ============================================================
// setRoomCreator.js - Console Script
// ============================================================
// Grants or revokes room creation privileges without giving a user
// full admin powers.
//
// Usage:
//   node setRoomCreator.js <username> <on|off>
//
// Examples:
//   node setRoomCreator.js YOCK on
//   node setRoomCreator.js YOCK off
// ============================================================

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");

const username = process.argv[2];
const mode = (process.argv[3] || "").toLowerCase();

if (!username || !["on", "off", "true", "false"].includes(mode)) {
    console.log("Usage: node setRoomCreator.js <username> <on|off>");
    process.exit(1);
}

const canCreateRooms = mode === "on" || mode === "true";

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        const user = await User.findOneAndUpdate(
            { username },
            { canCreateRooms },
            { returnDocument: "after" }
        );

        if (!user) {
            console.log(`User "${username}" not found.`);
        } else {
            const status = user.canCreateRooms ? "can now create rooms" : "can no longer create rooms";
            console.log(`OK: "${user.username}" ${status}.`);
        }

        mongoose.disconnect();
    })
    .catch((err) => {
        console.error("Connection error:", err.message);
        process.exit(1);
    });
