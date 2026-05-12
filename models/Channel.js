const mongoose = require("mongoose");

const channelSchema = new mongoose.Schema({
    channelId: {
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
        trim: true,
        maxlength: 240,
        default: ""
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

    isPublic: {
        type: Boolean,
        default: true,
        index: true
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

module.exports = mongoose.model("Channel", channelSchema);
