// ============================================================
// User Model
// ============================================================
// Mongoose models define the shape of documents stored in
// MongoDB. Think of a model as a class, and each document
// in the database as an instance of that class.
// ============================================================

const mongoose = require("mongoose");

// A Schema defines the fields a document must/can have and
// what type of data each field holds.
const userSchema = new mongoose.Schema({

    // Username must be provided, unique across all accounts,
    // and trimmed of leading/trailing whitespace automatically.
    username: {
        type: String,
        required: true,
        unique: true,       // Mongoose will reject duplicate usernames at the DB level
        trim: true,
        maxlength: 20
    },

    // Email is required for new accounts. Existing pre-email accounts may
    // temporarily have this field missing until they complete the email prompt.
    email: {
        type: String,
        unique: true,
        sparse: true,
        trim: true,
        lowercase: true,
        maxlength: 254,
        index: true
    },

    // Email verification is optional for old accounts until they add an
    // email, then required to finish securing the account.
    emailVerified: {
        type: Boolean,
        default: false,
        index: true
    },

    emailVerificationTokenHash: {
        type: String,
        default: null
    },

    emailVerificationExpiresAt: {
        type: Date,
        default: null
    },

    // We never store the plain-text password — only the bcrypt hash.
    // The actual hashing happens in the auth route before saving.
    password: {
        type: String,
        required: true
    },

    // Whether this user has admin privileges.
    // Set via the makeAdmin.js console script — never by the client.
    isAdmin: {
        type: Boolean,
        default: false
    },

    // Whether this user can create rooms. Admins can always create rooms,
    // but this lets us grant room creation without full admin powers.
    canCreateRooms: {
        type: Boolean,
        default: false
    },

    // Channel IDs the user saved in the sidebar for quick access.
    favoriteChannels: {
        type: [String],
        default: []
    },

    // Remaining milliseconds of active mute/freeze as of last logout.
    // null = no restriction, -1 = permanent, positive = timed (ms remaining).
    // Persisted so re-logging cannot bypass a timed action.
    muteRemainingMs: {
        type: Number,
        default: null
    },

    freezeRemainingMs: {
        type: Number,
        default: null
    },

    // Avatar customization options.
    // 'default' means these values are used automatically if not provided.
    avatar: {
        color: {
            type: String,
            default: "#4caf50"  // Default player color (green)
        },
        shape: {
            type: String,
            default: "square"   // Reserved for future shape options
        }
    }

}, {
    // Automatically adds 'createdAt' and 'updatedAt' fields to every
    // document, which is useful for tracking when accounts were made.
    timestamps: true
});

// mongoose.model() compiles the schema into a Model.
// The first argument ("User") is the name — Mongoose will use it
// to create a MongoDB collection called "users" (lowercase + plural).
module.exports = mongoose.model("User", userSchema);
