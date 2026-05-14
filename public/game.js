// ============================================================
// OpenRealm - Client Game Logic
// ============================================================
// This file runs in the player's browser. It connects to the
// server via Socket.IO, handles input, tracks all players, and
// draws everything onto an HTML <canvas> element every frame.
// ============================================================

// --- Socket Connection ---
// io() is provided by the Socket.IO client library (loaded via
// a <script> tag in index.html). Calling it connects this browser
// to the server and returns a socket object we use to send and
// receive events.
const socket = io();

// playerName is set by auth.js once the player logs in or registers.
// It starts empty — the game will not join the server until joinGame()
// is called with the authenticated username.
let playerName = "";

// The JWT returned by the server on login/register.
// Sent to the server on "join" so it can verify admin status server-side.
let authToken = "";

// Whether the local player has admin privileges.
// Decoded from the JWT payload — controls whether the right-click menu appears.
let isAdmin = false;

// --- Canvas Setup ---
// Grab the <canvas> element from the HTML by its ID.
const canvas = document.getElementById("gameCanvas");

// getContext("2d") gives us the 2D drawing API — this is what we
// use to draw rectangles, text, shapes, etc. onto the canvas.
const ctx = canvas.getContext("2d");

function getCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top)  * (canvas.height / rect.height)
    };
}

// --- Chat UI Elements ---
// These are HTML elements defined in index.html that make up the chat UI.
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");
const currentChannelNameEl = document.getElementById("currentChannelName");
const sidebarCurrentChannelNameEl = document.getElementById("sidebarCurrentChannelName");
const favoriteChannelListEl = document.getElementById("favoriteChannelList");
const memberChannelListEl = document.getElementById("memberChannelList");
const channelBrowserButton = document.getElementById("channelBrowserButton");
const channelBrowserOverlay = document.getElementById("channelBrowserOverlay");
const channelBrowserClose = document.getElementById("channelBrowserClose");
const channelBrowserSearch = document.getElementById("channelBrowserSearch");
const channelBrowserSort = document.getElementById("channelBrowserSort");
const channelBrowserUnjoinedToggle = document.getElementById("channelBrowserUnjoinedToggle");
const channelBrowserActiveToggle = document.getElementById("channelBrowserActiveToggle");
const channelBrowserRoomsToggle = document.getElementById("channelBrowserRoomsToggle");
const channelBrowserStats = document.getElementById("channelBrowserStats");
const channelBrowserResults = document.getElementById("channelBrowserResults");
const channelHomeEl = document.getElementById("channelHome");
const channelCreateForm = document.getElementById("channelCreateForm");
const channelCreateInput = document.getElementById("channelCreateInput");
const channelCreateButton = document.getElementById("channelCreateButton");
const channelPrivateToggle = document.getElementById("channelPrivateToggle");
const channelJoinCodeForm = document.getElementById("channelJoinCodeForm");
const channelCodeInput = document.getElementById("channelCodeInput");
const channelJoinCodeButton = document.getElementById("channelJoinCodeButton");
const channelCodeDisplay = document.getElementById("channelCodeDisplay");
const channelError = document.getElementById("channelError");
const channelTools = document.getElementById("channelTools");
const channelDeleteButton = document.getElementById("channelDeleteButton");
const channelBanListButton = document.getElementById("channelBanListButton");
const channelBanPanel = document.getElementById("channelBanPanel");
const currentRoomNameEl = document.getElementById("currentRoomName");
const roomCreateForm = document.getElementById("roomCreateForm");
const roomCreateInput = document.getElementById("roomCreateInput");
const roomModeSelect = document.getElementById("roomModeSelect");
const roomCreateDescription = document.getElementById("roomCreateDescription");
const roomCreateButton = document.getElementById("roomCreateButton");
const roomCustomizePanel = document.getElementById("roomCustomizePanel");
const roomCustomizeMode = document.getElementById("roomCustomizeMode");
const roomCustomizeFields = document.getElementById("roomCustomizeFields");
const roomCustomizeButton = document.getElementById("roomCustomizeButton");
const roomCloseButton = document.getElementById("roomCloseButton");
const roomError = document.getElementById("roomError");
const roomModePanel = document.getElementById("roomModePanel");
const roomBarChannelInfoButton = document.getElementById("roomBarChannelInfoButton");
const roomBarNewRoomButton = document.getElementById("roomBarNewRoomButton");
const roomBarChannelSettingsButton = document.getElementById("roomBarChannelSettingsButton");
const roomBarRoomSettingsButton = document.getElementById("roomBarRoomSettingsButton");
const friendsButton = document.getElementById("friendsButton");
const messagesButton = document.getElementById("messagesButton");
const socialDrawer = document.getElementById("socialDrawer");
const socialDrawerTitle = document.getElementById("socialDrawerTitle");
const socialCloseButton = document.getElementById("socialCloseButton");
const friendsTabButton = document.getElementById("friendsTabButton");
const messagesTabButton = document.getElementById("messagesTabButton");
const socialNotice = document.getElementById("socialNotice");
const friendsPanel = document.getElementById("friendsPanel");
const dmPanel = document.getElementById("dmPanel");
const pendingFriendsList = document.getElementById("pendingFriendsList");
const acceptedFriendsList = document.getElementById("acceptedFriendsList");
const dmFriendList = document.getElementById("dmFriendList");
const dmHeader = document.getElementById("dmHeader");
const dmMessages = document.getElementById("dmMessages");
const dmForm = document.getElementById("dmForm");
const dmInput = document.getElementById("dmInput");
const dmSendButton = document.getElementById("dmSendButton");
const manageOverlay = document.getElementById("manageOverlay");
const manageTitle = document.getElementById("manageTitle");
const manageClose = document.getElementById("manageClose");
const manageStatus = document.getElementById("manageStatus");
const channelSettingsTab = document.getElementById("channelSettingsTab");
const roomSettingsTab = document.getElementById("roomSettingsTab");
const channelSettingsPanel = document.getElementById("channelSettingsPanel");
const roomSettingsPanel = document.getElementById("roomSettingsPanel");
const channelSettingsForm = document.getElementById("channelSettingsForm");
const channelSettingsName = document.getElementById("channelSettingsName");
const channelSettingsDescription = document.getElementById("channelSettingsDescription");
const channelSettingsPrivate = document.getElementById("channelSettingsPrivate");
const channelSettingsCode = document.getElementById("channelSettingsCode");
const settingsBanListButton = document.getElementById("settingsBanListButton");
const settingsDeleteChannelButton = document.getElementById("settingsDeleteChannelButton");
const settingsBanPanel = document.getElementById("settingsBanPanel");
const roomSettingsForm = document.getElementById("roomSettingsForm");
const roomSettingsName = document.getElementById("roomSettingsName");
const roomSettingsDescription = document.getElementById("roomSettingsDescription");
const roomSettingsMode = document.getElementById("roomSettingsMode");
const roomSettingsFields = document.getElementById("roomSettingsFields");
const roomSettingsSave = document.getElementById("roomSettingsSave");
const settingsCloseRoomButton = document.getElementById("settingsCloseRoomButton");

let channels = [];
let rooms = [];
let currentChannelId = "openrealm";
let currentChannel = null;
let currentRoomId = "town-square";
let currentRoomName = "Town Square";
let currentRoom = null;
let canCreateRooms = false;
let hasJoinedGame = false;
const expandedChannelIds = new Set(["openrealm"]);
let expandedRoomInfoId = null;
let selectedHomeChannelId = "openrealm";
let channelBrowserQuery = "";
let channelBrowserSortMode = "activity";
let channelBrowserOnlyUnjoined = false;
let channelBrowserOnlyActive = false;
let channelBrowserOnlyRooms = false;
let channelBrowserPendingAction = "";
let friends = [];
let socialTab = "friends";
let activeDmFriendId = null;
const directMessageThreads = {};
const unreadDirectMessages = {};
let roomModeDefinitions = {};
let manageTab = "channel";
let settingsChannelId = null;
let roomSettingsAction = "edit";
let roomSettingsRoomId = null;
let roomSettingsChannelId = null;
let forceChannelHomeOpen = false;

function canModerateCurrentChannel() {
    return isAdmin || !!currentChannel?.canModerate;
}

function canManageCurrentRooms() {
    return !!currentChannel?.canManageRooms;
}

function canManageCurrentChannel() {
    return !!currentChannel?.canManage;
}

function roomModeDefinition(mode) {
    return roomModeDefinitions[mode] || roomModeDefinitions.social || {
        label: formatRoomMode(mode),
        defaultConfig: {},
        settings: []
    };
}

function roomModeConfig(room = currentRoom) {
    const definition = roomModeDefinition(room?.mode || "social");
    return {
        ...(definition.defaultConfig || {}),
        ...((room?.modeConfig && typeof room.modeConfig === "object") ? room.modeConfig : {})
    };
}

function setChatInputEnabled(enabled, placeholder) {
    chatInput.disabled = !enabled;
    chatInput.placeholder = placeholder;
    sendButton.disabled = !enabled;
}

// Spectators see chat but can't type. The input is disabled with a
// prompt until they log in. auth.js calls window.enableChat() after login.
setChatInputEnabled(false, "Log in to chat...");

window.enableChat = function() {
    setChatInputEnabled(true, "Type a message...");
    updateChannelControls();
    updateRoomControls();
};

function setRoomError(message, isError = true) {
    roomError.textContent = message || "";
    roomError.classList.toggle("success", !!message && !isError);
}

function setChannelError(message, isError = true) {
    channelError.textContent = message || "";
    channelError.classList.toggle("success", !!message && !isError);
}

function formatBanExpiry(ban) {
    const expiresAt = Number(ban?.banExpiresAt);
    if (!expiresAt) return "Permanent";
    return `Until ${new Date(expiresAt).toLocaleString()}`;
}

function renderBanList(container, channelId, bans = []) {
    container.replaceChildren();
    container.style.display = "block";

    if (!bans.length) {
        const empty = document.createElement("p");
        empty.className = "channelEmpty";
        empty.textContent = "No active bans.";
        container.appendChild(empty);
        return;
    }

    bans.forEach((ban) => {
        const row = document.createElement("div");
        row.className = "banEntry";

        const info = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = ban.username || "Unknown";
        const meta = document.createElement("span");
        meta.textContent = [
            formatBanExpiry(ban),
            ban.bannedByUsername ? `By ${ban.bannedByUsername}` : ""
        ].filter(Boolean).join(" | ");
        info.appendChild(name);
        info.appendChild(meta);

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Unban";
        button.addEventListener("click", () => {
            socket.emit("unbanChannelMember", {
                channelId,
                userId: ban.userId
            });
        });

        row.appendChild(info);
        row.appendChild(button);
        container.appendChild(row);
    });
}

function renderChannelBanList(channelId, bans = []) {
    if (channelId !== currentChannelId) return;
    renderBanList(channelBanPanel, channelId, bans);
}

function renderSettingsBanList(channelId, bans = []) {
    if (channelId !== settingsChannelId) return;
    renderBanList(settingsBanPanel, channelId, bans);
}

function setManageStatus(message, isError = false) {
    manageStatus.textContent = message || "";
    manageStatus.classList.toggle("error", !!isError);
}

function setSocialNotice(message, isError = false) {
    socialNotice.textContent = message || "";
    socialNotice.classList.toggle("error", !!isError);
}

function acceptedFriends() {
    return friends.filter(friend => friend.status === "accepted");
}

function pendingFriends() {
    return friends.filter(friend => friend.status === "pending");
}

function friendByUserId(userId) {
    return friends.find(friend => friend.userId === userId) || null;
}

function friendByUsername(username) {
    const normalized = String(username || "").toLowerCase();
    return friends.find(friend => String(friend.username || "").toLowerCase() === normalized) || null;
}

function unreadTotal() {
    return Object.values(unreadDirectMessages).reduce((total, count) => total + (Number(count) || 0), 0);
}

function updateSocialButtons() {
    const loggedIn = !!playerName && hasJoinedGame;
    channelBrowserButton.disabled = !loggedIn;
    friendsButton.disabled = !loggedIn;
    messagesButton.disabled = !loggedIn;
    const unread = unreadTotal();
    messagesButton.textContent = unread ? `DMs (${unread})` : "DMs";
    messagesButton.classList.toggle("hasUnread", unread > 0);
}

function setSocialTab(tab) {
    socialTab = tab === "messages" ? "messages" : "friends";
    socialDrawerTitle.textContent = socialTab === "messages" ? "Messages" : "Friends";
    friendsTabButton.classList.toggle("active", socialTab === "friends");
    messagesTabButton.classList.toggle("active", socialTab === "messages");
    friendsPanel.classList.toggle("active", socialTab === "friends");
    dmPanel.classList.toggle("active", socialTab === "messages");
}

function openSocialDrawer(tab = "friends", friendUserId = null) {
    if (!playerName) return;
    setSocialTab(tab);
    socialDrawer.classList.add("open");
    socialDrawer.setAttribute("aria-hidden", "false");
    if (friendUserId) {
        selectDirectFriend(friendUserId);
    } else {
        renderSocialDrawer();
    }
}

function closeSocialDrawer() {
    socialDrawer.classList.remove("open");
    socialDrawer.setAttribute("aria-hidden", "true");
}

function makeSocialEmpty(text) {
    const empty = document.createElement("p");
    empty.className = "socialEmpty";
    empty.textContent = text;
    return empty;
}

function makeSmallButton(label, onClick, { className = "", disabled = false } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.disabled = disabled;
    button.addEventListener("click", onClick);
    return button;
}

function renderFriendRow(friend) {
    const row = document.createElement("div");
    row.className = "socialFriend";

    const main = document.createElement("div");
    main.className = "socialFriendMain";

    const name = document.createElement("div");
    name.className = "socialFriendName";

    const dot = document.createElement("span");
    dot.className = "presenceDot" + (friend.online ? " online" : "");

    const nameText = document.createElement("span");
    nameText.textContent = friend.username;

    const meta = document.createElement("div");
    meta.className = "socialFriendMeta";
    meta.textContent = friend.locationLabel || (friend.online ? "Online" : "Offline");

    name.appendChild(dot);
    name.appendChild(nameText);
    main.appendChild(name);
    main.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "socialFriendActions";

    if (friend.status === "pending") {
        if (friend.direction === "incoming") {
            actions.appendChild(makeSmallButton("Accept", () => {
                socket.emit("respondFriendRequest", { friendshipId: friend.friendshipId, action: "accept" });
            }));
            actions.appendChild(makeSmallButton("Decline", () => {
                socket.emit("respondFriendRequest", { friendshipId: friend.friendshipId, action: "decline" });
            }, { className: "danger" }));
        } else {
            actions.appendChild(makeSmallButton("Pending", () => {}, { disabled: true }));
            actions.appendChild(makeSmallButton("Cancel", () => {
                socket.emit("removeFriend", { friendshipId: friend.friendshipId });
            }, { className: "danger" }));
        }
    } else {
        actions.appendChild(makeSmallButton("Join", () => {
            socket.emit("joinFriend", { friendUserId: friend.userId });
        }, { disabled: !friend.canJoin }));
        actions.appendChild(makeSmallButton("Message", () => {
            openSocialDrawer("messages", friend.userId);
        }));
        actions.appendChild(makeSmallButton("Remove", () => {
            if (confirm(`Remove ${friend.username} from your friends?`)) {
                socket.emit("removeFriend", { friendshipId: friend.friendshipId });
            }
        }, { className: "danger" }));
    }

    row.appendChild(main);
    row.appendChild(actions);
    return row;
}

