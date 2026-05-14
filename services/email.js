const { Resend } = require("resend");

const DEFAULT_EMAIL_FROM = "OpenRealm <donotreply@joinopenrealm.com>";

let resendClient = null;

function getResendClient() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return null;

    if (!resendClient) {
        resendClient = new Resend(apiKey);
    }

    return resendClient;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function shouldLogVerificationLinks() {
    if (process.env.EMAIL_LOG_LINKS === "true") return true;
    if (process.env.EMAIL_LOG_LINKS === "false") return false;
    return !process.env.RESEND_API_KEY || process.env.NODE_ENV !== "production";
}

function logVerificationLink(username, verificationUrl) {
    if (!shouldLogVerificationLinks()) return;
    console.log(`[email verification] ${username}: ${verificationUrl}`);
}

function verificationEmailHtml({ username, verificationUrl }) {
    const safeUsername = escapeHtml(username);
    const safeUrl = escapeHtml(verificationUrl);

    return `<!doctype html>
<html>
    <body style="margin:0;padding:0;background:#151515;color:#f5f5f5;font-family:Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#151515;padding:32px 16px;">
            <tr>
                <td align="center">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#1f1f1f;border:1px solid #333;border-radius:12px;padding:28px;">
                        <tr>
                            <td>
                                <h1 style="margin:0 0 12px;color:#4caf50;font-size:28px;">Verify your OpenRealm email</h1>
                                <p style="margin:0 0 16px;color:#d8d8d8;line-height:1.5;">Hi ${safeUsername}, welcome to OpenRealm.</p>
                                <p style="margin:0 0 22px;color:#bdbdbd;line-height:1.5;">Confirm this email address so your account is ready for community tools, invites, and future creator features.</p>
                                <p style="margin:0 0 24px;">
                                    <a href="${safeUrl}" style="display:inline-block;background:#4caf50;color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:6px;">Verify Email</a>
                                </p>
                                <p style="margin:0;color:#888;font-size:13px;line-height:1.45;">This link expires in 24 hours. If you did not create an OpenRealm account, you can ignore this email.</p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
</html>`;
}

async function sendVerificationEmail({ to, username, verificationUrl }) {
    const client = getResendClient();

    if (!client) {
        logVerificationLink(username, verificationUrl);
        return {
            sent: false,
            provider: "console",
            reason: "RESEND_API_KEY is not configured"
        };
    }

    try {
        const result = await client.emails.send({
            from: process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM,
            to,
            subject: "Verify your OpenRealm email",
            html: verificationEmailHtml({ username, verificationUrl }),
            text: [
                `Hi ${username}, welcome to OpenRealm.`,
                "",
                "Confirm this email address so your account is ready for community tools, invites, and future creator features.",
                "",
                `Verify your email: ${verificationUrl}`,
                "",
                "This link expires in 24 hours. If you did not create an OpenRealm account, you can ignore this email."
            ].join("\n")
        });

        if (result?.error) {
            throw new Error(result.error.message || "Resend rejected the email request");
        }

        const id = result?.data?.id || result?.id || null;
        console.log(`[email verification] sent to ${to}${id ? ` (${id})` : ""}`);
        return {
            sent: true,
            provider: "resend",
            id
        };
    } catch (error) {
        console.error("Email verification send error:", error?.message || error);
        logVerificationLink(username, verificationUrl);
        return {
            sent: false,
            provider: shouldLogVerificationLinks() ? "console" : "resend",
            reason: "Email provider failed"
        };
    }
}

function contactNotificationHtml({ name, email, type, message }) {
    const safeN = escapeHtml(name || "Anonymous");
    const safeE = escapeHtml(email);
    const safeT = escapeHtml(type);
    const safeM = escapeHtml(message).replace(/\n/g, "<br>");
    const typeLabel = { bug: "Bug Report", feedback: "Feedback", invite: "Invite Request" }[type] || type;

    return `<!doctype html>
<html>
    <body style="margin:0;padding:0;background:#151515;color:#f5f5f5;font-family:Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#151515;padding:32px 16px;">
            <tr>
                <td align="center">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#1f1f1f;border:1px solid #333;border-radius:12px;padding:28px;">
                        <tr>
                            <td>
                                <h1 style="margin:0 0 12px;color:#4caf50;font-size:22px;">New ${escapeHtml(typeLabel)} — OpenRealm</h1>
                                <p style="margin:0 0 8px;color:#bbb;"><strong style="color:#ddd;">From:</strong> ${safeN} &lt;${safeE}&gt;</p>
                                <p style="margin:0 0 16px;color:#bbb;"><strong style="color:#ddd;">Type:</strong> ${escapeHtml(typeLabel)}</p>
                                <div style="background:#151515;border:1px solid #2e2e2e;border-radius:8px;padding:16px;color:#d8d8d8;line-height:1.6;">${safeM}</div>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
</html>`;
}

async function sendContactNotification({ name, email, type, message }) {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) return;

    const client = getResendClient();
    if (!client) return;

    const typeLabel = { bug: "Bug Report", feedback: "Feedback", invite: "Invite Request" }[type] || "Contact";

    try {
        await client.emails.send({
            from: process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM,
            to: adminEmail,
            subject: `[OpenRealm] New ${typeLabel} from ${name || email}`,
            html: contactNotificationHtml({ name, email, type, message }),
            text: `New ${typeLabel}\nFrom: ${name || "Anonymous"} <${email}>\n\n${message}`
        });
    } catch (err) {
        console.error("Contact notification send error:", err?.message || err);
    }
}

module.exports = {
    sendVerificationEmail,
    sendContactNotification
};
