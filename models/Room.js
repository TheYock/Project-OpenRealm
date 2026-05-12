const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 32
    },

    description: {
        type: String,
        default: "",
        trim: true,
        maxlength: 240
    },

    mode: {
        type: String,
        enum: ["social", "watch", "game", "custom"],
        default: "social",
        index: true
    },

    modeConfig: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },

    channelId: {
        type: String,
        required: true,
        default: "openrealm",
        index: true
    },

    ownerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
    },

    ownerName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 20
    },

    code: {
        type: String,
        default: null,
        index: true
    },

    isPrivate: {
        type: Boolean,
        default: false
    },

    isDefault: {
        type: Boolean,
        default: false
    },

    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("Room", roomSchema);