function renderFriendsPanel() {
    pendingFriendsList.replaceChildren();
    acceptedFriendsList.replaceChildren();

    const pending = pendingFriends();
    if (!pending.length) {
        pendingFriendsList.appendChild(makeSocialEmpty("No pending requests."));
    } else {
        pending.forEach(friend => pendingFriendsList.appendChild(renderFriendRow(friend)));
    }

    const accepted = acceptedFriends().sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
    });
    if (!accepted.length) {
        acceptedFriendsList.appendChild(makeSocialEmpty("No friends yet."));
    } else {
        accepted.forEach(friend => acceptedFriendsList.appendChild(renderFriendRow(friend)));
    }
}

function renderDmFriendList() {
    dmFriendList.replaceChildren();
    const accepted = acceptedFriends();
    if (!accepted.length) {
        dmFriendList.appendChild(makeSocialEmpty("No friends to message."));
        return;
    }

    accepted
        .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }))
        .forEach((friend) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "dmFriendButton"
                + (friend.userId === activeDmFriendId ? " active" : "")
                + ((unreadDirectMessages[friend.userId] || 0) > 0 ? " hasUnread" : "");
            button.textContent = (unreadDirectMessages[friend.userId] || 0) > 0
                ? `${friend.username} (${unreadDirectMessages[friend.userId]})`
                : friend.username;
            button.title = friend.locationLabel || friend.username;
            button.addEventListener("click", () => selectDirectFriend(friend.userId));
            dmFriendList.appendChild(button);
        });
}

function renderDirectMessages() {
    dmMessages.replaceChildren();
    const friend = activeDmFriendId ? friendByUserId(activeDmFriendId) : null;
    dmHeader.textContent = friend ? friend.username : "Private Messages";
    dmInput.disabled = !friend;
    dmSendButton.disabled = !friend;

    if (!friend) {
        dmMessages.appendChild(makeSocialEmpty("Select a friend to start."));
        return;
    }

    const messages = directMessageThreads[activeDmFriendId] || [];
    if (!messages.length) {
        dmMessages.appendChild(makeSocialEmpty("No messages yet."));
    } else {
        messages.forEach((message) => {
            const row = document.createElement("div");
            row.className = "dmMessage" + (message.senderUsername === playerName ? " own" : "");
            const sender = document.createElement("strong");
            sender.textContent = `${message.senderUsername}: `;
            row.appendChild(sender);
            row.appendChild(document.createTextNode(message.body));
            dmMessages.appendChild(row);
        });
    }
    dmMessages.scrollTop = dmMessages.scrollHeight;
}

function renderSocialDrawer() {
    renderFriendsPanel();
    renderDmFriendList();
    renderDirectMessages();
    updateSocialButtons();
}

function selectDirectFriend(friendUserId) {
    activeDmFriendId = friendUserId;
    unreadDirectMessages[friendUserId] = 0;
    setSocialTab("messages");
    socket.emit("openDirectChat", { friendUserId });
    renderSocialDrawer();
}

function requestFriendFromPlayer(targetId) {
    if (!targetId || targetId === myId) return;
    setSocialNotice("");
    socket.emit("sendFriendRequest", { targetId });
}

function openDirectMessageForPlayer(playerData) {
    const friend = friendByUsername(playerData?.name);
    if (!friend || friend.status !== "accepted") return false;
    openSocialDrawer("messages", friend.userId);
    return true;
}

function setActionButtonVisible(button, visible, disabled = false) {
    button.style.display = visible ? "inline-flex" : "none";
    button.disabled = disabled;
}

function updateRoomBarActions() {
    const canUse = !!playerName && hasJoinedGame;
    const canViewChannelInfo = !!currentChannel;
    const canManageRooms = canUse && !!currentChannel?.canManageRooms;
    const canManageChannelSettings = canUse && (!!currentChannel?.canManage || !!currentChannel?.canDelete);
    const canManageRoomSettings = canUse && !!currentRoom && (!!currentRoom.canCustomize || !!currentRoom.canClose);

    setActionButtonVisible(roomBarChannelInfoButton, canViewChannelInfo, !canViewChannelInfo);
    roomBarChannelInfoButton.textContent = forceChannelHomeOpen ? "Hide Info" : "Info";
    setActionButtonVisible(roomBarNewRoomButton, canManageRooms, !canManageRooms);
    setActionButtonVisible(roomBarChannelSettingsButton, canManageChannelSettings, !canManageChannelSettings);
    setActionButtonVisible(roomBarRoomSettingsButton, canManageRoomSettings, !canManageRoomSettings);
}

function updateChannelControls() {
    const canUseChannels = !!playerName && hasJoinedGame;
    const canCreate = canUseChannels;

    channelCreateInput.disabled = !canCreate;
    channelCreateButton.disabled = !canCreate;
    channelPrivateToggle.disabled = !canCreate;
    channelCodeInput.disabled = !canUseChannels;
    channelJoinCodeButton.disabled = !canUseChannels;
    const canDeleteCurrentChannel = canUseChannels && !!currentChannel?.canDelete;
    const canManageModeration = canUseChannels && canManageCurrentChannel();
    const canUseChannelTools = canDeleteCurrentChannel || canManageModeration;
    channelTools.style.display = canUseChannelTools ? "block" : "none";
    channelDeleteButton.style.display = canDeleteCurrentChannel ? "block" : "none";
    channelDeleteButton.disabled = !canDeleteCurrentChannel;
    channelBanListButton.style.display = canManageModeration ? "block" : "none";
    channelBanListButton.disabled = !canManageModeration;
    if (!canManageModeration) {
        channelBanPanel.style.display = "none";
        channelBanPanel.replaceChildren();
    }
    updateSocialButtons();
    updateRoomBarActions();

    document.querySelectorAll(".channelSelect").forEach((btn) => {
        btn.disabled = false;
    });
    document.querySelectorAll(".channelFavorite, .roomJoinButton, .channelEmptyAction").forEach((btn) => {
        btn.disabled = !canUseChannels;
    });
}

function setCurrentChannelUi(channel) {
    const name = channel?.name || "OpenRealm";
    currentChannelNameEl.textContent = name;
    sidebarCurrentChannelNameEl.textContent = name;
    channelCodeDisplay.textContent = channel?.code ? `Channel code ${channel.code}` : "";
}

function formatRoomLabel(room) {
    const players = Number(room?.playerCount) || 0;
    const bots = Number(room?.botCount) || 0;

    if (!bots) {
        return `${room.name} (${players})`;
    }

    const playerLabel = players === 1 ? "player" : "players";
    const botLabel = bots === 1 ? "bot" : "bots";
    return `${room.name} (${players} ${playerLabel}, ${bots} ${botLabel})`;
}

function formatRoomStats(room) {
    const players = Number(room?.playerCount) || 0;
    const bots = Number(room?.botCount) || 0;
    const playerLabel = players === 1 ? "player" : "players";
    const botLabel = bots === 1 ? "bot" : "bots";

    return `${players} ${playerLabel}, ${bots} ${botLabel}`;
}

function formatRoomMode(mode) {
    return {
        social: "Social",
        watch: "Watch",
        game: "Game",
        custom: "Custom"
    }[mode] || "Social";
}

