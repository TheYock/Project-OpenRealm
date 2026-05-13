const mongoose = require("mongoose");

const friendshipSchema = new mongoose.Schema({
    pairKey: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    requesterUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    requesterUsername: {
        type: String,
        required: true,
        trim: true,
        maxlength: 20
    },

    recipientUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    recipientUsername: {
        type: String,
        required: true,
        trim: true,
        maxlength: 20
    },

    status: {
        type: String,
        enum: ["pending", "accepted"],
        default: "pending",
        index: true
    }
}, {
    timestamps: true
});

friendshipSchema.index({ requesterUserId: 1, status: 1 });
friendshipSchema.index({ recipientUserId: 1, status: 1 });

module.exports = mongoose.model("Friendship", friendshipSchema);
