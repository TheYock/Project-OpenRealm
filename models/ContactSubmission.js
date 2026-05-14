const mongoose = require("mongoose");

const contactSubmissionSchema = new mongoose.Schema({
    name:      { type: String, default: "" },
    email:     { type: String, required: true },
    type:      { type: String, enum: ["bug", "feedback", "invite"], default: "feedback" },
    message:   { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("ContactSubmission", contactSubmissionSchema);