function formatRoomCreatedAt(room) {
    const createdAt = Number(room?.createdAt);
    if (!createdAt) return "";

    return new Date(createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function formatRoomTooltip(room) {
    const lines = [room.name, `${formatRoomMode(room.mode)} room`, formatRoomStats(room)];
    if (room.description) {
        lines.push(room.description);
    }
    return lines.join("\n");
}

function renderRoomModePanel() {
    roomModePanel.replaceChildren();
    if (!currentRoom) {
        roomModePanel.classList.remove("visible");
        return;
    }

    const definition = roomModeDefinition(currentRoom.mode);
    const config = roomModeConfig(currentRoom);
    const header = document.createElement("div");
    header.className = "roomModeHeader";

    const title = document.createElement("h3");
    const modeTitle = {
        social: config.topic || currentRoom.name,
        watch: config.streamTitle || currentRoom.name,
        game: (definition.settings?.find(setting => setting.key === "gameKey")?.options || [])
            .find(option => option.value === config.gameKey)?.label || "Game Room",
        custom: config.panelTitle || currentRoom.name
    }[currentRoom.mode] || currentRoom.name;
    title.textContent = modeTitle;

    const mode = document.createElement("span");
    mode.textContent = `${definition.label || formatRoomMode(currentRoom.mode)} Mode`;

    header.appendChild(title);
    header.appendChild(mode);
    roomModePanel.appendChild(header);

    const body = document.createElement("div");
    body.className = "roomModeBody";
    body.textContent = {
        social: config.welcome || currentRoom.description || "",
        watch: config.hostNote || currentRoom.description || "",
        game: `Round ${Number(config.roundLength) || 180}s | Score ${Number(config.scoreLimit) || 10}`,
        custom: config.panelBody || currentRoom.description || ""
    }[currentRoom.mode] || currentRoom.description || "";
    roomModePanel.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "roomModeActions";

    if (currentRoom.mode === "social" && config.vibe) {
        const chip = document.createElement("span");
        chip.className = "roomModeChip";
        chip.textContent = config.vibe;
        actions.appendChild(chip);
    }

    if (currentRoom.mode === "watch" && config.streamUrl) {
        const link = document.createElement("a");
        link.href = config.streamUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Open Stream";
        actions.appendChild(link);
    }

    if (currentRoom.mode === "custom" && config.actionLabel && config.actionUrl) {
        const link = document.createElement("a");
        link.href = config.actionUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = config.actionLabel;
        if (config.accentColor) {
            link.style.borderColor = config.accentColor;
            link.style.color = config.accentColor;
        }
        actions.appendChild(link);
    }

    if (actions.children.length) {
        roomModePanel.appendChild(actions);
    }

    roomModePanel.classList.add("visible");
}

function createModeField(setting, value) {
    const label = document.createElement("label");
    label.textContent = setting.label || setting.key;
    let input;

    if (setting.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = 3;
    } else if (setting.type === "select") {
        input = document.createElement("select");
        (setting.options || []).forEach((option) => {
            const item = document.createElement("option");
            item.value = option.value;
            item.textContent = option.label || option.value;
            input.appendChild(item);
        });
    } else {
        input = document.createElement("input");
        input.type = setting.type === "number" || setting.type === "color" || setting.type === "url"
            ? setting.type
            : "text";
    }

    input.dataset.settingKey = setting.key;
    if (setting.maxLength) input.maxLength = setting.maxLength;
    if (setting.min !== undefined) input.min = setting.min;
    if (setting.max !== undefined) input.max = setting.max;
    if (setting.step !== undefined) input.step = setting.step;
    input.value = value ?? "";
    label.appendChild(input);
    return label;
}

function renderRoomCustomizePanel() {
    const canCustomize = !!currentRoom?.canCustomize;
    roomCustomizePanel.style.display = canCustomize ? "grid" : "none";
    roomCustomizeButton.disabled = !canCustomize;

    if (!canCustomize || !currentRoom) {
        roomCustomizeFields.replaceChildren();
        return;
    }

    const modes = Object.entries(roomModeDefinitions);
    roomCustomizeMode.replaceChildren();
    modes.forEach(([mode, definition]) => {
        const option = document.createElement("option");
        option.value = mode;
        option.textContent = `${definition.label || formatRoomMode(mode)} room`;
        roomCustomizeMode.appendChild(option);
    });
    roomCustomizeMode.value = currentRoom.mode || "social";

    const renderFields = () => {
        const definition = roomModeDefinition(roomCustomizeMode.value);
        const config = roomCustomizeMode.value === currentRoom.mode
            ? roomModeConfig(currentRoom)
            : { ...(definition.defaultConfig || {}) };
        roomCustomizeFields.replaceChildren();
        (definition.settings || []).forEach((setting) => {
            roomCustomizeFields.appendChild(createModeField(setting, config[setting.key]));
        });
    };

    roomCustomizeMode.onchange = renderFields;
    renderFields();
}

function populateModeSelect(selectEl, selectedMode = "social") {
    const modes = Object.entries(roomModeDefinitions);
    selectEl.replaceChildren();

    const source = modes.length
        ? modes
        : [["social", { label: "Social" }], ["watch", { label: "Watch" }], ["game", { label: "Game" }], ["custom", { label: "Custom" }]];

    source.forEach(([mode, definition]) => {
        const option = document.createElement("option");
        option.value = mode;
        option.textContent = `${definition.label || formatRoomMode(mode)} room`;
        selectEl.appendChild(option);
    });

    selectEl.value = selectedMode || "social";
}

function collectModeConfig(container) {
    const modeConfig = {};
    container.querySelectorAll("[data-setting-key]").forEach((input) => {
        modeConfig[input.dataset.settingKey] = input.value;
    });
    return modeConfig;
}

function renderRoomSettingsFields() {
    const mode = roomSettingsMode.value || "social";
    const editingRoom = roomSettingsRoomId ? findRoom(roomSettingsRoomId) : null;
    const definition = roomModeDefinition(mode);
    const config = roomSettingsAction === "edit" && editingRoom && editingRoom.mode === mode
        ? roomModeConfig(editingRoom)
        : { ...(definition.defaultConfig || {}) };

    roomSettingsFields.replaceChildren();
    (definition.settings || []).forEach((setting) => {
        roomSettingsFields.appendChild(createModeField(setting, config[setting.key]));
    });
}

function renderRoomDetails(room) {
    const details = document.createElement("div");
    details.className = "roomDetails";

    const title = document.createElement("h4");
    title.textContent = room.name;

    const description = document.createElement("p");
    description.textContent = room.description || "No description yet.";

    const meta = document.createElement("div");
    meta.className = "roomDetailsMeta";
    const created = formatRoomCreatedAt(room);
    meta.textContent = [
        `${formatRoomMode(room.mode)} room`,
        formatRoomStats(room),
        room.ownerName ? `Owner: ${room.ownerName}` : "",
        created ? `Created: ${created}` : ""
    ].filter(Boolean).join(" | ");

    details.appendChild(title);
    details.appendChild(description);
    details.appendChild(meta);
    return details;
}

function findChannel(channelId) {
    return channels.find(channel => channel.id === channelId) || null;
}

function findRoom(roomId) {
    if (currentRoom?.id === roomId) return currentRoom;
    for (const channel of channels) {
        const room = (Array.isArray(channel.rooms) ? channel.rooms : []).find(item => item.id === roomId);
        if (room) return room;
    }
    return rooms.find(room => room.id === roomId) || null;
}

function selectedHomeChannel() {
    let channel = findChannel(selectedHomeChannelId);
    if (!channel && currentChannelId) {
        channel = findChannel(currentChannelId);
    }
    if (!channel) {
        channel = channels.find(item => item.isDefault) || channels[0] || null;
    }
    if (channel) {
        selectedHomeChannelId = channel.id;
    }
    return channel;
}

function selectChannelHome(channelId) {
    forceChannelHomeOpen = false;
    selectedHomeChannelId = channelId;
    renderChannelHome();
    updateRoomBarActions();
}

function closeChannelHomePanel() {
    forceChannelHomeOpen = false;
    if (currentChannelId) {
        selectedHomeChannelId = currentChannelId;
    }
    renderChannelHome();
    updateRoomBarActions();
}

function formatChannelCreatedAt(channel) {
    const createdAt = Number(channel?.createdAt);
    if (!createdAt) return "";

    return new Date(createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function channelRoleLabel(channel) {
    if (channel?.role) {
        return channel.role.charAt(0).toUpperCase() + channel.role.slice(1);
    }
    return channel?.isMember ? "Member" : "Visitor";
}

function makeHomeAction(label, className, onClick, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `channelHomeAction ${className || ""}`.trim();
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", onClick);
    return button;
}

function setManageTab(tab) {
    manageTab = tab === "room" ? "room" : "channel";
    channelSettingsTab.classList.toggle("active", manageTab === "channel");
    roomSettingsTab.classList.toggle("active", manageTab === "room");
    channelSettingsPanel.classList.toggle("active", manageTab === "channel");
    roomSettingsPanel.classList.toggle("active", manageTab === "room");
    manageTitle.textContent = manageTab === "room"
        ? (roomSettingsAction === "create" ? "Create Room" : "Room Settings")
        : "Channel Settings";
}

function openManageOverlay(tab = "channel") {
    closeSocialDrawer();
    closeChannelBrowser();
    manageOverlay.classList.add("open");
    manageOverlay.setAttribute("aria-hidden", "false");
    setManageStatus("");
    setManageTab(tab);
}

function closeManageOverlay() {
    manageOverlay.classList.remove("open");
    manageOverlay.setAttribute("aria-hidden", "true");
    setManageStatus("");
    settingsBanPanel.style.display = "none";
    settingsBanPanel.replaceChildren();
}

function fillChannelSettings(channel = selectedHomeChannel()) {
    if (!channel) return false;
    settingsChannelId = channel.id;
    channelSettingsName.value = channel.name || "";
    channelSettingsDescription.value = channel.description || "";
    channelSettingsPrivate.checked = !channel.isPublic;
    channelSettingsCode.textContent = channel.isDefault
        ? "The default OpenRealm channel always stays public."
        : (channel.code ? `Channel code: ${channel.code}` : "Public discovery does not require a code.");
    settingsBanListButton.style.display = channel.canManage && !channel.isDefault ? "inline-flex" : "none";
    settingsDeleteChannelButton.style.display = channel.canDelete ? "inline-flex" : "none";
    channelSettingsName.disabled = !channel.canManage;
    channelSettingsDescription.disabled = !channel.canManage;
    channelSettingsPrivate.disabled = !channel.canManage || !!channel.isDefault;
    return true;
}

function openChannelSettings(channelId = selectedHomeChannelId) {
    const channel = findChannel(channelId) || selectedHomeChannel();
    if (!channel || (!channel.canManage && !channel.canDelete)) return;
    selectedHomeChannelId = channel.id;
    if (!fillChannelSettings(channel)) return;
    openManageOverlay("channel");
    window.setTimeout(() => channelSettingsName.focus(), 0);
}

function openRoomSettings(room = currentRoom, { create = false, channelId = currentChannelId } = {}) {
    const channel = findChannel(channelId) || currentChannel || selectedHomeChannel();
    if (create && !channel?.canManageRooms) return;
    if (!create && !room) return;

    roomSettingsAction = create ? "create" : "edit";
    roomSettingsRoomId = create ? null : room.id;
    roomSettingsChannelId = create ? channel?.id : (room.channelId || channel?.id || currentChannelId);
    populateModeSelect(roomSettingsMode, create ? "social" : (room.mode || "social"));

    roomSettingsName.value = create ? "" : (room.name || "");
    roomSettingsDescription.value = create ? "" : (room.description || "");
    roomSettingsSave.textContent = create ? "Create Room" : "Save Room";
    settingsCloseRoomButton.style.display = !create && !room.isDefault && (room.canClose || channel?.canManageRooms)
        ? "inline-flex"
        : "none";
    renderRoomSettingsFields();
    openManageOverlay("room");
    window.setTimeout(() => roomSettingsName.focus(), 0);
}

function renderChannelHome() {
    if (!channelHomeEl) return;
    channelHomeEl.replaceChildren();

    const channel = selectedHomeChannel();
    if (!channel) {
        channelHomeEl.classList.remove("hidden");
        const empty = document.createElement("p");
        empty.className = "channelHomeEmpty";
        empty.textContent = "No channels to show yet.";
        channelHomeEl.appendChild(empty);
        return;
    }

    const isLiveCurrentChannel = channel.id === currentChannelId && !!currentRoomId && !!currentRoom;
    channelHomeEl.classList.toggle("hidden", isLiveCurrentChannel && !forceChannelHomeOpen);
    if (isLiveCurrentChannel && !forceChannelHomeOpen) return;

    const header = document.createElement("div");
    header.className = "channelHomeHeader";

    const titleBlock = document.createElement("div");
    titleBlock.className = "channelHomeTitle";

    const eyebrow = document.createElement("span");
    eyebrow.textContent = channel.isPublic ? "Public Channel" : "Private Channel";

    const title = document.createElement("h2");
    title.textContent = channel.name;

    const description = document.createElement("p");
    description.textContent = channel.description || "No channel description yet.";

    titleBlock.appendChild(eyebrow);
    titleBlock.appendChild(title);
    titleBlock.appendChild(description);

    const actions = document.createElement("div");
    actions.className = "channelHomeActions";

    if (!playerName) {
        actions.appendChild(makeHomeAction("Log In To Join", "primary", () => {}, true));
    } else if (channel.isMember) {
        actions.appendChild(makeHomeAction(channel.roomCount > 0 ? "Open Channel" : "Manage Channel", "primary", () => {
            openChannelContext(channel);
        }));
        actions.appendChild(makeHomeAction(channel.isFavorite ? "Saved" : "Save", "secondary", () => {
            socket.emit("toggleFavoriteChannel", { channelId: channel.id });
        }));
        if (channel.canManageRooms) {
            actions.appendChild(makeHomeAction("New Room", "secondary", () => {
                openRoomSettings(null, { create: true, channelId: channel.id });
            }));
        }
        if (channel.canManage || channel.canDelete) {
            actions.appendChild(makeHomeAction("Channel Settings", "secondary", () => {
                openChannelSettings(channel.id);
            }));
        }
    } else {
        actions.appendChild(makeHomeAction("Join Channel", "primary", () => {
            socket.emit("joinChannel", { channelId: channel.id });
        }));
    }
    if (currentRoomId || currentChannelId) {
        actions.appendChild(makeHomeAction("Close", "secondary", closeChannelHomePanel));
    }

    header.appendChild(titleBlock);
    header.appendChild(actions);

    const stats = document.createElement("div");
    stats.className = "channelHomeStats";
    const created = formatChannelCreatedAt(channel);
    [
        `Owner: ${channel.ownerName || "Unknown"}`,
        `${Number(channel.memberCount) || 0} members`,
        `${Number(channel.playerCount) || 0} online`,
        `${Number(channel.roomCount) || 0} rooms`,
        channel.isMember ? channelRoleLabel(channel) : "Preview",
        created ? `Created ${created}` : ""
    ].filter(Boolean).forEach((value) => {
        const stat = document.createElement("span");
        stat.textContent = value;
        stats.appendChild(stat);
    });

    const roomStrip = document.createElement("div");
    roomStrip.className = "channelHomeRooms";

    const roomHeader = document.createElement("div");
    roomHeader.className = "channelHomeRoomsHeader";
    const roomsTitle = document.createElement("h3");
    roomsTitle.textContent = "Rooms";
    const roomsHint = document.createElement("span");
    roomsHint.textContent = channel.isMember ? "Join any room in this channel." : "Preview rooms before joining.";
    roomHeader.appendChild(roomsTitle);
    roomHeader.appendChild(roomsHint);
    roomStrip.appendChild(roomHeader);

    const homeRooms = Array.isArray(channel.rooms) ? channel.rooms : [];
    if (channel.roomsHidden) {
        const empty = document.createElement("p");
        empty.className = "channelHomeEmpty";
        empty.textContent = "Join this channel to view its rooms.";
        roomStrip.appendChild(empty);
    } else if (!homeRooms.length) {
        const empty = document.createElement("p");
        empty.className = "channelHomeEmpty";
        empty.textContent = channel.canManageRooms
            ? "No rooms yet. Create the first room from Channel Home."
            : "No rooms have been created yet.";
        roomStrip.appendChild(empty);
    } else {
        homeRooms.slice(0, 6).forEach((room) => {
            const row = document.createElement("div");
            row.className = "channelHomeRoom" + (room.id === currentRoomId ? " current" : "");

            const info = document.createElement("div");
            info.className = "channelHomeRoomInfo";

            const roomName = document.createElement("strong");
            roomName.textContent = room.name;

            const roomMeta = document.createElement("span");
            roomMeta.textContent = `${formatRoomMode(room.mode)} | ${formatRoomStats(room)}`;

            info.appendChild(roomName);
            info.appendChild(roomMeta);

            const roomActions = document.createElement("div");
            roomActions.className = "channelHomeRoomActions";

            const button = document.createElement("button");
            button.type = "button";
            button.textContent = room.id === currentRoomId
                ? "Current"
                : (channel.isMember ? "Join" : "Join Channel");
            button.disabled = !playerName || room.id === currentRoomId;
            button.addEventListener("click", () => {
                if (!playerName || room.id === currentRoomId) return;
                if (!channel.isMember) {
                    socket.emit("joinChannel", { channelId: channel.id });
                    return;
                }
                socket.emit("joinRoom", { roomId: room.id });
            });
            roomActions.appendChild(button);

            if (channel.canManageRooms) {
                const editButton = document.createElement("button");
                editButton.type = "button";
                editButton.textContent = "Edit";
                editButton.addEventListener("click", () => openRoomSettings(room, { channelId: channel.id }));
                roomActions.appendChild(editButton);
            }

            row.appendChild(info);
            row.appendChild(roomActions);
            roomStrip.appendChild(row);
        });
    }

    channelHomeEl.appendChild(header);
    channelHomeEl.appendChild(stats);
    channelHomeEl.appendChild(roomStrip);
}

function openChannelContext(channel) {
    if (!channel?.isMember || !playerName) return;
    setChannelError("");
    socket.emit("joinChannel", { channelId: channel.id });
}

function openChannelBrowser() {
    if (!playerName) return;
    closeSocialDrawer();
    channelBrowserOverlay.classList.add("open");
    channelBrowserOverlay.setAttribute("aria-hidden", "false");
    renderChannelBrowser();
    window.setTimeout(() => channelBrowserSearch.focus(), 0);
}

function closeChannelBrowser() {
    channelBrowserOverlay.classList.remove("open");
    channelBrowserOverlay.setAttribute("aria-hidden", "true");
    channelBrowserPendingAction = "";
}

function channelMatchesBrowserQuery(channel, query) {
    if (!query) return true;

    return [
        channel.name,
        channel.ownerName,
        channel.description
    ].some(value => String(value || "").toLowerCase().includes(query));
}

function compareBrowserChannels(a, b) {
    if (channelBrowserSortMode === "members") {
        return (Number(b.memberCount) || 0) - (Number(a.memberCount) || 0)
            || String(a.name).localeCompare(String(b.name));
    }

    if (channelBrowserSortMode === "rooms") {
        return (Number(b.roomCount) || 0) - (Number(a.roomCount) || 0)
            || (Number(b.playerCount) || 0) - (Number(a.playerCount) || 0)
            || String(a.name).localeCompare(String(b.name));
    }

    if (channelBrowserSortMode === "newest") {
        return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
            || String(a.name).localeCompare(String(b.name));
    }

    if (channelBrowserSortMode === "name") {
        return String(a.name).localeCompare(String(b.name));
    }

    return (Number(b.playerCount) || 0) - (Number(a.playerCount) || 0)
        || (Number(b.memberCount) || 0) - (Number(a.memberCount) || 0)
        || (Number(b.roomCount) || 0) - (Number(a.roomCount) || 0)
        || String(a.name).localeCompare(String(b.name));
}

function publicBrowserChannels() {
    const query = channelBrowserQuery.trim().toLowerCase();

    return channels
        .filter(channel => channel.isPublic)
        .filter(channel => !channelBrowserOnlyUnjoined || !channel.isMember)
        .filter(channel => !channelBrowserOnlyActive || (Number(channel.playerCount) || 0) > 0)
        .filter(channel => !channelBrowserOnlyRooms || (Number(channel.roomCount) || 0) > 0)
        .filter(channel => channelMatchesBrowserQuery(channel, query))
        .sort(compareBrowserChannels);
}

function makeBrowserAction(label, className, onClick, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className || "";
    button.disabled = disabled;
    button.addEventListener("click", onClick);
    return button;
}

function renderChannelBrowser() {
    channelBrowserResults.replaceChildren();

    const results = publicBrowserChannels();
    const totalPublic = channels.filter(channel => channel.isPublic).length;
    const resultWord = results.length === 1 ? "channel" : "channels";
    channelBrowserStats.textContent = `${results.length} ${resultWord} found from ${totalPublic} public channels`;

    if (!results.length) {
        const empty = document.createElement("p");
        empty.className = "channelEmpty";
        empty.textContent = channelBrowserQuery.trim() ? "No public channels match these filters." : "No public channels to show yet.";
        channelBrowserResults.appendChild(empty);
        return;
    }

    results.forEach((channel) => {
        const card = document.createElement("article");
        card.className = "channelBrowserCard" + (channel.id === currentChannelId ? " current" : "");

        const header = document.createElement("div");
        header.className = "channelBrowserCardHeader";

        const name = document.createElement("strong");
        name.textContent = channel.name;

        const owner = document.createElement("span");
        owner.textContent = `Owner: ${channel.ownerName || "Unknown"}${channel.isMember ? " - Joined" : ""}`;

        header.appendChild(name);
        header.appendChild(owner);

        const description = document.createElement("p");
        description.className = "channelBrowserDescription";
        description.textContent = channel.description || "No channel description yet.";

        const meta = document.createElement("div");
        meta.className = "channelBrowserMeta";
        [
            `${Number(channel.memberCount) || 0} members`,
            `${Number(channel.playerCount) || 0} online`,
            `${Number(channel.roomCount) || 0} rooms`,
            formatChannelCreatedAt(channel) ? `Created ${formatChannelCreatedAt(channel)}` : ""
        ].filter(Boolean).forEach((label) => {
            const chip = document.createElement("span");
            chip.textContent = label;
            meta.appendChild(chip);
        });

        const actions = document.createElement("div");
        actions.className = "channelBrowserActions";

        if (channel.isMember) {
            actions.appendChild(makeBrowserAction("Open", "primary", () => {
                closeChannelBrowser();
                openChannelContext(channel);
            }));
            actions.appendChild(makeBrowserAction(channel.isFavorite ? "Saved" : "Save", "", () => {
                socket.emit("toggleFavoriteChannel", { channelId: channel.id });
            }));
        } else {
            actions.appendChild(makeBrowserAction("Join", "primary", () => {
                setChannelError("");
                socket.emit("joinChannel", { channelId: channel.id });
                closeChannelBrowser();
            }, !playerName));
            actions.appendChild(makeBrowserAction("Preview", "", () => {
                selectChannelHome(channel.id);
                closeChannelBrowser();
            }));
        }

        card.appendChild(header);
        card.appendChild(description);
        card.appendChild(meta);
        card.appendChild(actions);
        channelBrowserResults.appendChild(card);
    });
}

function renderChannelBucket(listEl, bucket, emptyText) {
    listEl.replaceChildren();

    if (!bucket.length) {
        const empty = document.createElement("p");
        empty.className = "channelEmpty";
        empty.textContent = emptyText;
        listEl.appendChild(empty);
        return;
    }

    bucket.forEach((channel) => {
        const isExpanded = expandedChannelIds.has(channel.id) || channel.id === currentChannelId;
        const item = document.createElement("div");
        item.className = "channelItem"
            + (channel.id === currentChannelId ? " current" : "")
            + (channel.id === selectedHomeChannelId ? " selected" : "")
            + (isExpanded ? " expanded" : "");

        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.className = "channelSelect";
        selectButton.dataset.channelId = channel.id;

        const name = document.createElement("span");
        name.className = "channelName";
        name.textContent = channel.name;

        const meta = document.createElement("span");
        meta.className = "channelMeta";
        const roomWord = channel.roomCount === 1 ? "room" : "rooms";
        meta.textContent = `${channel.roomCount} ${roomWord} - ${channel.playerCount} online`;

        selectButton.appendChild(name);
        selectButton.appendChild(meta);
        selectButton.addEventListener("click", () => {
            setChannelError("");
            selectChannelHome(channel.id);
            if (expandedChannelIds.has(channel.id)) {
                expandedChannelIds.delete(channel.id);
            } else {
                expandedChannelIds.add(channel.id);
            }
            if (channel.isMember && channel.roomCount === 0) {
                openChannelContext(channel);
            }
            renderChannelList();
        });

        const favoriteButton = document.createElement("button");
        favoriteButton.type = "button";
        favoriteButton.className = "channelFavorite" + (channel.isFavorite ? " saved" : "");
        favoriteButton.textContent = channel.isMember
            ? (channel.isFavorite ? "Saved" : "Save")
            : "Join";
        favoriteButton.addEventListener("click", () => {
            setChannelError("");
            selectChannelHome(channel.id);
            if (channel.isMember) {
                socket.emit("toggleFavoriteChannel", { channelId: channel.id });
            } else {
                socket.emit("joinChannel", { channelId: channel.id });
            }
        });

        item.appendChild(selectButton);
        item.appendChild(favoriteButton);

        const roomList = document.createElement("div");
        roomList.className = "channelRooms";
        const channelRooms = Array.isArray(channel.rooms) ? channel.rooms : [];

        if (channel.roomsHidden) {
            const empty = document.createElement("p");
            empty.className = "channelEmpty";
            empty.textContent = "Join to view rooms.";
            roomList.appendChild(empty);
        } else if (!channelRooms.length) {
            const empty = document.createElement("p");
            empty.className = "channelEmpty";
            empty.textContent = "No rooms yet.";
            roomList.appendChild(empty);

            if (channel.isMember) {
                const openButton = document.createElement("button");
                openButton.type = "button";
                openButton.className = "channelEmptyAction";
                openButton.textContent = channel.canManageRooms || channel.canDelete ? "Manage" : "Open";
                openButton.addEventListener("click", () => openChannelContext(channel));
                roomList.appendChild(openButton);
            }
        } else {
            channelRooms.forEach((room) => {
                const isCurrentRoom = room.id === currentRoomId;
                const roomRow = document.createElement("div");
                roomRow.className = "roomRow" + (isCurrentRoom ? " current" : "");
                roomRow.title = formatRoomTooltip(room);

                const roomLabel = document.createElement("span");
                roomLabel.className = "roomLabel";
                roomLabel.textContent = formatRoomLabel(room);

                const roomInfoButton = document.createElement("button");
                roomInfoButton.type = "button";
                roomInfoButton.className = "roomInfoButton";
                roomInfoButton.title = formatRoomTooltip(room);
                roomInfoButton.setAttribute("aria-label", `Show details for ${room.name}`);
                roomInfoButton.setAttribute("aria-expanded", expandedRoomInfoId === room.id ? "true" : "false");
                roomInfoButton.appendChild(roomLabel);
                roomInfoButton.addEventListener("click", () => {
                    expandedRoomInfoId = expandedRoomInfoId === room.id ? null : room.id;
                    renderChannelList();
                });

                const roomJoinButton = document.createElement("button");
                roomJoinButton.type = "button";
                roomJoinButton.className = "roomJoinButton";
                roomJoinButton.dataset.roomId = room.id;
                roomJoinButton.dataset.current = isCurrentRoom ? "true" : "false";
                roomJoinButton.textContent = isCurrentRoom
                    ? "Current"
                    : (channel.isMember ? "Join" : "Join");
                roomJoinButton.disabled = isCurrentRoom;
                roomJoinButton.addEventListener("click", () => {
                    if (isCurrentRoom) return;
                    setRoomError("");
                    if (!channel.isMember) {
                        socket.emit("joinChannel", { channelId: channel.id });
                        return;
                    }
                    socket.emit("joinRoom", { roomId: room.id });
                });

                roomRow.appendChild(roomInfoButton);
                roomRow.appendChild(roomJoinButton);
                roomList.appendChild(roomRow);

                if (expandedRoomInfoId === room.id) {
                    roomList.appendChild(renderRoomDetails(room));
                }
            });
        }

        item.appendChild(roomList);
        listEl.appendChild(item);
    });
}

function renderChannelList() {
    const favorites = channels.filter(channel => channel.isFavorite && channel.isMember);
    const memberChannels = channels.filter(channel => channel.isMember);

    renderChannelBucket(favoriteChannelListEl, favorites, "No saved channels.");
    renderChannelBucket(memberChannelListEl, memberChannels, "No joined channels.");
    renderChannelBrowser();
    renderChannelHome();
    updateChannelControls();
}

function updateRoomControls() {
    const canUseRooms = !!playerName && hasJoinedGame;
    const canCreate = canUseRooms && !!currentChannel?.canManageRooms;
    roomCreateButton.disabled = !canCreate;
    roomCreateInput.disabled = !canCreate;
    roomModeSelect.disabled = !canCreate;
    roomCreateDescription.disabled = !canCreate;
    roomCloseButton.style.display = currentRoom?.canClose ? "block" : "none";
    roomCloseButton.disabled = !currentRoom?.canClose;
    renderRoomCustomizePanel();
    renderRoomModePanel();
    updateRoomBarActions();
    document.querySelectorAll(".roomJoinButton").forEach((btn) => {
        btn.disabled = !canUseRooms || btn.dataset.current === "true";
    });
}

channelBrowserSearch.addEventListener("input", (e) => {
    channelBrowserQuery = e.target.value || "";
    renderChannelBrowser();
});

channelBrowserSort.addEventListener("change", (e) => {
    channelBrowserSortMode = e.target.value || "activity";
    renderChannelBrowser();
});

channelBrowserUnjoinedToggle.addEventListener("change", (e) => {
    channelBrowserOnlyUnjoined = !!e.target.checked;
    renderChannelBrowser();
});

channelBrowserActiveToggle.addEventListener("change", (e) => {
    channelBrowserOnlyActive = !!e.target.checked;
    renderChannelBrowser();
});

channelBrowserRoomsToggle.addEventListener("change", (e) => {
    channelBrowserOnlyRooms = !!e.target.checked;
    renderChannelBrowser();
});

channelBrowserButton.addEventListener("click", openChannelBrowser);
channelBrowserClose.addEventListener("click", closeChannelBrowser);
channelBrowserOverlay.addEventListener("click", (e) => {
    if (e.target === channelBrowserOverlay) closeChannelBrowser();
});
roomBarChannelInfoButton.addEventListener("click", () => {
    if (!currentChannel) return;
    selectedHomeChannelId = currentChannelId;
    forceChannelHomeOpen = !forceChannelHomeOpen;
    renderChannelHome();
    updateRoomBarActions();
});
roomBarNewRoomButton.addEventListener("click", () => {
    if (!currentChannel?.canManageRooms) return;
    openRoomSettings(null, { create: true, channelId: currentChannelId });
});
roomBarChannelSettingsButton.addEventListener("click", () => {
    if (!currentChannel || (!currentChannel.canManage && !currentChannel.canDelete)) return;
    openChannelSettings(currentChannelId);
});
roomBarRoomSettingsButton.addEventListener("click", () => {
    if (!currentRoom || (!currentRoom.canCustomize && !currentRoom.canClose)) return;
    openRoomSettings(currentRoom, { channelId: currentRoom.channelId || currentChannelId });
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && channelBrowserOverlay.classList.contains("open")) {
        closeChannelBrowser();
    }
    if (e.key === "Escape" && manageOverlay.classList.contains("open")) {
        closeManageOverlay();
    }
});

friendsButton.addEventListener("click", () => openSocialDrawer("friends"));
messagesButton.addEventListener("click", () => openSocialDrawer("messages"));
socialCloseButton.addEventListener("click", closeSocialDrawer);
friendsTabButton.addEventListener("click", () => {
    setSocialTab("friends");
    renderSocialDrawer();
});
messagesTabButton.addEventListener("click", () => {
    setSocialTab("messages");
    renderSocialDrawer();
});

dmForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeDmFriendId) return;
    const body = dmInput.value.trim();
    if (!body) return;
    socket.emit("sendDirectMessage", { friendUserId: activeDmFriendId, body });
    dmInput.value = "";
});

channelCreateForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = channelCreateInput.value.trim();

    if (!playerName) {
        setChannelError("Log in to create channels.");
        return;
    }
    if (!name) {
        setChannelError("Name required.");
        return;
    }

    channelBrowserPendingAction = "create";
    setChannelError("Creating channel...", false);
    socket.emit("createChannel", { name, isPrivate: channelPrivateToggle.checked });
});

channelJoinCodeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = channelCodeInput.value.trim();

    if (!playerName) {
        setChannelError("Log in to join channels.");
        return;
    }
    if (!code) {
        setChannelError("Code required.");
        return;
    }

    channelBrowserPendingAction = "joinCode";
    setChannelError("Checking channel code...", false);
    socket.emit("joinChannelByCode", { code });
});

manageClose.addEventListener("click", closeManageOverlay);
manageOverlay.addEventListener("click", (e) => {
    if (e.target === manageOverlay) closeManageOverlay();
});
channelSettingsTab.addEventListener("click", () => {
    fillChannelSettings(findChannel(settingsChannelId) || selectedHomeChannel());
    setManageTab("channel");
});
roomSettingsTab.addEventListener("click", () => {
    if (!roomSettingsRoomId && roomSettingsAction !== "create" && currentRoom) {
        openRoomSettings(currentRoom, { channelId: currentRoom.channelId || currentChannelId });
        return;
    }
    setManageTab("room");
});

channelSettingsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!settingsChannelId) return;
    const name = channelSettingsName.value.trim();
    if (!name) {
        setManageStatus("Channel name is required.", true);
        return;
    }

    setManageStatus("Saving channel...");
    socket.emit("updateChannel", {
        channelId: settingsChannelId,
        name,
        description: channelSettingsDescription.value.trim(),
        isPrivate: channelSettingsPrivate.checked
    });
});

settingsBanListButton.addEventListener("click", () => {
    if (!settingsChannelId) return;
    if (settingsBanPanel.style.display === "block") {
        settingsBanPanel.style.display = "none";
        settingsBanPanel.replaceChildren();
        return;
    }
    setManageStatus("Loading bans...");
    socket.emit("getChannelBanList", { channelId: settingsChannelId });
});

settingsDeleteChannelButton.addEventListener("click", () => {
    const channel = findChannel(settingsChannelId);
    if (!channel?.canDelete) return;
    const confirmed = confirm(
        `Delete ${channel.name}? This will remove all rooms in the channel and move everyone back to Town Square.`
    );
    if (!confirmed) return;
    setManageStatus("Deleting channel...");
    socket.emit("deleteChannel", { channelId: channel.id });
    closeManageOverlay();
});

roomSettingsMode.addEventListener("change", renderRoomSettingsFields);

roomSettingsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = roomSettingsName.value.trim();
    if (!name) {
        setManageStatus("Room name is required.", true);
        return;
    }

    const payload = {
        name,
        description: roomSettingsDescription.value.trim(),
        mode: roomSettingsMode.value,
        modeConfig: collectModeConfig(roomSettingsFields)
    };

    if (roomSettingsAction === "create") {
        setManageStatus("Creating room...");
        socket.emit("createRoom", {
            ...payload,
            channelId: roomSettingsChannelId || currentChannelId
        });
        closeManageOverlay();
        return;
    }

    if (!roomSettingsRoomId) return;
    setManageStatus("Saving room...");
    socket.emit("updateRoom", {
        ...payload,
        roomId: roomSettingsRoomId
    });
});

settingsCloseRoomButton.addEventListener("click", () => {
    const room = findRoom(roomSettingsRoomId);
    if (!room || room.isDefault) return;
    const confirmed = confirm(`Close ${room.name}? Everyone inside will be moved to another room.`);
    if (!confirmed) return;
    setManageStatus("Closing room...");
    socket.emit("closeRoom", { roomId: room.id });
    closeManageOverlay();
});

