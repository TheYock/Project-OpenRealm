const mongoose = require("mongoose");

const roomMessageSchema = new mongoose.Schema({
    roomId:    { type: String, required: true },
    channelId: { type: String, required: true },
    name:      { type: String, required: true },
    message:   { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 } // auto-delete after 7 days
});

roomMessageSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.model("RoomMessage", roomMessageSchema);
