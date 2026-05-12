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
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// express.Router() creates a mini app that handles a group of
// related routes. We mount it in server.js under "/api".
const router = express.Router();
const VERIFICATION_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashVerificationToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function verificationBaseUrl(req) {
    const configured = process.env.PUBLIC_URL || process.env.APP_URL || "";
    if (configured.trim()) {
        return configured.trim().replace(/\/+$/, "");
    }

    return `${req.protocol}://${req.get("host")}`;
}

function verificationPage(title, message, isSuccess) {
    const accent = isSuccess ? "#4caf50" : "#e57373";
    return `<!doctype html>
<html>
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} - OpenRealm</title>
        <style>
            body {
                margin: 0;
                min-height: 100vh;
                display: grid;
                place-items: center;
                background: #151515;
                color: #f5f5f5;
                font-family: Arial, sans-serif;
            }
            main {
                width: min(92vw, 420px);
                padding: 32px;
                border: 1px solid #333;
                border-radius: 12px;
                background: #1f1f1f;
                text-align: center;
                box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
            }
            h1 { margin: 0 0 12px; color: ${accent}; }
            p { color: #bbb; line-height: 1.45; }
            a {
                display: inline-block;
                margin-top: 14px;
                padding: 10px 16px;
                border-radius: 6px;
                background: #4caf50;
                color: white;
                text-decoration: none;
                font-weight: bold;
            }
        </style>
    </head>
    <body>
        <main>
            <h1>${title}</h1>
            <p>${message}</p>
            <a href="/">Return to OpenRealm</a>
        </main>
    </body>
</html>`;
}

async function issueEmailVerification(user, req) {
    if (!user.email) {
        return null;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const verificationUrl = `${verificationBaseUrl(req)}/api/verify-email?token=${token}`;

    user.emailVerified = false;
    user.emailVerificationTokenHash = hashVerificationToken(token);
    user.emailVerificationExpiresAt = new Date(Date.now() + VERIFICATION_TOKEN_LIFETIME_MS);
    await user.save();

    // Local-dev delivery path. A real SMTP provider can replace this later.
    console.log(`[email verification] ${user.username}: ${verificationUrl}`);
    return verificationUrl;
}

async function userFromAuthHeader(req) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
        const error = new Error("Login required");
        error.statusCode = 401;
        throw error;
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
        const error = new Error("Please log in again");
        error.statusCode = 401;
        throw error;
    }

    const user = decoded.id
        ? await User.findById(decoded.id)
        : await User.findOne({ username: decoded.username });
    if (!user) {
        const error = new Error("Account not found");
        error.statusCode = 404;
        throw error;
    }

    return user;
}

function signUserToken(user) {
    return jwt.sign(
        {
            id: user._id,
            username: user.username,
            isAdmin: user.isAdmin,
            canCreateRooms: user.canCreateRooms
        },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
    );
}

function publicUser(user) {
    const hasEmail = !!user.email;
    const emailVerified = hasEmail && !!user.emailVerified;

    return {
        id: user._id,
        username: user.username,
        email: user.email || "",
        emailVerified,
        avatar: user.avatar,
        isAdmin: user.isAdmin,
        canCreateRooms: user.canCreateRooms,
        requiresEmail: !hasEmail,
        requiresEmailVerification: hasEmail && !emailVerified
    };
}