channelDeleteButton.addEventListener("click", () => {
    if (!currentChannel?.canDelete) return;

    const confirmed = confirm(
        `Delete ${currentChannel.name}? This will remove all rooms in the channel and move everyone back to Town Square.`
    );
    if (!confirmed) return;

    setChannelError("");
    socket.emit("deleteChannel", { channelId: currentChannel.id });
});

channelBanListButton.addEventListener("click", () => {
    if (!canManageCurrentChannel()) return;
    if (channelBanPanel.style.display === "block") {
        channelBanPanel.style.display = "none";
        return;
    }
    socket.emit("getChannelBanList", { channelId: currentChannelId });
});

roomCreateForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = roomCreateInput.value.trim();
    const description = roomCreateDescription.value.trim();
    const mode = roomModeSelect.value;

    if (!playerName) {
        setRoomError("Log in to create rooms.");
        return;
    }
    if (!name) {
        setRoomError("Name required.");
        return;
    }

    setRoomError("");
    socket.emit("createRoom", { name, description, mode, channelId: currentChannelId });
    roomCreateInput.value = "";
    roomModeSelect.value = "social";
    roomCreateDescription.value = "";
});

roomCustomizePanel.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!currentRoom?.canCustomize) return;

    const mode = roomCustomizeMode.value;
    const modeConfig = {};
    roomCustomizeFields.querySelectorAll("[data-setting-key]").forEach((input) => {
        modeConfig[input.dataset.settingKey] = input.value;
    });

    setRoomError("");
    socket.emit("updateRoomModeConfig", {
        roomId: currentRoom.id,
        mode,
        modeConfig
    });
});

roomCloseButton.addEventListener("click", () => {
    if (!currentRoom?.canClose) return;
    setRoomError("");
    socket.emit("closeRoom", { roomId: currentRoom.id });
});

updateRoomControls();
updateChannelControls();

// --- Shared Player State ---
// A dictionary of all players currently in the game, keyed by socket ID.
// This mirrors the server's players object and is kept in sync via events.
const players = {};

// Our own socket ID — assigned by the server on connect.
// Used to distinguish our player from others (e.g. draw us in a different color).
// Starts as null because we don't know it until the "connect" event fires.
let myId = null;

// --- Local Player Object ---
// Tracks OUR player's position and properties on the client side.
// This is separate from players[myId] — we update this immediately
// on input so movement feels instant, then sync it to players[myId]
// and emit it to the server.
let player = {
    x: 400,      // Starting X position (pixels from the left of the canvas)
    y: 300,      // Starting Y position (pixels from the top of the canvas)
    size: 20,    // Width and height of the player square in pixels
    speed: 1     // How many pixels the player moves per frame
};

// --- Movement Throttle ---
// Track the last position we sent to the server. We only emit a
// "playerMove" event when the position actually changes — this avoids
// flooding the server with identical messages every single frame.
let lastEmittedX = player.x;
let lastEmittedY = player.y;

// --- Point-and-Click Movement ---
// When the player clicks on the canvas, we store that position as a
// movement target. Each frame, updatePlayer() moves the player toward
// it and clears it once they arrive.
// The target is the top-left corner we want the player square to reach,
// calculated by offsetting from the click so the player centers on it.
let moveTarget = null;

// Local-only click ripples — never sent to server.
// Each entry: { x, y, startTime } drawn as an expanding circle.
const clickRipples = [];
const RIPPLE_DURATION = 500; // ms
const RIPPLE_MAX_RADIUS = 18;

canvas.addEventListener("click", (e) => {
    // Only allow movement for logged-in players.
    if (!playerName) return;

    // Convert pointer coordinates into the canvas's fixed 800x600 world.
    const point = getCanvasPoint(e);

    // We subtract half the player size so the player centers on the click
    // rather than placing its top-left corner there.
    moveTarget = {
        x: point.x - player.size / 2,
        y: point.y - player.size / 2
    };

    // Spawn a ripple at the exact click point.
    clickRipples.push({ x: point.x, y: point.y, startTime: performance.now() });
});

// --- Duration Picker ---
// Shared picker shown when an admin selects Mute or Freeze.
// Stores the pending action and target until a duration button is clicked.
const durationPicker = document.getElementById("durationPicker");
let durationPendingAction = null;
let durationPendingTarget = null;
let durationPendingMode = "admin";

function showDurationPicker(action, targetId, left, top, mode = "admin") {
    const titles = {
        mute: "Mute for how long?",
        freeze: "Freeze for how long?",
        channelBan: "Ban for how long?"
    };
    document.getElementById("durationPickerTitle").textContent = titles[action] || "Choose duration";
    durationPendingAction = action;
    durationPendingTarget = targetId;
    durationPendingMode = mode;
    durationPicker.style.left    = left;
    durationPicker.style.top     = top;
    durationPicker.style.display = "block";
}

durationPicker.addEventListener("click", (e) => e.stopPropagation());

document.querySelectorAll("#durationPicker button[data-minutes]").forEach(btn => {
    btn.addEventListener("click", () => {
        if (!durationPendingTarget || !durationPendingAction) return;
        const minutes = parseInt(btn.dataset.minutes, 10);
        if (durationPendingMode === "channelBan") {
            socket.emit("channelModerationAction", {
                targetId: durationPendingTarget,
                action: "ban",
                duration: minutes > 0 ? minutes : null
            });
        } else {
            socket.emit("adminAction", {
                targetId: durationPendingTarget,
                action:   durationPendingAction,
            duration: minutes > 0 ? minutes : null   // 0 = Permanent → no duration
        });
        }
        durationPicker.style.display = "none";
        durationPendingAction = null;
        durationPendingTarget = null;
        durationPendingMode = "admin";
    });
});

// --- Avatar Color Customizer ---
// The avatar button in the player bar shows the current color and opens
// a swatch panel where the player can pick a preset or custom hex color.
// Changes are saved to MongoDB and broadcast live to all other players.

function syncAvatarButton(color) {
    const btn = document.getElementById("avatarColorBtn");
    if (btn) btn.style.background = color;
}

function applyAvatarColor(color) {
    if (!playerName || !myId) return;
    if (players[myId]) players[myId].avatar = { color };
    syncAvatarButton(color);
    socket.emit("updateAvatar", { color });
    document.getElementById("avatarPanel").style.display = "none";
}

document.getElementById("avatarColorBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const panel = document.getElementById("avatarPanel");
    panel.style.display = panel.style.display === "block" ? "none" : "block";
});

document.getElementById("avatarPanel").addEventListener("click", (e) => e.stopPropagation());

document.querySelectorAll("#avatarSwatches .swatch").forEach(swatch => {
    swatch.addEventListener("click", () => applyAvatarColor(swatch.dataset.color));
});

document.getElementById("avatarCustomColor").addEventListener("input", (e) => {
    applyAvatarColor(e.target.value);
});

// --- Canvas Right-Click Context Menu (Admin only) ---
// Right-clicking on the canvas checks whether the cursor is over a bot.
// If so, show "Remove Bot". Otherwise show "Spawn Bot Here".
const canvasMenu = document.getElementById("canvasContextMenu");

canvas.addEventListener("contextmenu", (e) => {
    // Any logged-in player can right-click. Admin-only options are hidden below.
    if (!playerName) return;
    e.preventDefault();

    const point = getCanvasPoint(e);
    const clickX = point.x;
    const clickY = point.y;

    // Check if the click landed on any player or bot.
    // We iterate all players and test whether the click falls within
    // each square's bounding box (x, y) to (x+size, y+size).
    // We skip our own player — admins can't action themselves.
    let hitBot    = null;
    let hitPlayer = null;

    for (const [id, p] of Object.entries(players)) {
        if (id === myId) continue;
        const size = p.size || 20;
        if (clickX >= p.x && clickX <= p.x + size &&
            clickY >= p.y && clickY <= p.y + size) {
            if (p.isBot) hitBot    = id;
            else         hitPlayer = id;
            break;
        }
    }

    const hitTarget = hitBot || hitPlayer; // Any hit target
    const p = hitTarget ? players[hitTarget] : null;

    // Spawn Bot — admin only, empty canvas space only
    const canManageRoomTools = canManageCurrentRooms();
    const canModerate = canModerateCurrentChannel();

    document.getElementById("ctxSpawnBot").style.display =
        canManageRoomTools && !hitTarget ? "block" : "none";

    // Remove Bot — admin only, bot targets only
    document.getElementById("ctxRemoveBot").style.display =
        canManageRoomTools && hitBot ? "block" : "none";

    // Mute/Unmute — admin only, any target
    const muteBtn = document.getElementById("ctxCanvasMute");
    muteBtn.style.display = canModerate && hitTarget ? "block" : "none";
    if (p) muteBtn.textContent = p.muted ? "Unmute" : "Mute";

    // Freeze/Unfreeze — admin only, any target
    const freezeBtn = document.getElementById("ctxCanvasFreeze");
    freezeBtn.style.display = canModerate && hitTarget ? "block" : "none";
    if (p) freezeBtn.textContent = p.frozen ? "Unfreeze" : "Freeze";

    // View Profile — any logged-in player, real players only (not bots)
    const canChannelModerateTarget = hitPlayer && canManageCurrentChannel();
    document.getElementById("ctxCanvasChannelBan").style.display =
        canChannelModerateTarget ? "block" : "none";
    document.getElementById("ctxCanvasChannelKick").style.display =
        canChannelModerateTarget && currentChannel && !currentChannel.isPublic ? "block" : "none";

    document.getElementById("ctxViewProfile").style.display =
        hitPlayer ? "block" : "none";

    const friendState = p ? friendByUsername(p.name) : null;
    const canMessage = hitPlayer && friendState?.status === "accepted";
    const isPendingFriend = hitPlayer && friendState?.status === "pending";
    const canAddFriend = hitPlayer && (!friendState || friendState.status !== "accepted");

    document.getElementById("ctxCanvasMessage").style.display = canMessage ? "block" : "none";
    const addFriendButton = document.getElementById("ctxCanvasAddFriend");
    addFriendButton.style.display = canAddFriend ? "block" : "none";
    addFriendButton.disabled = isPendingFriend;
    addFriendButton.textContent = isPendingFriend ? "Friend Pending" : "Add Friend";

    // Show the "Admin" label and divider only when there are admin options
    // AND there is also a general option (View Profile) below the line.
    const hasAdminOptions = (canModerate && hitTarget)
        || canChannelModerateTarget
        || (canManageRoomTools && (hitBot || !hitTarget));
    const hasBothSections = hasAdminOptions && hitPlayer;
    document.getElementById("ctxAdminLabel").style.display = hasAdminOptions ? "block" : "none";
    document.getElementById("ctxDivider").style.display    = hasBothSections ? "block" : "none";

    // Store context on the menu element for the button handlers below.
    canvasMenu.dataset.targetId = hitTarget || "";
    canvasMenu.dataset.botId    = hitBot    || "";
    canvasMenu.dataset.spawnX   = clickX;
    canvasMenu.dataset.spawnY   = clickY;

    canvasMenu.style.left    = e.clientX + "px";
    canvasMenu.style.top     = e.clientY + "px";
    canvasMenu.style.display = "block";
});

document.getElementById("ctxSpawnBot").addEventListener("click", () => {
    socket.emit("spawnBot", {
        x: Number(canvasMenu.dataset.spawnX),
        y: Number(canvasMenu.dataset.spawnY)
    });
    canvasMenu.style.display = "none";
});

document.getElementById("ctxRemoveBot").addEventListener("click", () => {
    const botId = canvasMenu.dataset.botId;
    if (botId) socket.emit("removeBot", { botId });
    canvasMenu.style.display = "none";
});

document.getElementById("ctxCanvasMute").addEventListener("click", (e) => {
    const targetId = canvasMenu.dataset.targetId;
    if (!targetId) return;
    const action = players[targetId]?.muted ? "unmute" : "mute";
    canvasMenu.style.display = "none";
    if (action === "unmute") {
        socket.emit("adminAction", { targetId, action });
    } else {
        e.stopPropagation();
        showDurationPicker(action, targetId, canvasMenu.style.left, canvasMenu.style.top);
    }
});

document.getElementById("ctxCanvasFreeze").addEventListener("click", (e) => {
    const targetId = canvasMenu.dataset.targetId;
    if (!targetId) return;
    const action = players[targetId]?.frozen ? "unfreeze" : "freeze";
    canvasMenu.style.display = "none";
    if (action === "unfreeze") {
        socket.emit("adminAction", { targetId, action });
    } else {
        e.stopPropagation();
        showDurationPicker(action, targetId, canvasMenu.style.left, canvasMenu.style.top);
    }
});

document.getElementById("ctxCanvasChannelBan").addEventListener("click", (e) => {
    const targetId = canvasMenu.dataset.targetId;
    if (!targetId) return;
    canvasMenu.style.display = "none";
    e.stopPropagation();
    showDurationPicker("channelBan", targetId, canvasMenu.style.left, canvasMenu.style.top, "channelBan");
});

document.getElementById("ctxCanvasChannelKick").addEventListener("click", () => {
    const targetId = canvasMenu.dataset.targetId;
    if (targetId) {
        socket.emit("channelModerationAction", { targetId, action: "kick" });
    }
    canvasMenu.style.display = "none";
});

document.getElementById("ctxViewProfile").addEventListener("click", () => {
    const targetId = canvasMenu.dataset.targetId;
    if (!targetId) return;
    // Request the profile from the server — response comes back via "profileData"
    socket.emit("getProfile", { targetId });
    canvasMenu.style.display = "none";
});

document.getElementById("ctxCanvasAddFriend").addEventListener("click", () => {
    const targetId = canvasMenu.dataset.targetId;
    requestFriendFromPlayer(targetId);
    canvasMenu.style.display = "none";
    openSocialDrawer("friends");
});

document.getElementById("ctxCanvasMessage").addEventListener("click", () => {
    const targetId = canvasMenu.dataset.targetId;
    if (targetId && players[targetId]) {
        openDirectMessageForPlayer(players[targetId]);
    }
    canvasMenu.style.display = "none";
});

// --- Event: "profileData" ---
// Response to a "getProfile" request. Populates and opens the profile modal.
socket.on("profileData", (profile) => {
    // Draw the player icon onto the mini canvas inside the modal.
    const iconCanvas = document.getElementById("profileIcon");
    const iconCtx    = iconCanvas.getContext("2d");
    iconCtx.clearRect(0, 0, iconCanvas.width, iconCanvas.height);
    iconCtx.fillStyle = profile.avatar?.color || (profile.isBot ? "#ffa726" : "#4caf50");
    iconCtx.fillRect(10, 10, 44, 44); // Centered square in the 64x64 canvas

    // Name
    document.getElementById("profileName").textContent = profile.name
        + (profile.isBot ? " (Bot)" : "");

    // Registered date — bots have no account
    const regEl = document.getElementById("profileRegistered");
    if (profile.createdAt) {
        regEl.textContent = "Registered: " + new Date(profile.createdAt).toLocaleDateString(
            undefined, { year: "numeric", month: "long", day: "numeric" }
        );
    } else {
        regEl.textContent = profile.isBot ? "Bot — no account" : "Registration date unavailable";
    }

    // Session time — how long they've been online this visit
    const sessionEl = document.getElementById("profileSession");
    if (profile.joinedAt) {
        const ms      = Date.now() - profile.joinedAt;
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        sessionEl.textContent = `Online this session: ${minutes}m ${seconds}s`;
    } else {
        sessionEl.textContent = "";
    }

    document.getElementById("profileOverlay").style.display = "flex";
});

