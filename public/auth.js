// ============================================================
// OpenRealm - Auth Logic
// ============================================================
// This file handles everything related to login and registration:
//   - Checking for an existing saved session
//   - Switching between the Login and Register tabs
//   - Submitting forms to the server's API endpoints
//   - Storing credentials in localStorage after success
//   - Calling joinGame() (defined in game.js) to enter the world
// ============================================================

// Keys used to store session data in the browser's localStorage.
// localStorage persists across page refreshes and browser restarts
// until explicitly cleared — perfect for a "stay logged in" session.
const TOKEN_KEY    = "or_token";
const USERNAME_KEY = "or_username";

// --- Grab UI Elements ---
const overlay       = document.getElementById("authOverlay");
const tabLogin      = document.getElementById("tabLogin");
const tabRegister   = document.getElementById("tabRegister");
const formLogin     = document.getElementById("formLogin");
const formRegister  = document.getElementById("formRegister");
const errorLogin    = document.getElementById("errorLogin");
const errorRegister = document.getElementById("errorRegister");
const emailOverlay  = document.getElementById("emailOverlay");
const emailCaptureForm = document.getElementById("emailCaptureForm");
const emailCaptureInput = document.getElementById("emailCaptureInput");
const emailCaptureError = document.getElementById("emailCaptureError");
const emailVerificationBanner = document.getElementById("emailVerificationBanner");
const resendVerificationButton = document.getElementById("resendVerificationButton");
const emailVerificationMessage = document.getElementById("emailVerificationMessage");

// ============================================================
// Auto-Login Check
// ============================================================
// When the page loads, check whether we already have a saved
// token. If we do, skip the overlay and jump straight into the
// game using the stored username.
// ============================================================
const savedToken    = localStorage.getItem(TOKEN_KEY);
const savedUsername = localStorage.getItem(USERNAME_KEY);

if (savedToken && savedUsername) {
    // We have a saved session — skip the overlay and enter the game.
    // setTimeout(0) defers until after game.js has finished executing,
    // ensuring window.joinGame is defined before we call it.
    setTimeout(() => {
        document.getElementById("spectatorBanner").style.display = "none";
        showPlayerBar(savedUsername);
        window.enableChat();
        window.joinGame(savedUsername, savedToken);
    }, 0);
}
// If no session, do nothing — the player lands as a spectator.
// They can open the overlay by clicking the banner button.

// ============================================================
// showAuthOverlay()
// ============================================================
// Called by the banner's "Sign Up / Log In" button in index.html.
// Exposed on window so it can be called from an inline onclick attribute.
// ============================================================
window.showAuthOverlay = function() {
    overlay.style.display = "flex";
};

// ============================================================
// Tab Switching
// ============================================================
// The overlay has two tabs: Login and Register.
// Clicking a tab shows its form and hides the other.
// ============================================================
tabLogin.addEventListener("click", () => {
    // Activate the Login tab visually
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");

    // Show the login form, hide the register form
    formLogin.style.display    = "flex";
    formRegister.style.display = "none";

    // Clear any leftover error messages
    errorLogin.textContent    = "";
    errorRegister.textContent = "";
});

tabRegister.addEventListener("click", () => {
    // Activate the Register tab visually
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");

    // Show the register form, hide the login form
    formRegister.style.display = "flex";
    formLogin.style.display    = "none";

    errorLogin.textContent    = "";
    errorRegister.textContent = "";
});

// ============================================================
// Shared Helper: Enter the Game After Auth
// ============================================================
// Called on successful login or register.
// Saves the session and hands off to game.js.
// ============================================================
function enterGame(token, username, user = {}, options = {}) {
    // Persist the session so next visit auto-logs in.
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USERNAME_KEY, username);

    // Hide the auth overlay.
    overlay.style.display = "none";

    // Swap the spectator banner for the player bar.
    document.getElementById("spectatorBanner").style.display = "none";
    showPlayerBar(username);

    // Enable the chat input now that the player is authenticated.
    window.enableChat();

    // Tell game.js to join — passes the token so it can be sent to the
    // server on the "join" event for admin verification.
    window.joinGame(username, token);

    if (user.requiresEmail) {
        window.showEmailCapture("Add a valid email to continue.");
    } else if (user.requiresEmailVerification) {
        const message = options.verificationSent
            ? "Verification email sent. Check your inbox."
            : (options.verificationConsoleFallback
                ? "Verification link created. Check the server console in local dev."
                : "Verify your email or use Resend for a fresh link.");
        window.showEmailVerificationPrompt(message);
    } else {
        window.hideEmailVerificationPrompt();
    }
}

window.showEmailCapture = function(message = "") {
    overlay.style.display = "none";
    emailOverlay.style.display = "flex";
    emailCaptureError.textContent = message;
    emailCaptureInput.focus();
};

function setEmailVerificationMessage(message, isError = false) {
    if (!emailVerificationMessage) return;
    emailVerificationMessage.textContent = message || "";
    emailVerificationMessage.classList.toggle("error", isError);
}

window.showEmailVerificationPrompt = function(message = "") {
    if (!emailVerificationBanner) return;
    emailVerificationBanner.style.display = "flex";
    setEmailVerificationMessage(message);
};

window.hideEmailVerificationPrompt = function() {
    if (!emailVerificationBanner) return;
    emailVerificationBanner.style.display = "none";
    setEmailVerificationMessage("");
};

