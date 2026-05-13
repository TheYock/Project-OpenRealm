const mongoose = require("mongoose");

const directMessageSchema = new mongoose.Schema({
    conversationKey: {
        type: String,
        required: true,
        index: true
    },

    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    }],

    senderUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    senderUsername: {
        type: String,
        required: true,
        trim: true,
        maxlength: 20
    },

    body: {
        type: String,
        required: true,
        maxlength: 500
    }
}, {
    timestamps: true
});

directMessageSchema.index({ conversationKey: 1, createdAt: -1 });

module.exports = mongoose.model("DirectMessage", directMessageSchema);