// Clicking anywhere else closes the canvas menu, duration picker, and avatar panel.
document.addEventListener("click", () => {
    canvasMenu.style.display     = "none";
    durationPicker.style.display = "none";
    document.getElementById("avatarPanel").style.display = "none";
});

// --- WASD Keyboard Input (commented out — may restore later) ---
// let keys = {};
//
// document.addEventListener("keydown", (e) => {
//     const activeTag = document.activeElement.tagName.toLowerCase();
//     if (activeTag === "input") return;
//     keys[e.key.toLowerCase()] = true;
// });
//
// document.addEventListener("keyup", (e) => {
//     keys[e.key.toLowerCase()] = false;
// });

// ============================================================
// Socket.IO Event Handlers
// These listen for messages coming FROM the server.
// ============================================================

// --- Event: "connect" ---
// Fires automatically when our connection to the server is established.
// We just store our socket ID here. The actual "join" is sent later
// by joinGame() once the player has authenticated via the login screen.
socket.on("connect", () => {
    myId = socket.id;

    // If auth.js already called joinGame() before the socket connected
    // (a race condition that can happen with a fast auto-login), the
    // name will already be set — emit join now to catch up.
    if (playerName) {
        socket.emit("join", { name: playerName, x: player.x, y: player.y, token: authToken, roomId: currentRoomId });
    }
});

// ============================================================
// joinGame()
// ============================================================
// Called by auth.js after the player successfully logs in or
// registers. Sets the player's name and tells the server we've
// joined. Exposed on window so auth.js can call it even though
// that file is loaded separately.
// ============================================================
window.joinGame = function(username, token) {
    playerName = username;
    authToken  = token || "";
    hasJoinedGame = false;

    // Decode isAdmin from the JWT payload.
    // The JWT payload is base64-encoded and readable by anyone —
    // the signature is the secret part. We decode it here just to
    // know whether to show the admin context menu. The server
    // independently re-verifies the full token on "join".
    if (authToken) {
        try {
            const payload = JSON.parse(atob(authToken.split(".")[1]));
            isAdmin = payload.isAdmin || false;
            canCreateRooms = isAdmin || !!payload.canCreateRooms;
        } catch (e) {
            isAdmin = false;
            canCreateRooms = false;
        }
    }

    // Only emit if the socket is already connected. If not,
    // the "connect" handler above will catch it when it fires.
    if (myId) {
        socket.emit("join", { name: playerName, x: player.x, y: player.y, token: authToken, roomId: currentRoomId });
    }

    // Re-render the list so the local player's entry gets the "you" label
    // and green highlight as soon as they log in.
    updateChannelControls();
    updateRoomControls();
    updatePlayerList();
};

// --- Event: "joinConfirmed" ---
// Server sends back the verified admin status after the join event is processed.
// This overrides the client-side JWT decode so the two stay in sync.
socket.on("joinConfirmed", (data) => {
    hasJoinedGame = true;
    isAdmin = data.isAdmin || false;
    canCreateRooms = isAdmin || !!data.canCreateRooms;
    if (data.requiresEmail && typeof window.showEmailCapture === "function") {
        window.showEmailCapture("Add a valid email to finish updating your account.");
    } else if (data.requiresEmailVerification && typeof window.showEmailVerificationPrompt === "function") {
        window.showEmailVerificationPrompt("Verify your email or use Resend for a fresh link.");
    } else if (typeof window.hideEmailVerificationPrompt === "function") {
        window.hideEmailVerificationPrompt();
    }
    updateChannelControls();
    updateRoomControls();
});

socket.on("joinDenied", (data = {}) => {
    hasJoinedGame = false;
    updateChannelControls();
    updateRoomControls();
    localStorage.removeItem("or_token");
    localStorage.removeItem("or_username");
    alert(data.message || "Please log in again.");
    location.reload();
});

socket.on("roomModeDefinitions", (definitions = {}) => {
    roomModeDefinitions = definitions && typeof definitions === "object" ? definitions : {};
    renderRoomCustomizePanel();
    renderRoomModePanel();
    if (manageOverlay.classList.contains("open") && manageTab === "room") {
        populateModeSelect(roomSettingsMode, roomSettingsMode.value || currentRoom?.mode || "social");
        renderRoomSettingsFields();
    }
});

socket.on("roomList", (serverRooms) => {
    rooms = Array.isArray(serverRooms) ? serverRooms : [];
    renderChannelList();
    updateRoomControls();
});

socket.on("channelList", (serverChannels) => {
    channels = Array.isArray(serverChannels) ? serverChannels : [];
    renderChannelList();
    if (manageOverlay.classList.contains("open") && settingsChannelId) {
        fillChannelSettings(findChannel(settingsChannelId));
    }
});

socket.on("channelChanged", ({ channel } = {}) => {
    if (!channel) return;
    forceChannelHomeOpen = false;
    currentChannel = channel;
    currentChannelId = channel.id;
    selectedHomeChannelId = channel.id;
    expandedChannelIds.add(channel.id);
    setCurrentChannelUi(channel);
    setChannelError("");
    if (channelBrowserPendingAction && channelBrowserOverlay.classList.contains("open")) {
        if (channelBrowserPendingAction === "create") {
            channelCreateInput.value = "";
            channelPrivateToggle.checked = false;
        }
        if (channelBrowserPendingAction === "joinCode") {
            channelCodeInput.value = "";
        }
        closeChannelBrowser();
    }
    channelBanPanel.style.display = "none";
    channelBanPanel.replaceChildren();
    if (channel.roomCount === 0) {
        currentRoom = null;
        currentRoomId = "";
        currentRoomName = "No room";
        currentRoomNameEl.textContent = currentRoomName;
        chatMessages.replaceChildren();
        moveTarget = null;
        setChatInputEnabled(false, "Create a room to chat...");
        setRoomError(channel.canManageRooms ? "Owners can create a room to start chatting here." : "This channel has no rooms yet.");
    }
    if (settingsChannelId === channel.id) {
        fillChannelSettings(channel);
    }
    renderChannelList();
    updateRoomControls();
});

socket.on("roomChanged", ({ room } = {}) => {
    if (!room) return;
    forceChannelHomeOpen = false;
    currentRoom = room;
    if (room.channelId) currentChannelId = room.channelId;
    if (room.channelId) selectedHomeChannelId = room.channelId;
    currentRoomId = room.id;
    currentRoomName = room.name;
    currentRoomNameEl.textContent = currentRoomName;
    chatMessages.replaceChildren();
    moveTarget = null;
    if (playerName) {
        setChatInputEnabled(true, "Type a message...");
    }
    setRoomError("");
    expandedChannelIds.add(currentChannelId);
    if (roomSettingsRoomId === room.id && roomSettingsAction === "edit") {
        openRoomSettings(room, { channelId: room.channelId || currentChannelId });
    }
    renderChannelList();
    updateRoomControls();
});

socket.on("channelError", (data = {}) => {
    channelBrowserPendingAction = "";
    setChannelError(data.message || "Channel action failed.", data.ok !== true);
    if (manageOverlay.classList.contains("open") && manageTab === "channel") {
        setManageStatus(data.message || "Channel action failed.", data.ok !== true);
    }
});

socket.on("channelDeleted", (data = {}) => {
    if (data.channelId) {
        expandedChannelIds.delete(data.channelId);
        if (selectedHomeChannelId === data.channelId) {
            selectedHomeChannelId = currentChannelId || "openrealm";
        }
    }
    expandedRoomInfoId = null;
    if (settingsChannelId === data.channelId) {
        closeManageOverlay();
    }
    setChannelError(data.message || "Channel deleted.", false);
});

socket.on("channelModerationNotice", (data = {}) => {
    setChannelError(data.message || "Channel membership changed.", false);
});

socket.on("channelBanList", ({ channelId, bans } = {}) => {
    renderChannelBanList(channelId, Array.isArray(bans) ? bans : []);
    renderSettingsBanList(channelId, Array.isArray(bans) ? bans : []);
    if (manageOverlay.classList.contains("open") && settingsChannelId === channelId) {
        setManageStatus("");
    }
});

socket.on("roomError", (data = {}) => {
    setRoomError(data.message || "Room action failed.", data.ok !== true);
    if (manageOverlay.classList.contains("open") && manageTab === "room") {
        setManageStatus(data.message || "Room action failed.", data.ok !== true);
    }
});

socket.on("roomClosed", (data = {}) => {
    if (roomSettingsRoomId === currentRoomId) {
        closeManageOverlay();
    }
    setRoomError(data.message || "Room closed.", false);
});

socket.on("roomRuntime", ({ roomId, mode, modeConfig } = {}) => {
    if (!currentRoom || roomId !== currentRoom.id) return;
    currentRoom = {
        ...currentRoom,
        mode: mode || currentRoom.mode,
        modeConfig: modeConfig || currentRoom.modeConfig || {}
    };
    renderRoomCustomizePanel();
    renderRoomModePanel();
});

socket.on("friendList", (serverFriends) => {
    friends = Array.isArray(serverFriends) ? serverFriends : [];
    renderSocialDrawer();
});

socket.on("friendNotice", (data = {}) => {
    setSocialNotice(data.message || "");
    renderSocialDrawer();
});

socket.on("friendError", (data = {}) => {
    setSocialNotice(data.message || "Friend action failed.", true);
    renderSocialDrawer();
});

socket.on("directHistory", ({ friendUserId, messages } = {}) => {
    if (!friendUserId) return;
    directMessageThreads[friendUserId] = Array.isArray(messages) ? messages : [];
    unreadDirectMessages[friendUserId] = 0;
    renderSocialDrawer();
});

socket.on("directMessage", ({ friendUserId, message } = {}) => {
    if (!friendUserId || !message) return;
    directMessageThreads[friendUserId] ||= [];
    if (!directMessageThreads[friendUserId].some(item => item.id === message.id)) {
        directMessageThreads[friendUserId].push(message);
    }
    if (activeDmFriendId !== friendUserId || !socialDrawer.classList.contains("open") || socialTab !== "messages") {
        unreadDirectMessages[friendUserId] = (unreadDirectMessages[friendUserId] || 0) + 1;
    }
    renderSocialDrawer();
});

socket.on("directError", (data = {}) => {
    setSocialNotice(data.message || "Private message failed.", true);
    renderSocialDrawer();
});

// --- Event: "currentPlayers" ---
// Sent by the server to the newly joined player only.
// Contains a snapshot of every player currently in the game,
// so we can populate our local players dictionary from the start.
socket.on("currentPlayers", (serverPlayers) => {
    // Clear our local dictionary first to avoid stale entries.
    Object.keys(players).forEach((id) => delete players[id]);

    // Copy all players from the server snapshot into our local dictionary.
    Object.assign(players, serverPlayers);

    // Sync the avatar color button to whatever color was loaded from the DB.
    if (myId && players[myId]?.avatar?.color) {
        syncAvatarButton(players[myId].avatar.color);
    }
    if (myId && players[myId]) {
        player.x = players[myId].x;
        player.y = players[myId].y;
        lastEmittedX = player.x;
        lastEmittedY = player.y;
    }

    updatePlayerList();
});

// --- Event: "newPlayer" ---
// Sent to all existing players when someone new joins.
// We add them to our local dictionary so they appear on screen.
socket.on("newPlayer", (playerData) => {
    players[playerData.id] = {
        ...playerData,
        chatBubble:    "",
        chatTimestamp: 0,
        isBot:         playerData.isBot || false
    };
    updatePlayerList();
});

// --- Event: "playerMoved" ---
// Sent by the server when another player moves.
// We update their position in our local dictionary.
// Note: the server uses broadcast.emit for this, so we never
// receive our own movement back — we handle that locally instead.
socket.on("playerMoved", (playerData) => {
    if (players[playerData.id]) {
        players[playerData.id].x = playerData.x;
        players[playerData.id].y = playerData.y;
    }
});

// --- Event: "playerDisconnected" ---
// Sent when a player leaves the game.
// We remove them from our dictionary so they disappear from the canvas.
socket.on("playerDisconnected", (id) => {
    delete players[id];
    updatePlayerList();
});

// --- Event: "playerAvatarUpdate" ---
// Sent by the server when any player changes their avatar color.
// We update the local players dictionary so the new color renders immediately.
socket.on("playerAvatarUpdate", ({ id, avatar }) => {
    if (players[id]) players[id].avatar = avatar;
    // If it's our own update, keep the button preview in sync too.
    if (id === myId) syncAvatarButton(avatar.color);
});

// --- Event: "spectatorCount" ---
// Sent by the server whenever the number of connected but unauthenticated
// visitors changes. We update the spectator counter in the player list header.
socket.on("spectatorCount", (count) => {
    const el = document.getElementById("spectatorCount");
    if (el) el.textContent = count;
});

// --- Event: "playerStatusUpdate" ---
// Sent by the server when an admin mutes or freezes a player.
// We update the affected player's flags and re-render the list
// so the badges appear (or disappear) immediately for everyone.
socket.on("playerStatusUpdate", ({ id, muted, frozen }) => {
    if (players[id]) {
        players[id].muted  = muted;
        players[id].frozen = frozen;
        updatePlayerList();
    }
});

// --- Event: "forcedDisconnect" ---
// Sent by the server when the same account logs in from another window.
// We alert the player and reload the page, putting them back into
// spectator mode so the new session can take over cleanly.
socket.on("forcedDisconnect", (reason) => {
    localStorage.removeItem("or_token");
    localStorage.removeItem("or_username");
    alert(reason);
    location.reload();
});

// --- Event: "chatMessage" ---
// Sent to all clients when any player (or the system) sends a message.
// We add it to the chat log and update the sender's chat bubble.
socket.on("chatMessage", (data) => {
    // Append the message to the scrollable chat panel.
    addChatMessage(data.name, data.message);

    // Update the chat bubble above that player's head (if they're in our dictionary).
    // System messages don't have an id, so players[undefined] will just be falsy.
    if (players[data.id]) {
        players[data.id].chatBubble = data.message;
        players[data.id].chatTimestamp = data.timestamp;
    }
});

// ============================================================
// Chat UI Functions
// ============================================================

