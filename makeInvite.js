// Usage:
//   node makeInvite.js                        — generates a random single-use code
//   node makeInvite.js mycode                 — creates code "mycode" (single-use)
//   node makeInvite.js mycode 5               — creates code usable 5 times
//   node makeInvite.js mycode -1              — creates unlimited-use code
//   node makeInvite.js mycode 1 "For John"    — with a memo note
//   node makeInvite.js --list                 — lists all existing codes

require("dotenv").config();
const mongoose   = require("mongoose");
const crypto     = require("crypto");
const InviteCode = require("./models/InviteCode");

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);

    const args = process.argv.slice(2);

    if (args[0] === "--list") {
        const codes = await InviteCode.find().sort({ createdAt: -1 });
        if (!codes.length) {
            console.log("No invite codes found.");
        } else {
            console.log("\nInvite codes:\n");
            codes.forEach(c => {
                const usageStr = c.maxUses === -1
                    ? `${c.uses} uses (unlimited)`
                    : `${c.uses}/${c.maxUses} uses`;
                const note = c.note ? `  — ${c.note}` : "";
                console.log(`  ${c.code}  [${usageStr}]${note}`);
            });
        }
        await mongoose.disconnect();
        return;
    }

    const code    = args[0] || crypto.randomBytes(4).toString("hex");
    const maxUses = parseInt(args[1], 10) || 1;
    const note    = args[2] || "";

    const existing = await InviteCode.findOne({ code });
    if (existing) {
        console.error(`Code "${code}" already exists.`);
        await mongoose.disconnect();
        process.exit(1);
    }

    await InviteCode.create({ code, maxUses, note });
    const usageLabel = maxUses === -1 ? "unlimited uses" : `${maxUses} use${maxUses === 1 ? "" : "s"}`;
    console.log(`\nInvite code created: ${code}  (${usageLabel})${note ? `\nNote: ${note}` : ""}\n`);

    await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