// ============================================================
// showPlayerBar(username)
// ============================================================
// Fills in the player's name and makes the bar visible.
// Also wires up the logout button the first time it's called.
// ============================================================
let logoutWired = false;

function showPlayerBar(username) {
    document.getElementById("playerBarName").textContent = username;
    document.getElementById("playerBar").style.display   = "flex";

    // Wire the logout button once — clicking it clears the saved
    // session and reloads the page, returning to spectator mode.
    if (!logoutWired) {
        document.getElementById("logoutButton").addEventListener("click", () => {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USERNAME_KEY);
            location.reload();
        });
        logoutWired = true;
    }
}

// ============================================================
// Shared Helper: POST to the API
// ============================================================
// fetch() is the modern browser API for making HTTP requests.
// It returns a Promise, so we use async/await to write it in a
// linear, readable style instead of callback nesting.
// ============================================================
async function postJSON(url, body, extraHeaders = {}) {
    const response = await fetch(url, {
        method: "POST",
        // Tell the server we're sending JSON
        headers: { "Content-Type": "application/json", ...extraHeaders },
        // JSON.stringify() converts our JS object into a JSON string
        body: JSON.stringify(body)
    });

    // response.json() reads the response body and parses it as JSON.
    const data = await response.json();

    // Return both the HTTP status and the parsed body so callers
    // can check if the request succeeded (status 200–299).
    return { ok: response.ok, data };
}

if (resendVerificationButton) {
    resendVerificationButton.addEventListener("click", async () => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) {
            setEmailVerificationMessage("Please log in again.", true);
            return;
        }

        resendVerificationButton.disabled = true;
        resendVerificationButton.textContent = "Sending...";
        setEmailVerificationMessage("");

        const { ok, data } = await postJSON(
            "/api/resend-verification",
            {},
            { Authorization: `Bearer ${token}` }
        );

        if (ok) {
            setEmailVerificationMessage(data.message || "Verification link sent.");
            if (data.user && !data.user.requiresEmailVerification) {
                window.hideEmailVerificationPrompt();
            }
        } else {
            setEmailVerificationMessage(data.error || "Unable to resend verification link.", true);
        }

        resendVerificationButton.disabled = false;
        resendVerificationButton.textContent = "Resend";
    });
}

// ============================================================
// Login Form Submission
// ============================================================
formLogin.addEventListener("submit", async (e) => {
    // Prevent the default form behaviour (which would reload the page)
    e.preventDefault();
    errorLogin.textContent = "";

    const identifier = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;

    // Disable the button while the request is in flight so the
    // user doesn't accidentally submit twice.
    const btn = formLogin.querySelector("button");
    btn.disabled    = true;
    btn.textContent = "Logging in...";

    const { ok, data } = await postJSON("/api/login", { identifier, password });

    if (ok) {
        enterGame(data.token, data.user.username, data.user, {
            verificationSent: !!data.verificationSent,
            verificationConsoleFallback: !!data.verificationConsoleFallback
        });
    } else {
        // Show the error message returned by the server
        errorLogin.textContent = data.error || "Login failed";
        btn.disabled    = false;
        btn.textContent = "Log In";
    }
});

// ============================================================
// Register Form Submission
// ============================================================
formRegister.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorRegister.textContent = "";

    const username  = document.getElementById("regUsername").value.trim();
    const email     = document.getElementById("regEmail").value.trim();
    const password  = document.getElementById("regPassword").value;
    const password2 = document.getElementById("regPassword2").value;

    // Client-side check before even hitting the server.
    if (password !== password2) {
        errorRegister.textContent = "Passwords do not match";
        return;
    }

    const btn = formRegister.querySelector("button");
    btn.disabled    = true;
    btn.textContent = "Creating account...";

    const { ok, data } = await postJSON("/api/register", { username, email, password });

    if (ok) {
        enterGame(data.token, data.user.username, data.user, {
            verificationSent: !!data.verificationSent,
            verificationConsoleFallback: !!data.verificationConsoleFallback
        });
    } else {
        errorRegister.textContent = data.error || "Registration failed";
        btn.disabled    = false;
        btn.textContent = "Create Account";
    }
});

emailCaptureForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    emailCaptureError.textContent = "";

    const email = emailCaptureInput.value.trim();
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
        emailCaptureError.textContent = "Please log in again.";
        return;
    }

    const btn = emailCaptureForm.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Saving...";

    const { ok, data } = await postJSON(
        "/api/account/email",
        { email },
        { Authorization: `Bearer ${token}` }
    );

    if (ok) {
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USERNAME_KEY, data.user.username);
        emailOverlay.style.display = "none";
        if (data.user.requiresEmailVerification) {
            window.showEmailVerificationPrompt(data.verificationSent
                ? "Verification email sent. Check your inbox."
                : (data.verificationConsoleFallback
                    ? "Verification link created. Check the server console in local dev."
                    : "Verify your email or use Resend for a fresh link."));
        } else {
            window.hideEmailVerificationPrompt();
        }
        btn.disabled = false;
        btn.textContent = "Save Email";
    } else {
        emailCaptureError.textContent = data.error || "Unable to save email";
        btn.disabled = false;
        btn.textContent = "Save Email";
    }
});
