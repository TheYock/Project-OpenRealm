const mongoose = require("mongoose");

const inviteCodeSchema = new mongoose.Schema({
    code:     { type: String, required: true, unique: true, trim: true },
    uses:     { type: Number, default: 0 },
    maxUses:  { type: Number, default: 1 },  // -1 = unlimited
    note:     { type: String, default: "" },  // admin memo (e.g. "for John")
    createdAt:{ type: Date,   default: Date.now }
});

module.exports = mongoose.model("InviteCode", inviteCodeSchema);
