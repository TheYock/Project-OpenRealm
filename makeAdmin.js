// ============================================================
// makeAdmin.js — Console Script
// ============================================================
// Grants admin privileges to a user account in MongoDB.
//
// Usage:
//   node makeAdmin.js <username>
//
// Example:
//   node makeAdmin.js YOCK
// ============================================================

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");

const username = process.argv[2];

if (!username) {
    console.log("Usage: node makeAdmin.js <username>");
    process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        const user = await User.findOneAndUpdate(
            { username },
            { isAdmin: true },
            { new: true }  // Return the updated document so we can confirm the change
        );

        if (!user) {
            console.log(`User "${username}" not found.`);
        } else {
            console.log(`✓ "${user.username}" is now an admin.`);
        }

        mongoose.disconnect();
    })
    .catch((err) => {
        console.error("Connection error:", err.message);
        process.exit(1);
    });
