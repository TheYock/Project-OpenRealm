// ============================================================
// Auth Routes
// ============================================================
// Defines two API endpoints:
//   POST /api/register  — create a new account
//   POST /api/login     — sign into an existing account
//
// Both endpoints return a JWT on success, which the client
// stores and sends with future requests to prove identity.
// ============================================================

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// express.Router() creates a mini app that handles a group of
// related routes. We mount it in server.js under "/api".
const router = express.Router();

// ============================================================
// POST /api/register
// ============================================================
// Expects: { username, password }
// Returns: { token, user: { id, username, avatar } }
router.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;

        // --- Validation ---
        if (!username || !password) {
            return res.status(400).json({ error: "Username and password are required" });
        }

        if (username.trim().length < 2) {
            return res.status(400).json({ error: "Username must be at least 2 characters" });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters" });
        }

        // Check if a user with this username already exists.
        const existing = await User.findOne({ username: username.trim() });
        if (existing) {
            return res.status(400).json({ error: "Username already taken" });
        }

        // --- Hash the Password ---
        // bcrypt.hash() runs the password through a one-way hashing
        // algorithm. The '10' is the "salt rounds" — how many times
        // the algorithm iterates. Higher = more secure but slower.
        // 10 is the standard recommended value.
        const hashedPassword = await bcrypt.hash(password, 10);

        // --- Create and Save the User ---
        const user = new User({
            username: username.trim(),
            password: hashedPassword
            // avatar fields will use their schema defaults
        });

        await user.save();

        // --- Sign a JWT ---
        // jwt.sign() creates a token containing a payload (the data
        // we want to embed), signed with our secret key.
        // The token expires after 7 days — after that the player
        // will need to log in again.
        const token = jwt.sign(
            { id: user._id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        // Return the token and basic user info to the client.
        // We never send the password back, even the hashed version.
        res.status(201).json({
            token,
            user: {
                id: user._id,
                username: user.username,
                avatar: user.avatar
            }
        });

    } catch (err) {
        console.error("Register error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ============================================================
// POST /api/login
// ============================================================
// Expects: { username, password }
// Returns: { token, user: { id, username, avatar } }
router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: "Username and password are required" });
        }

        // Look up the user by username.
        const user = await User.findOne({ username: username.trim() });

        // If no user found, or the password doesn't match, return the
        // same generic error. We don't specify which one failed —
        // telling an attacker "username not found" vs "wrong password"
        // makes it easier to enumerate valid usernames.
        if (!user) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        // bcrypt.compare() hashes the submitted password with the same
        // salt used originally and checks if they match.
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        // Sign a fresh token for this session.
        const token = jwt.sign(
            { id: user._id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                avatar: user.avatar
            }
        });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

module.exports = router;