// ============================================================
// POST /api/register
// ============================================================
// Expects: { username, email, password }
// Returns: { token, user: { id, username, avatar } }
router.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;
        const email = normalizeEmail(req.body.email);

        // --- Validation ---
        if (!username || !email || !password) {
            return res.status(400).json({ error: "Username, email, and password are required" });
        }

        if (username.trim().length < 2) {
            return res.status(400).json({ error: "Username must be at least 2 characters" });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ error: "A valid email is required" });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters" });
        }

        // Check if a user with this username or email already exists.
        const existing = await User.findOne({
            $or: [{ username: username.trim() }, { email }]
        });
        if (existing) {
            return res.status(400).json({
                error: existing.username === username.trim()
                    ? "Username already taken"
                    : "Email already in use"
            });
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
            email,
            emailVerified: false,
            password: hashedPassword
            // avatar fields will use their schema defaults
        });

        await user.save();
        await issueEmailVerification(user, req);

        // --- Sign a JWT ---
        // jwt.sign() creates a token containing a payload (the data
        // we want to embed), signed with our secret key.
        // The token expires after 7 days — after that the player
        // will need to log in again.
        const token = signUserToken(user);

        // Return the token and basic user info to the client.
        // We never send the password back, even the hashed version.
        res.status(201).json({
            token,
            user: publicUser(user),
            verificationSent: true
        });

    } catch (err) {
        console.error("Register error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ============================================================
// POST /api/login
// ============================================================
// Expects: { identifier, password } where identifier is username or email.
// Returns: { token, user: { id, username, avatar } }
router.post("/login", async (req, res) => {
    try {
        const identifier = typeof req.body.identifier === "string"
            ? req.body.identifier.trim()
            : (typeof req.body.username === "string" ? req.body.username.trim() : "");
        const { password } = req.body;
        const identifierEmail = normalizeEmail(identifier);

        if (!identifier || !password) {
            return res.status(400).json({ error: "Username or email and password are required" });
        }

        // Look up the user by username or email.
        const usernameMatch = new RegExp(`^${escapeRegex(identifier)}$`, "i");
        const lookup = isValidEmail(identifierEmail)
            ? { $or: [{ username: usernameMatch }, { email: identifierEmail }] }
            : { username: usernameMatch };
        const user = await User.findOne(lookup);

        // If no user found, or the password doesn't match, return the
        // same generic error. We don't specify which one failed —
        // telling an attacker "username not found" vs "wrong password"
        // makes it easier to enumerate valid usernames.
        if (!user) {
            return res.status(401).json({ error: "Invalid username/email or password" });
        }

        // bcrypt.compare() hashes the submitted password with the same
        // salt used originally and checks if they match.
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid username/email or password" });
        }

        // Sign a fresh token for this session.
        const token = signUserToken(user);

        res.json({
            token,
            user: publicUser(user)
        });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ============================================================
// POST /api/account/email
// ============================================================
// Existing legacy accounts can add an email after authenticating.
router.post("/account/email", async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        if (!isValidEmail(email)) {
            return res.status(400).json({ error: "A valid email is required" });
        }

        const user = await userFromAuthHeader(req);
        const emailOwner = await User.findOne({ email, _id: { $ne: user._id } });
        if (emailOwner) {
            return res.status(400).json({ error: "Email already in use" });
        }

        user.email = email;
        await issueEmailVerification(user, req);

        res.json({
            token: signUserToken(user),
            user: publicUser(user),
            verificationSent: true
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error("Update email error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ============================================================
// POST /api/resend-verification
// ============================================================
// Reissues a verification link for the authenticated user's current email.
router.post("/resend-verification", async (req, res) => {
    try {
        const user = await userFromAuthHeader(req);
        if (!user.email) {
            return res.status(400).json({ error: "Add an email before verifying your account" });
        }

        if (user.emailVerified) {
            return res.json({
                message: "Email is already verified",
                user: publicUser(user)
            });
        }

        await issueEmailVerification(user, req);
        res.json({
            message: "Verification link sent. Check the server console in local dev.",
            user: publicUser(user)
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        console.error("Resend verification error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ============================================================
// GET /api/verify-email
// ============================================================
// The link from issueEmailVerification() lands here.
router.get("/verify-email", async (req, res) => {
    try {
        const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
        if (!token) {
            return res.status(400).send(verificationPage(
                "Verification failed",
                "This verification link is missing its token. Please request a fresh link.",
                false
            ));
        }

        const user = await User.findOne({
            emailVerificationTokenHash: hashVerificationToken(token),
            emailVerificationExpiresAt: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).send(verificationPage(
                "Verification failed",
                "This verification link is invalid or expired. Please request a fresh link.",
                false
            ));
        }

        user.emailVerified = true;
        user.emailVerificationTokenHash = null;
        user.emailVerificationExpiresAt = null;
        await user.save();

        res.send(verificationPage(
            "Email verified",
            "Your email is verified. You can return to OpenRealm.",
            true
        ));
    } catch (err) {
        console.error("Verify email error:", err);
        res.status(500).send(verificationPage(
            "Verification failed",
            "Something went wrong while verifying this email. Please try again.",
            false
        ));
    }
});

module.exports = router;