// ============================================================
// Player List Sort State
// ============================================================
// Tracks the active sort field ("join" or "name") and direction
// ("asc" or "desc"). Clicking a sort button updates these and
// re-renders the list. Clicking the already-active button toggles
// the direction.
// ============================================================
let sortField = "join";
let sortDir   = "asc";

// Wire up sort buttons once the DOM is ready.
document.querySelectorAll(".sortBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const field = btn.dataset.sort;

        if (sortField === field) {
            // Same field clicked — toggle direction.
            // asc → desc → asc ...
            sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
            // New field — switch to it, default to ascending.
            sortField = field;
            sortDir   = "asc";
        }

        // Sync the arrow label and active highlight across all buttons.
        document.querySelectorAll(".sortBtn").forEach((b) => {
            const isActive = b.dataset.sort === sortField;
            b.classList.toggle("active", isActive);
            if (isActive) {
                // Update the arrow to reflect current direction.
                const label = field === "join" ? "Join" : "Name";
                b.textContent = label + (sortDir === "asc" ? " ↑" : " ↓");
            }
        });

        updatePlayerList();
    });
});

// Rebuilds the player list panel from the current players dictionary.
// Called whenever someone joins, leaves, or the sort option changes.
function updatePlayerList() {
    const listEl = document.getElementById("playerList");
    const countEl = document.getElementById("playerCount");

    // Remove all existing entries but keep the header row.
    listEl.querySelectorAll(".playerEntry").forEach((el) => el.remove());

    // Convert the players dictionary into an array of [id, playerObj] pairs
    // so we can sort them before rendering.
    // Using Object.entries() gives us both the key (socket ID) and the value
    // (player data) together, which is more convenient than sorting just IDs.
    const entries = Object.entries(players);

    // --- Sorting ---
    // Array.sort() takes a comparator function that returns:
    //   negative  → a comes first
    //   positive  → b comes first
    //   zero      → order unchanged
    //
    // For ascending order we do (a - b) for numbers or a.localeCompare(b) for strings.
    // For descending we flip the operands: (b - a) or b.localeCompare(a).
    entries.sort(([, a], [, b]) => {
        if (sortField === "name") {
            // localeCompare does a proper alphabetical comparison that handles
            // accented characters and is case-insensitive when used with the
            // sensitivity option — better than a simple < / > comparison.
            const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
            return sortDir === "asc" ? cmp : -cmp;
        } else {
            // Sort by join time (Unix timestamp, numeric comparison).
            const cmp = (a.joinedAt || 0) - (b.joinedAt || 0);
            return sortDir === "asc" ? cmp : -cmp;
        }
    });

    const ids = Object.keys(players);
    countEl.textContent = ids.length;

    entries.forEach(([id, p]) => {

        const entry = document.createElement("div");
        entry.className = "playerEntry" + (id === myId ? " me" : "");
        // Store the socket ID so the right-click handler knows who was clicked.
        entry.dataset.playerId = id;

        // Green dot to indicate the player is online.
        const dot = document.createElement("span");
        dot.className = "dot";

        // Player name — "(you)" appended for the local player.
        const nameSpan = document.createElement("span");
        nameSpan.textContent = p.name + (id === myId ? " (you)" : "");

        entry.appendChild(dot);
        entry.appendChild(nameSpan);

        // Status badges — shown when an admin has muted or frozen the player.
        if (p.muted) {
            const badge = document.createElement("span");
            badge.className = "statusBadge muted";
            badge.textContent = "muted";
            entry.appendChild(badge);
        }
        if (p.frozen) {
            const badge = document.createElement("span");
            badge.className = "statusBadge frozen";
            badge.textContent = "frozen";
            entry.appendChild(badge);
        }

        listEl.appendChild(entry);
    });
}

// ============================================================
// Admin Context Menu
// ============================================================
// Right-clicking a player entry in the list opens a small menu
// with Mute/Unmute and Freeze/Unfreeze options.
// Only visible when the local player is an admin.
// ============================================================

let contextTargetId = null;
const contextMenu = document.getElementById("contextMenu");

// Delegate right-click handling to the player list container.
// This means we only need one listener regardless of how many entries exist.
document.getElementById("playerList").addEventListener("contextmenu", (e) => {
    // Any logged-in player can right-click. Admin options are hidden below for non-admins.
    if (!playerName) return;

    const entry = e.target.closest(".playerEntry");
    if (!entry) return;

    e.preventDefault();

    const targetId = entry.dataset.playerId;
    if (!targetId || targetId === myId) return;

    contextTargetId = targetId;
    const p = players[targetId];
    if (!p) return;

    // Header — player name
    document.getElementById("contextPlayerName").textContent = p.name;

    // Admin section — only visible to admins, hidden for bots on View Profile
    const isRealPlayer = !p.isBot;
    const canModerate = canModerateCurrentChannel();
    const canChannelModerateTarget = isRealPlayer && canManageCurrentChannel();
    const friendState = isRealPlayer ? friendByUsername(p.name) : null;
    const canMessage = isRealPlayer && friendState?.status === "accepted";
    const isPendingFriend = isRealPlayer && friendState?.status === "pending";
    const canAddFriend = isRealPlayer && (!friendState || friendState.status !== "accepted");

    document.getElementById("ctxListMessage").style.display = canMessage ? "block" : "none";
    const addFriendButton = document.getElementById("ctxListAddFriend");
    addFriendButton.style.display = canAddFriend ? "block" : "none";
    addFriendButton.disabled = isPendingFriend;
    addFriendButton.textContent = isPendingFriend ? "Friend Pending" : "Add Friend";
    document.getElementById("ctxListSocialDivider").style.display =
        (canMessage || canAddFriend) && (canModerate || canChannelModerateTarget) ? "block" : "none";
    document.getElementById("ctxListAdminLabel").style.display =
        (canModerate || canChannelModerateTarget) ? "block" : "none";
    document.getElementById("ctxMute").style.display           = canModerate ? "block" : "none";
    document.getElementById("ctxFreeze").style.display         = canModerate ? "block" : "none";
    document.getElementById("ctxListChannelBan").style.display =
        canChannelModerateTarget ? "block" : "none";
    document.getElementById("ctxListChannelKick").style.display =
        canChannelModerateTarget && currentChannel && !currentChannel.isPublic ? "block" : "none";
    if (canModerate) {
        document.getElementById("ctxMute").textContent   = p.muted  ? "Unmute"   : "Mute";
        document.getElementById("ctxFreeze").textContent = p.frozen ? "Unfreeze" : "Freeze";
    }

    // Divider and View Profile — shown for real players only
    document.getElementById("ctxListDivider").style.display =
        (canModerate || canChannelModerateTarget) && isRealPlayer ? "block" : "none";
    document.getElementById("ctxListViewProfile").style.display = isRealPlayer ? "block" : "none";

    contextMenu.style.left    = e.clientX + "px";
    contextMenu.style.top     = e.clientY + "px";
    contextMenu.style.display = "block";
});

// Mute / Unmute button
document.getElementById("ctxMute").addEventListener("click", (e) => {
    if (!contextTargetId) return;
    const action = players[contextTargetId]?.muted ? "unmute" : "mute";
    contextMenu.style.display = "none";
    if (action === "unmute") {
        socket.emit("adminAction", { targetId: contextTargetId, action });
    } else {
        e.stopPropagation();
        showDurationPicker(action, contextTargetId, contextMenu.style.left, contextMenu.style.top);
    }
});

// Freeze / Unfreeze button
document.getElementById("ctxFreeze").addEventListener("click", (e) => {
    if (!contextTargetId) return;
    const action = players[contextTargetId]?.frozen ? "unfreeze" : "freeze";
    contextMenu.style.display = "none";
    if (action === "unfreeze") {
        socket.emit("adminAction", { targetId: contextTargetId, action });
    } else {
        e.stopPropagation();
        showDurationPicker(action, contextTargetId, contextMenu.style.left, contextMenu.style.top);
    }
});

document.getElementById("ctxListChannelBan").addEventListener("click", (e) => {
    if (!contextTargetId) return;
    contextMenu.style.display = "none";
    e.stopPropagation();
    showDurationPicker("channelBan", contextTargetId, contextMenu.style.left, contextMenu.style.top, "channelBan");
});

document.getElementById("ctxListChannelKick").addEventListener("click", () => {
    if (contextTargetId) {
        socket.emit("channelModerationAction", { targetId: contextTargetId, action: "kick" });
    }
    contextMenu.style.display = "none";
});

// View Profile button (player list)
document.getElementById("ctxListViewProfile").addEventListener("click", () => {
    if (!contextTargetId) return;
    socket.emit("getProfile", { targetId: contextTargetId });
    contextMenu.style.display = "none";
});

document.getElementById("ctxListAddFriend").addEventListener("click", () => {
    if (!contextTargetId) return;
    requestFriendFromPlayer(contextTargetId);
    contextMenu.style.display = "none";
    openSocialDrawer("friends");
});

document.getElementById("ctxListMessage").addEventListener("click", () => {
    if (contextTargetId && players[contextTargetId]) {
        openDirectMessageForPlayer(players[contextTargetId]);
    }
    contextMenu.style.display = "none";
});

// Clicking anywhere else closes the player list menu, duration picker, and avatar panel.
document.addEventListener("click", () => {
    contextMenu.style.display    = "none";
    durationPicker.style.display = "none";
    document.getElementById("avatarPanel").style.display = "none";
});

// Creates a new div for a message and appends it to the chat panel.
// Builds DOM nodes manually (never innerHTML) to prevent XSS.
// @mentions are wrapped in <span class="mentionTag">; if the local
// player is mentioned, the whole row gets the .chatMention class.
function addChatMessage(name, message) {
    const messageDiv = document.createElement("div");
    messageDiv.className = "chatMessage";

    // Prepend "Name: " as plain text.
    messageDiv.appendChild(document.createTextNode(`${name}: `));

    // Split message on @tokens, alternating plain text and mention spans.
    const parts = message.split(/(@\S+)/g);
    let isMentioned = false;
    parts.forEach(part => {
        if (/^@\S+$/.test(part)) {
            const token = part.slice(1).toLowerCase();
            if (playerName && token === playerName.toLowerCase()) isMentioned = true;
            const span = document.createElement("span");
            span.className = "mentionTag";
            span.textContent = part;
            messageDiv.appendChild(span);
        } else {
            messageDiv.appendChild(document.createTextNode(part));
        }
    });

    if (isMentioned) messageDiv.classList.add("chatMention");

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Reads the chat input, sends the message to the server, and clears the field.
function sendChatMessage() {
    // Spectators can watch chat but not send messages.
    if (!playerName) return;

    const message = chatInput.value.trim();

    // Don't send empty messages.
    if (message === "") return;

    // We only send the message text — the server looks up our name
    // from its own player record, so clients can't fake their identity.
    socket.emit("chatMessage", {
        message: message
    });

    chatInput.value = "";
}

// Allow sending by clicking the button...
sendButton.addEventListener("click", sendChatMessage);

// --- Profile Modal ---
const profileOverlay = document.getElementById("profileOverlay");

document.getElementById("profileClose").addEventListener("click", () => {
    profileOverlay.style.display = "none";
});

profileOverlay.addEventListener("click", (e) => {
    if (e.target === profileOverlay) profileOverlay.style.display = "none";
});

// --- Help Modal ---
const helpOverlay = document.getElementById("helpOverlay");

document.getElementById("helpButton").addEventListener("click", () => {
    helpOverlay.style.display = "flex";
});

document.getElementById("helpClose").addEventListener("click", () => {
    helpOverlay.style.display = "none";
});

// Clicking the dark backdrop behind the card also closes it.
helpOverlay.addEventListener("click", (e) => {
    if (e.target === helpOverlay) helpOverlay.style.display = "none";
});

// ...or by pressing Enter while focused on the chat input.
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        sendChatMessage();
    }
});

// ============================================================
// Game Logic
// ============================================================

// updatePlayer runs every frame and handles movement input.
function updatePlayer() {
    // Spectators haven't logged in yet — don't move anything.
    if (!playerName) return;

    // Frozen players cannot move — the server will also reject any
    // playerMove events they send, but we skip client-side movement
    // too so the player gets instant feedback.
    if (players[myId] && players[myId].frozen) {
        moveTarget = null;
        return;
    }

    // --- Point-and-Click Movement ---
    // If there's an active target, move the player toward it each frame.
    if (moveTarget) {
        const dx = moveTarget.x - player.x; // Horizontal distance to target
        const dy = moveTarget.y - player.y; // Vertical distance to target

        // Math.hypot() gives us the straight-line distance between the
        // player and the target using the Pythagorean theorem (a²+b²=c²).
        const distance = Math.hypot(dx, dy);

        if (distance <= player.speed) {
            // Close enough — snap to the target and stop moving.
            // Without this snap, the player would jitter back and forth
            // around the target because it keeps overshooting by tiny amounts.
            player.x = moveTarget.x;
            player.y = moveTarget.y;
            moveTarget = null;
        } else {
            // Normalize the direction vector (dx/distance, dy/distance) to get
            // a unit vector — a vector of length 1 pointing toward the target.
            // Multiplying by player.speed then gives a step of exactly that length,
            // so the player always moves at a consistent speed regardless of angle.
            player.x += (dx / distance) * player.speed;
            player.y += (dy / distance) * player.speed;
        }
    }

    // --- WASD Movement (commented out — may restore later) ---
    // if (keys["w"]) player.y -= player.speed;
    // if (keys["s"]) player.y += player.speed;
    // if (keys["a"]) player.x -= player.speed;
    // if (keys["d"]) player.x += player.speed;

    // Clamp the player's position so they can't move off the canvas edges.
    // player.size is subtracted from the right/bottom edges so the whole
    // square stays visible, not just the top-left corner.
    if (player.x < 0) player.x = 0;
    if (player.y < 0) player.y = 0;
    if (player.x > canvas.width - player.size) player.x = canvas.width - player.size;
    if (player.y > canvas.height - player.size) player.y = canvas.height - player.size;

    // Only send an update to the server if we actually moved.
    // Without this check, we'd emit hundreds of identical messages per
    // second even while standing still, wasting bandwidth.
    if (player.x !== lastEmittedX || player.y !== lastEmittedY) {
        socket.emit("playerMove", {
            x: player.x,
            y: player.y
        });

        // Record the position we just sent so we can compare next frame.
        lastEmittedX = player.x;
        lastEmittedY = player.y;

        // Update our entry in the shared players dictionary directly.
        // The server uses broadcast.emit for moves, meaning it doesn't
        // echo our own move back to us. So we update players[myId] here
        // ourselves to keep the drawn position in sync.
        if (myId && players[myId]) {
            players[myId].x = player.x;
            players[myId].y = player.y;
        }
    }
}

// ============================================================
// Drawing Functions
// ============================================================

