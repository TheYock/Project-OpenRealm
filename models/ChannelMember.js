const mongoose = require("mongoose");

const channelMemberSchema = new mongoose.Schema({
    channelId: {
        type: String,
        required: true,
        index: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    username: {
        type: String,
        required: true,
        trim: true,
        maxlength: 20
    },

    role: {
        type: String,
        enum: ["owner", "admin", "moderator", "member"],
        default: "member",
        index: true
    },

    status: {
        type: String,
        enum: ["active", "banned"],
        default: "active",
        index: true
    },

    joinedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

channelMemberSchema.index({ channelId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("ChannelMember", channelMemberSchema);