// ============================================================
// Chat Text Effects (RuneScape-style)
// ============================================================
// Players can prefix their message with an effect name followed
// by a colon to trigger a visual effect on their chat bubble.
//
// Supported prefixes (case-insensitive):
//   wave:    — characters bob up and down in a sine wave
//   wave2:   — wave with alternating red/yellow colouring
//   shake:   — each character jitters randomly every frame
//   scroll:  — text slides back and forth horizontally
//   glow1:   — red → yellow colour gradient cycling across characters
//   glow2:   — blue → cyan colour gradient cycling
//   glow3:   — green → white colour gradient cycling
//   flash1:  — whole text flashes between red and yellow
//   flash2:  — whole text flashes between blue and cyan
//   flash3:  — whole text flashes between green and white
//
// Example: typing "wave:Hello!" displays "Hello!" with a wave effect.
// ============================================================

// Ordered longest-first so "wave2" is matched before "wave".
const EFFECT_PREFIXES = [
    "wave2", "wave", "shake", "scroll",
    "glow1", "glow2", "glow3",
    "flash1", "flash2", "flash3"
];

// Named colours available as chat prefixes.
// Values are valid CSS colour strings passed directly to fillStyle.
const COLOUR_MAP = {
    red:     "#cc0000",
    green:   "#008800",
    blue:    "#0000cc",
    yellow:  "#cccc00",
    cyan:    "#00aaaa",
    purple:  "#880088",
    white:   "#ffffff",
    orange:  "#cc6600",
    pink:    "#cc0066",
    lime:    "#00cc00"
};

// Parses an optional colour prefix then an optional effect prefix from a message.
// Supports any combination in the order: [colour:][effect:]text
//
// Examples:
//   "red:wave:Hello!"  → { colour: "#cc0000", effect: "wave",  text: "Hello!" }
//   "blue:Hello!"      → { colour: "#0000cc", effect: null,    text: "Hello!" }
//   "wave:Hello!"      → { colour: null,      effect: "wave",  text: "Hello!" }
//   "Hello!"           → { colour: null,      effect: null,    text: "Hello!" }
function parseEffect(message) {
    let colour = null;
    let effect = null;
    let remaining = message;

    // Check for a colour prefix first.
    const lowerRemaining = remaining.toLowerCase();
    for (const name of Object.keys(COLOUR_MAP)) {
        if (lowerRemaining.startsWith(name + ":")) {
            colour    = COLOUR_MAP[name];
            remaining = remaining.slice(name.length + 1);
            break;
        }
    }

    // Then check for an effect prefix in what's left.
    const lowerEffect = remaining.toLowerCase();
    for (const fx of EFFECT_PREFIXES) {
        if (lowerEffect.startsWith(fx + ":")) {
            effect    = fx;
            remaining = remaining.slice(fx.length + 1);
            break;
        }
    }

    return { colour, effect, text: remaining };
}

// Renders text character-by-character with the given effect and colour applied.
// colour overrides the default black — effects that cycle colour internally
// will ignore it (glow/flash), but positional effects (wave/shake/scroll) use it.
// centerX/baseY are the centre-bottom anchor.
function drawEffectText(ctx, text, centerX, baseY, effect, colour) {
    // t is a continuously increasing time value (seconds) used to animate effects.
    const t = Date.now() / 1000;

    ctx.font      = "12px Arial";
    ctx.textAlign = "left"; // We'll position each character manually

    // Measure total width so we can start at the correct X to keep
    // the text centred inside the bubble.
    const totalWidth = ctx.measureText(text).width;
    let x = centerX - totalWidth / 2;

    for (let i = 0; i < text.length; i++) {
        const ch       = text[i];
        const charWidth = ctx.measureText(ch).width;
        let dx = 0, dy = 0;

        switch (effect) {
            // ---- Positional effects ----

            // Positional effects — colour prefix applies; falls back to black.
            case "wave":
                dy = Math.sin(t * 4 + i * 0.6) * 3;
                ctx.fillStyle = colour || "black";
                break;

            case "wave2":
                // wave2 has its own built-in alternating colours; colour prefix ignored.
                dy = Math.sin(t * 4 + i * 0.8) * 4;
                ctx.fillStyle = i % 2 === 0 ? "#cc0000" : "#ffcc00";
                break;

            case "shake":
                dx = (Math.random() - 0.5) * 4;
                dy = (Math.random() - 0.5) * 4;
                ctx.fillStyle = colour || "black";
                break;

            case "scroll": {
                const slideRange = Math.min(totalWidth * 0.4, 20);
                dx = Math.sin(t * 1.5) * slideRange;
                ctx.fillStyle = colour || "#006600";
                break;
            }

            // Colour-cycling effects — colour prefix ignored (they manage their own hues).
            case "glow1":
                ctx.fillStyle = `hsl(${(t * 40 + i * 15) % 60}, 100%, 40%)`;
                break;

            case "glow2":
                ctx.fillStyle = `hsl(${180 + (t * 40 + i * 15) % 60}, 100%, 45%)`;
                break;

            case "glow3":
                ctx.fillStyle = `hsl(${90 + (t * 40 + i * 15) % 60}, 100%, 38%)`;
                break;

            case "flash1":
                ctx.fillStyle = Math.sin(t * 6) > 0 ? "#dd0000" : "#ffcc00";
                break;

            case "flash2":
                ctx.fillStyle = Math.sin(t * 6) > 0 ? "#0000cc" : "#00cccc";
                break;

            case "flash3":
                ctx.fillStyle = Math.sin(t * 6) > 0 ? "#008800" : "#ffffff";
                break;

            default:
                // No effect — just apply the colour if one was set.
                ctx.fillStyle = colour || "black";
        }

        ctx.fillText(ch, x + dx, baseY + dy);
        x += charWidth; // Advance to the next character position
    }

    // Reset state so subsequent drawing calls aren't affected.
    ctx.textAlign = "center";
    ctx.fillStyle = "black";
}

// Draws a rectangle with rounded corners using canvas arc/curve commands.
// Parameters: ctx = drawing context, x/y = top-left corner, w/h = size, r = corner radius
function drawRoundedRect(ctx, x, y, w, h, r) {
    // beginPath() starts a new shape — without this, new lines would
    // connect to whatever was drawn previously.
    ctx.beginPath();

    // We trace the outline of the rounded rectangle by:
    // 1. Drawing straight lines along each edge (stopping before the corners)
    // 2. Using quadraticCurveTo() to draw each rounded corner
    ctx.moveTo(x + r, y);                              // Start just inside top-left corner
    ctx.lineTo(x + w - r, y);                          // Top edge
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);     // Top-right corner
    ctx.lineTo(x + w, y + h - r);                      // Right edge
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); // Bottom-right corner
    ctx.lineTo(x + r, y + h);                          // Bottom edge
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);     // Bottom-left corner
    ctx.lineTo(x, y + r);                              // Left edge
    ctx.quadraticCurveTo(x, y, x + r, y);             // Top-left corner
    ctx.closePath();                                   // Connect back to the start
}

// draw() renders every player onto the canvas each frame.
function draw() {
    // Wipe the entire canvas before redrawing — without this, movement
    // would leave a trail of squares across the screen.
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw local click ripples (purely cosmetic, never synced to server).
    const now = performance.now();
    for (let i = clickRipples.length - 1; i >= 0; i--) {
        const r = clickRipples[i];
        const t = (now - r.startTime) / RIPPLE_DURATION; // 0 → 1
        if (t >= 1) { clickRipples.splice(i, 1); continue; }
        const radius = t * RIPPLE_MAX_RADIUS;
        const alpha  = 1 - t;
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Loop over every player in our dictionary and draw them.
    for (let id in players) {
        let p = players[id];

        // Fall back to 20 if the player object doesn't have a size property
        // (e.g. players received from the server before size was added).
        const size = p.size || 20;

        // Draw the player square in their chosen avatar color.
        // Bots are always orange; real players use their saved color (default green).
        ctx.fillStyle = p.isBot ? "#ffa726" : (p.avatar?.color || "#4caf50");
        ctx.fillRect(p.x, p.y, size, size);

        // Frozen players get a blue outline drawn inside the square.
        if (p.frozen) {
            ctx.strokeStyle = "#64b5f6";
            ctx.lineWidth   = 2;
            ctx.strokeRect(p.x + 1, p.y + 1, size - 2, size - 2);
        }

        // The local player gets a white outline drawn outside the square
        // so they can always find themselves on screen regardless of color.
        if (id === myId) {
            ctx.strokeStyle = "white";
            ctx.lineWidth   = 2;
            ctx.strokeRect(p.x - 1, p.y - 1, size + 2, size + 2);
        }

        // --- Draw Player Name ---
        ctx.fillStyle = "white";
        ctx.font = "14px Arial";
        ctx.textAlign = "center"; // Coordinates passed to fillText will be the text's center

        // Default: name sits just above the player square.
        let nameY = p.y - 5;

        // If the player is near the top edge, flip the name below the square
        // so it doesn't get clipped by the canvas boundary.
        if (p.y < 20) {
            nameY = p.y + 30;
        }

        // Build the display name with status suffixes appended.
        // e.g. "PlayerName", "PlayerName - Muted", "PlayerName - Frozen", "PlayerName - Muted - Frozen"
        let displayName = p.name;
        if (p.muted)  displayName += " - Muted";
        if (p.frozen) displayName += " - Frozen";

        // Measure the full display name for edge clamping.
        const nameWidth = ctx.measureText(displayName).width;

        const nameX = Math.max(
            nameWidth / 2 + 5,
            Math.min(canvas.width - nameWidth / 2 - 5, p.x + size / 2)
        );

        // Draw each part of the name in the appropriate colour.
        // We split into segments so "PlayerName" stays white while
        // the status suffixes are coloured orange/blue.
        if (!p.muted && !p.frozen) {
            ctx.fillStyle = "white";
            ctx.fillText(displayName, nameX, nameY);
        } else {
            // Measure just the base name to find the split point.
            const baseWidth  = ctx.measureText(p.name).width;
            const totalWidth = ctx.measureText(displayName).width;
            const startX     = nameX - totalWidth / 2; // left edge of the full string

            ctx.fillStyle = "white";
            ctx.textAlign = "left";
            ctx.fillText(p.name, startX, nameY);

            let offsetX = startX + baseWidth;
            if (p.muted) {
                ctx.fillStyle = "#ffa726"; // Orange
                const seg = p.frozen ? " - Muted" : " - Muted";
                ctx.fillText(seg, offsetX, nameY);
                offsetX += ctx.measureText(seg).width;
            }
            if (p.frozen) {
                ctx.fillStyle = "#64b5f6"; // Blue
                ctx.fillText(" - Frozen", offsetX, nameY);
            }

            ctx.textAlign = "center"; // Restore for the rest of the draw loop
        }

        // --- Draw Chat Bubble ---
        // How long (in milliseconds) the bubble stays visible after a message.
        const bubbleDuration = 3000;

        // Only draw the bubble if there's a message AND it hasn't expired yet.
        if (p.chatBubble && Date.now() - p.chatTimestamp < bubbleDuration) {

            // Strip any colour/effect prefixes from the raw message.
            // e.g. "red:wave:Hello!" → { colour: "#cc0000", effect: "wave", text: "Hello!" }
            const { colour, effect, text: bubbleText } = parseEffect(p.chatBubble);

            ctx.font = "12px Arial";
            ctx.textAlign = "center";

            // Measure the display text (without the prefix) to size the bubble.
            const textWidth = ctx.measureText(bubbleText).width;
            const bubbleWidth = textWidth + 20;  // 10px padding on each side
            const bubbleHeight = 24;

            // Default: bubble appears 50px above the player's top edge.
            // Center it horizontally over the player.
            let bubbleX = p.x + size / 2 - bubbleWidth / 2;
            let bubbleY = p.y - 50;

            // Clamp the bubble horizontally so it doesn't go off the canvas sides.
            if (bubbleX < 5) bubbleX = 5;
            if (bubbleX + bubbleWidth > canvas.width - 5)
                bubbleX = canvas.width - bubbleWidth - 5;

            // If the bubble would go above the canvas top, move it below the player instead.
            if (bubbleY < 0) {
                bubbleY = p.y + 35;
            }

            // Draw the rounded white bubble background.
            ctx.fillStyle = "white";
            drawRoundedRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 6);
            ctx.fill();    // Fill with the current fillStyle (white)

            // Draw a thin black border around the bubble.
            ctx.strokeStyle = "black";
            ctx.lineWidth = 2;
            ctx.stroke();  // Stroke uses the path we already defined with drawRoundedRect

            // Draw the message text centered inside the bubble.
            // If an effect prefix was found, drawEffectText handles per-character
            // animation. Otherwise it falls back to plain black text.
            if (effect || colour) {
                // drawEffectText handles both animated effects and plain colour.
                // Passing effect=null with a colour just applies the solid colour.
                drawEffectText(ctx, bubbleText, bubbleX + bubbleWidth / 2, bubbleY + 16, effect, colour);
            } else {
                ctx.fillStyle = "black";
                ctx.fillText(bubbleText, bubbleX + bubbleWidth / 2, bubbleY + 16);
            }

            // --- Draw the Tail ---
            // The tail is a small triangle that points from the bubble toward the player,
            // making it clear which player the bubble belongs to.
            let tailX = p.x + size / 2; // Horizontally centered on the player
            let tailY, tailTipY;

            if (bubbleY < p.y) {
                // Bubble is ABOVE the player — tail hangs down from the bubble's bottom.
                tailY = bubbleY + bubbleHeight; // Base of the triangle sits at bubble bottom
                tailTipY = tailY + 8;           // Tip points downward toward the player
            } else {
                // Bubble is BELOW the player — tail rises up from the bubble's top.
                tailY = bubbleY;                // Base sits at bubble top
                tailTipY = tailY - 8;           // Tip points upward toward the player
            }

            // Draw the triangle.
            ctx.beginPath();
            ctx.moveTo(tailX - 6, tailY);   // Left base point
            ctx.lineTo(tailX + 6, tailY);   // Right base point
            ctx.lineTo(tailX, tailTipY);    // Tip (pointing toward the player)
            ctx.closePath();

            ctx.fillStyle = "white";
            ctx.fill();

            ctx.strokeStyle = "black";
            ctx.stroke();
        }
    }
}

// ============================================================
// Game Loop
// ============================================================

// gameLoop runs once per animation frame (typically 60 times per second).
// It updates the game state and then redraws everything.
function gameLoop() {
    updatePlayer(); // Process input and sync position
    draw();         // Redraw the canvas with updated state

    // requestAnimationFrame tells the browser to call gameLoop again
    // before the next screen repaint. This syncs our game to the display's
    // refresh rate and pauses automatically when the tab is hidden.
    requestAnimationFrame(gameLoop);
}

// Kick off the game loop for the first time.
gameLoop();
