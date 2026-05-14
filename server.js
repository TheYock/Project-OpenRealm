// ============================================================
// OpenRealm - Server
// ============================================================
// This file runs on Node.js and is the backbone of the game.
// It handles all communication between players using a system
// called WebSockets (via Socket.IO), which keeps a live
// two-way connection open between each browser and the server.
// ============================================================

// --- Load Environment Variables ---
// dotenv reads the .env file and adds its values to process.env,
// making them accessible anywhere in the server via process.env.KEY.
// This must be called before any other code that uses process.env.
require("dotenv").config();

// --- Dependencies ---
// Express is a web framework that makes it easy to serve files
// and handle HTTP requests.
const express = require("express");
const crypto = require("crypto");

// 'path' is a built-in Node module that helps build file paths
// correctly across different operating systems
const path = require("path");

// 'http' is a built-in Node module used to create the web server.
// We need it separately from Express so Socket.IO can attach to it.
const http = require("http");

// Socket.IO handles real-time communication. It runs on top of the
// HTTP server and opens a persistent connection with each client so
// they can send and receive messages instantly without refreshing.
const { Server } = require("socket.io");

// jsonwebtoken lets us verify the JWT the client sends on join,
// so we can confirm admin status server-side (never trust the client).
const jwt = require("jsonwebtoken");

// Mongoose is an ODM (Object Document Mapper) for MongoDB.
// It lets us define schemas and interact with the database using
// JavaScript objects instead of raw MongoDB queries.
const mongoose = require("mongoose");

// Our auth routes — handles /api/register and /api/login.
const authRoutes = require("./routes/auth");
const User       = require("./models/User");
const Channel    = require("./models/Channel");
const ChannelMember = require("./models/ChannelMember");
const Room       = require("./models/Room");
const Friendship = require("./models/Friendship");
const DirectMessage = require("./models/DirectMessage");

// --- Database Connection ---
// Connect to MongoDB Atlas using the URI stored in .env.
// mongoose.connect() returns a promise, so we use .then/.catch
// to log success or failure when the server starts.
mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log("Connected to MongoDB");
        await initializeWorldFromDb();
    })
    .catch((err) => console.error("MongoDB connection error:", err));

// --- App Setup ---
const app = express();

// express.json() is middleware that parses incoming request bodies
// with a Content-Type of "application/json". Without this, req.body
// would be undefined in our auth routes.
app.use(express.json());

// Wrap Express inside a raw HTTP server. Socket.IO needs access to
// this lower-level server to handle WebSocket upgrades.
const server = http.createServer(app);

// Attach Socket.IO to the HTTP server. 'io' is our main object for
// broadcasting messages to all connected clients.
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Tell Express to automatically serve any files in the "public" folder.
// When a browser requests "/game.js", Express finds and returns
// "public/game.js" without us needing to write a route for every file.
app.use(express.static(path.join(__dirname, "public")));

// Mount the auth routes under "/api".
// Any request to /api/register or /api/login will be handled by routes/auth.js.
app.use("/api", authRoutes);

// --- Game State ---
// A plain object used as a dictionary to track every connected player.
// Keys are socket IDs (unique strings assigned by Socket.IO).
// Values are player data objects: { name, x, y, chatBubble, chatTimestamp }
const players = {};

// Maps username → socket ID so we can detect and kick duplicate logins.
// When the same account joins from a second tab/window, the first
// connection is disconnected before the new one is registered.
const userSockets = {};

// Timed mute/freeze setTimeout handles are server-only data. Keep them
// outside the public players object so currentPlayers can be serialized safely.
const restrictionTimers = {};

// Validation constants — used to sanitize data coming from clients.
// Never trust data from the client directly; a bad actor could send
// anything, so we clamp and validate everything on the server.
const MAX_NAME_LENGTH = 20;
const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const DEFAULT_CHANNEL_ID = "openrealm";
const DEFAULT_ROOM_ID = "town-square";
const MAX_CHANNEL_NAME_LENGTH = 32;
const MAX_CHANNEL_DESCRIPTION_LENGTH = 240;
const MAX_ROOM_NAME_LENGTH = 32;
const MAX_ROOM_DESCRIPTION_LENGTH = 240;
const MAX_DIRECT_MESSAGE_LENGTH = 500;
const MAX_CHANNEL_BAN_DURATION_MINUTES = 60 * 24 * 30;
const CHANNEL_CODE_LENGTH = 6;
const DEFAULT_ROOM_MODE = "social";
const ROOM_MODES = new Set(["social", "watch", "game", "custom"]);
const ROOM_MODE_DEFINITIONS = {
    social: {
        label: "Social",
        defaultConfig: {
            topic: "Open chat",
            welcome: "Settle in and say hello.",
            vibe: "casual"
        },
        settings: [
            { key: "topic", label: "Topic", type: "text", maxLength: 80 },
            { key: "welcome", label: "Welcome", type: "textarea", maxLength: 180 },
            {
                key: "vibe",
                label: "Vibe",
                type: "select",
                options: [
                    { value: "casual", label: "Casual" },
                    { value: "roleplay", label: "Roleplay" },
                    { value: "support", label: "Support" },
                    { value: "showcase", label: "Showcase" }
                ]
            }
        ]
    },
    watch: {
        label: "Watch",
        defaultConfig: {
            streamTitle: "Watch Party",
            streamUrl: "",
            hostNote: ""
        },
        settings: [
            { key: "streamTitle", label: "Title", type: "text", maxLength: 80 },
            { key: "streamUrl", label: "Stream URL", type: "url", maxLength: 240 },
            { key: "hostNote", label: "Host Note", type: "textarea", maxLength: 180 }
        ]
    },
    game: {
        label: "Game",
        defaultConfig: {
            gameKey: "realm-rush",
            roundLength: 180,
            scoreLimit: 10
        },
        settings: [
            {
                key: "gameKey",
                label: "Game",
                type: "select",
                options: [
                    { value: "realm-rush", label: "Realm Rush" },
                    { value: "tile-capture", label: "Tile Capture" },
                    { value: "trivia-arena", label: "Trivia Arena" }
                ]
            },
            { key: "roundLength", label: "Round Seconds", type: "number", min: 30, max: 900, step: 30 },
            { key: "scoreLimit", label: "Score Limit", type: "number", min: 1, max: 100, step: 1 }
        ]
    },
    custom: {
        label: "Custom",
        defaultConfig: {
            panelTitle: "Custom Room",
            panelBody: "Add your own room prompt, links, or event details.",
            accentColor: "#4caf50",
            actionLabel: "",
            actionUrl: ""
        },
        settings: [
            { key: "panelTitle", label: "Panel Title", type: "text", maxLength: 80 },
            { key: "panelBody", label: "Panel Text", type: "textarea", maxLength: 240 },
            { key: "accentColor", label: "Accent", type: "color" },
            { key: "actionLabel", label: "Action Label", type: "text", maxLength: 32 },
            { key: "actionUrl", label: "Action URL", type: "url", maxLength: 240 }
        ]
    }
};

const channels = {
    [DEFAULT_CHANNEL_ID]: {
        id:        DEFAULT_CHANNEL_ID,
        name:      "OpenRealm",
        ownerUserId: null,
        ownerName: "System",
        code: null,
        isPublic: true,
        createdAt: Date.now(),
        isDefault: true
    }
};

const rooms = {
    [DEFAULT_ROOM_ID]: {
        id:        DEFAULT_ROOM_ID,
        name:      "Town Square",
        channelId: DEFAULT_CHANNEL_ID,
        ownerUserId: null,
        ownerName: "System",
        createdAt: Date.now(),
        isDefault: true
    }
};

function ensureDefaultWorldInMemory() {
    channels[DEFAULT_CHANNEL_ID] ||= {
        id:        DEFAULT_CHANNEL_ID,
        name:      "OpenRealm",
        ownerUserId: null,
        ownerName: "System",
        code: null,
        isPublic: true,
        createdAt: Date.now(),
        isDefault: true,
        memberCount: 0
    };

    rooms[DEFAULT_ROOM_ID] ||= {
        id:        DEFAULT_ROOM_ID,
        name:      "Town Square",
        description: "The main public gathering room for OpenRealm.",
        mode:      DEFAULT_ROOM_MODE,
        modeConfig: {},
        channelId: DEFAULT_CHANNEL_ID,
        ownerUserId: null,
        ownerName: "System",
        createdAt: Date.now(),
        isDefault: true
    };
}

function roomChannel(roomId) {
    return `room:${roomId}`;
}

function getDefaultAvatar(player) {
    return { color: player.isBot ? "#ffa726" : "#4caf50" };
}

function publicPlayer(id, player) {
    return {
        id,
        name:          player.name,
        x:             player.x,
        y:             player.y,
        size:          player.size || 20,
        chatBubble:    player.chatBubble || "",
        chatTimestamp: player.chatTimestamp || 0,
        muted:         !!player.muted,
        frozen:        !!player.frozen,
        isAdmin:       !!player.isAdmin,
        isBot:         !!player.isBot,
        roomId:        player.roomId || DEFAULT_ROOM_ID,
        joinedAt:      player.joinedAt,
        avatar:        player.avatar || getDefaultAvatar(player)
    };
}

function publicPlayersSnapshot(roomId = DEFAULT_ROOM_ID) {
    const snapshot = {};
    for (const [id, player] of Object.entries(players)) {
        if ((player.roomId || DEFAULT_ROOM_ID) !== roomId) continue;
        snapshot[id] = publicPlayer(id, player);
    }
    return snapshot;
}

function canCreateRooms(socket) {
    return !!socket?.data?.isAdmin || !!socket?.data?.canCreateRooms;
}

function favoriteChannelIds(socket) {
    return Array.isArray(socket?.data?.favoriteChannels)
        ? socket.data.favoriteChannels.map(String)
        : [];
}

function timestampFromDateLike(value) {
    if (!value) return null;
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
}

function isActiveChannelBan(membership) {
    if (!membership || membership.status !== "banned") return false;
    const expiresAt = timestampFromDateLike(membership.banExpiresAt);
    return !expiresAt || expiresAt > Date.now();
}

function channelBanMessage(membership) {
    const expiresAt = timestampFromDateLike(membership?.banExpiresAt);
    if (!expiresAt) return "You are permanently banned from this channel.";
    return `You are banned from this channel until ${new Date(expiresAt).toLocaleString()}.`;
}

function channelMembership(socket, channelId) {
    return socket?.data?.channelMemberships?.[channelId] || null;
}

function isChannelMember(socket, channelId) {
    const membership = channelMembership(socket, channelId);
    return !!membership && (membership.status === "active" || !isActiveChannelBan(membership));
}

function channelRole(socket, channelId) {
    const membership = channelMembership(socket, channelId);
    if (isActiveChannelBan(membership)) return null;
    return membership?.role || null;
}

function roleRank(role) {
    return { owner: 4, admin: 3, moderator: 2, member: 1 }[role] || 0;
}

function hasChannelRole(socket, channelId, minimumRole) {
    return roleRank(channelRole(socket, channelId)) >= roleRank(minimumRole);
}

function isChannelOwner(socket, channel) {
    if (!socket || !channel || !socket.data.userId) return false;
    if (channel.isDefault) return !!socket.data.isAdmin;
    return channelRole(socket, channel.id) === "owner"
        || (!!channel.ownerUserId && String(channel.ownerUserId) === String(socket.data.userId));
}

function canEnterChannel(socket, channel) {
    if (!channel) return false;
    if (channel.isDefault && !socket?.data?.userId) return true;
    if (isActiveChannelBan(channelMembership(socket, channel.id))) return false;
    return isChannelMember(socket, channel.id);
}

function canManageRooms(socket, channel) {
    return isChannelOwner(socket, channel);
}

function canModerateChannel(socket, channel) {
    if (!socket || !channel) return false;
    if (channel.isDefault) return !!socket.data.isAdmin;
    return hasChannelRole(socket, channel.id, "moderator");
}

function canManageChannel(socket, channel) {
    if (!socket || !channel) return false;
    if (channel.isDefault) return !!socket.data.isAdmin;
    return hasChannelRole(socket, channel.id, "admin");
}

function canModerateChannelMember(socket, channel, targetMembership) {
    if (!socket || !channel || !targetMembership) return false;
    if (!canManageChannel(socket, channel)) return false;
    if (targetMembership.role === "owner") return false;

    return roleRank(channelRole(socket, channel.id)) > roleRank(targetMembership.role);
}

function canDeleteChannel(socket, channel) {
    if (!socket || !channel || channel.isDefault || !socket.data.userId) return false;
    return isChannelOwner(socket, channel);
}

function canViewChannel(socket, channel) {
    if (!channel) return false;
    if (channel.isPublic) return true;
    return canEnterChannel(socket, channel) || canManageChannel(socket, channel);
}

function canManageRoom(socket, room) {
    if (!socket || !room || room.isDefault) return false;
    const channel = channels[room.channelId || DEFAULT_CHANNEL_ID];
    return canManageRooms(socket, channel);
}

function canCustomizeRoom(socket, room) {
    if (!socket || !room) return false;
    const channel = channels[room.channelId || DEFAULT_CHANNEL_ID];
    if (!channel || channel.isDefault) return !!socket?.data?.isAdmin;
    return canManageChannel(socket, channel) || canManageRooms(socket, channel);
}

function publicChannel(channel, socket = null) {
    const channelRooms = Object.values(rooms)
        .filter(room => room.channelId === channel.id)
        .sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            return a.createdAt - b.createdAt;
        });
    const channelRoomIds = new Set(channelRooms.map(room => room.id));
    const favoriteIds = favoriteChannelIds(socket);
    const isMember = canEnterChannel(socket, channel);
    const isBanned = isActiveChannelBan(channelMembership(socket, channel.id));
    const includeCode = !!channel.code && (
        socket?.data?.channelId === channel.id ||
        isMember ||
        canManageChannel(socket, channel)
    );

    return {
        id:          channel.id,
        name:        channel.name,
        description: channel.description || "",
        ownerName:   channel.ownerName,
        code:        includeCode ? channel.code : null,
        isPublic:    !!channel.isPublic,
        isDefault:   !!channel.isDefault,
        isMember,
        role:        channelRole(socket, channel.id),
        isFavorite:  favoriteIds.includes(channel.id),
        isBanned,
        canJoin:     !!socket?.data?.userId && !isMember && !!channel.isPublic && !isBanned,
        roomsHidden: !isMember && !channel.isPublic && channelRooms.length > 0,
        canManage:   canManageChannel(socket, channel),
        canManageRooms: canManageRooms(socket, channel),
        canModerate: canModerateChannel(socket, channel),
        canDelete:   canDeleteChannel(socket, channel),
        roomCount:   channelRooms.length,
        memberCount: Number(channel.memberCount) || 0,
        playerCount: Object.values(players).filter(player => channelRoomIds.has(player.roomId)).length,
        createdAt:   channel.createdAt,
        rooms:       isMember
            ? publicRoomsForChannel(socket, channel.id)
            : (channel.isPublic ? channelRooms.map(room => publicRoomPreview(room)) : [])
    };
}

function publicChannelsForSocket(socket = null) {
    return Object.values(channels)
        .filter(channel => canViewChannel(socket, channel))
        .sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;

            const aFavorite = favoriteChannelIds(socket).includes(a.id);
            const bFavorite = favoriteChannelIds(socket).includes(b.id);
            if (aFavorite !== bFavorite) return aFavorite ? -1 : 1;

            return a.name.localeCompare(b.name);
        })
        .map(channel => publicChannel(channel, socket));
}

function publicRoom(room, socket = null) {
    const roomPlayers = Object.values(players).filter(p => p.roomId === room.id);
    const mode = sanitizeRoomMode(room.mode);

    return {
        id:          room.id,
        name:        room.name,
        description: room.description || "",
        mode,
        modeLabel:   roomModeDefinition(mode).label,
        modeConfig:  sanitizeRoomModeConfig(mode, room.modeConfig),
        channelId:   room.channelId || DEFAULT_CHANNEL_ID,
        ownerName:   room.ownerName,
        code:        null,
        isPrivate:   false,
        createdAt:   room.createdAt,
        isDefault:   !!room.isDefault,
        canClose:    canManageRoom(socket, room),
        canCustomize: canCustomizeRoom(socket, room),
        playerCount: roomPlayers.filter(p => !p.isBot).length,
        botCount:    roomPlayers.filter(p => p.isBot).length
    };
}

function publicRoomPreview(room) {
    const roomPlayers = Object.values(players).filter(p => p.roomId === room.id);
    const mode = sanitizeRoomMode(room.mode);

    return {
        id:          room.id,
        name:        room.name,
        description: room.description || "",
        mode,
        modeLabel:   roomModeDefinition(mode).label,
        modeConfig:  sanitizeRoomModeConfig(mode, room.modeConfig),
        channelId:   room.channelId || DEFAULT_CHANNEL_ID,
        ownerName:   room.ownerName,
        createdAt:   room.createdAt,
        isDefault:   !!room.isDefault,
        canClose:    false,
        playerCount: roomPlayers.filter(p => !p.isBot).length,
        botCount:    roomPlayers.filter(p => p.isBot).length,
        previewOnly: true
    };
}

function publicRoomsForChannel(socket = null, channelId = DEFAULT_CHANNEL_ID) {
    const selectedChannelId = channelId || socket?.data?.channelId || DEFAULT_CHANNEL_ID;

    return Object.values(rooms)
        .filter((room) => (room.channelId || DEFAULT_CHANNEL_ID) === selectedChannelId)
        .filter((room) => canEnterChannel(socket, channels[room.channelId || DEFAULT_CHANNEL_ID]))
        .sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            return a.createdAt - b.createdAt;
        })
        .map((room) => publicRoom(room, socket));
}

function publicRoomsForSocket(socket = null, channelId = null) {
    return publicRoomsForChannel(socket, channelId || socket?.data?.channelId || DEFAULT_CHANNEL_ID);
}

function broadcastRoomList() {
    io.sockets.sockets.forEach((socket) => {
        socket.emit("roomList", publicRoomsForSocket(socket));
    });
}

function broadcastChannelList() {
    io.sockets.sockets.forEach((socket) => {
        socket.emit("channelList", publicChannelsForSocket(socket));
    });
}

function normalizedUserId(userId) {
    return String(userId || "");
}

function friendshipPairKey(userIdA, userIdB) {
    return [normalizedUserId(userIdA), normalizedUserId(userIdB)]
        .sort()
        .join(":");
}

function findOnlineSocketByUserId(userId) {
    const targetUserId = normalizedUserId(userId);
    for (const socket of io.sockets.sockets.values()) {
        if (players[socket.id] && normalizedUserId(socket.data.userId) === targetUserId) {
            return socket;
        }
    }
    return null;
}

function friendshipIdentityForViewer(friendship, viewerUserId) {
    const viewerId = normalizedUserId(viewerUserId);
    const requesterId = normalizedUserId(friendship.requesterUserId);
    const isRequester = requesterId === viewerId;

    return {
        userId: isRequester
            ? normalizedUserId(friendship.recipientUserId)
            : requesterId,
        username: isRequester
            ? friendship.recipientUsername
            : friendship.requesterUsername,
        direction: friendship.status === "pending"
            ? (isRequester ? "outgoing" : "incoming")
            : "accepted"
    };
}

function publicFriend(friendship, viewerSocket) {
    const friend = friendshipIdentityForViewer(friendship, viewerSocket?.data?.userId);
    if (friendship.status !== "accepted") {
        return {
            friendshipId: normalizedUserId(friendship._id),
            userId: friend.userId,
            username: friend.username,
            status: friendship.status,
            direction: friend.direction,
            online: false,
            locationLabel: friend.direction === "incoming" ? "Incoming request" : "Request sent",
            channelId: null,
            roomId: null,
            canJoin: false
        };
    }

    const friendSocket = findOnlineSocketByUserId(friend.userId);
    const friendPlayer = friendSocket ? players[friendSocket.id] : null;
    const room = friendPlayer ? rooms[friendPlayer.roomId || DEFAULT_ROOM_ID] : null;
    const channel = room ? channels[room.channelId || DEFAULT_CHANNEL_ID] : null;

    let locationLabel = "Offline";
    let canJoin = false;
    let channelId = null;
    let roomId = null;

    if (friendPlayer && room && channel) {
        const canEnter = canEnterChannel(viewerSocket, channel);
        const canPreviewPublic = !!channel.isPublic;
        if (!canEnter && !canPreviewPublic) {
            locationLabel = "Private Channel";
        } else {
            locationLabel = `${channel.name} / ${room.name}`;
            channelId = channel.id;
            roomId = room.id;
            canJoin = canEnter || canPreviewPublic;
        }
    }

    return {
        friendshipId: normalizedUserId(friendship._id),
        userId: friend.userId,
        username: friend.username,
        status: friendship.status,
        direction: friend.direction,
        online: !!friendPlayer,
        locationLabel,
        channelId,
        roomId,
        canJoin
    };
}

async function friendshipDocsForUser(userId) {
    return Friendship.find({
        $or: [
            { requesterUserId: userId },
            { recipientUserId: userId }
        ],
        status: { $in: ["pending", "accepted"] }
    }).sort({ updatedAt: -1 });
}

async function sendFriendList(socket) {
    if (!socket?.data?.userId) return;
    const friendships = await friendshipDocsForUser(socket.data.userId);
    socket.emit("friendList", friendships.map(friendship => publicFriend(friendship, socket)));
}

async function sendFriendListToUser(userId) {
    const targetSocket = findOnlineSocketByUserId(userId);
    if (targetSocket) {
        await sendFriendList(targetSocket);
    }
}

async function acceptedFriendUserIds(userId) {
    const viewerId = normalizedUserId(userId);
    const friendships = await Friendship.find({
        $or: [
            { requesterUserId: userId },
            { recipientUserId: userId }
        ],
        status: "accepted"
    });

    return friendships.map((friendship) => {
        const requesterId = normalizedUserId(friendship.requesterUserId);
        return requesterId === viewerId
            ? normalizedUserId(friendship.recipientUserId)
            : requesterId;
    });
}

async function sendFriendListsForUser(userId, includeSelf = true) {
    const targetIds = new Set(await acceptedFriendUserIds(userId));
    if (includeSelf) {
        targetIds.add(normalizedUserId(userId));
    }

    await Promise.all([...targetIds].map(id => sendFriendListToUser(id)));
}

async function acceptedFriendshipBetween(userIdA, userIdB) {
    return Friendship.findOne({
        pairKey: friendshipPairKey(userIdA, userIdB),
        status: "accepted"
    });
}

function publicDirectMessage(message, viewerUserId) {
    const viewerId = normalizedUserId(viewerUserId);
    const participantIds = Array.isArray(message.participants)
        ? message.participants.map(normalizedUserId)
        : [];
    const friendUserId = participantIds.find(id => id !== viewerId)
        || normalizedUserId(message.senderUserId);

    return {
        id: normalizedUserId(message._id),
        friendUserId,
        senderUserId: normalizedUserId(message.senderUserId),
        senderUsername: message.senderUsername,
        body: message.body,
        sentAt: message.createdAt ? message.createdAt.getTime() : Date.now()
    };
}

function sanitizeChannelName(name) {
    if (typeof name !== "string") return "";
    return name.trim().replace(/\s+/g, " ").slice(0, MAX_CHANNEL_NAME_LENGTH);
}

function sanitizeChannelDescription(description) {
    if (typeof description !== "string") return "";
    return description.trim().replace(/\s+/g, " ").slice(0, MAX_CHANNEL_DESCRIPTION_LENGTH);
}

function sanitizeRoomName(name) {
    if (typeof name !== "string") return "";
    return name.trim().replace(/\s+/g, " ").slice(0, MAX_ROOM_NAME_LENGTH);
}

function sanitizeRoomDescription(description) {
    if (typeof description !== "string") return "";
    return description.trim().replace(/\s+/g, " ").slice(0, MAX_ROOM_DESCRIPTION_LENGTH);
}

function sanitizeRoomMode(mode) {
    return ROOM_MODES.has(mode) ? mode : DEFAULT_ROOM_MODE;
}

function roomModeDefinition(mode) {
    return ROOM_MODE_DEFINITIONS[sanitizeRoomMode(mode)] || ROOM_MODE_DEFINITIONS[DEFAULT_ROOM_MODE];
}

function publicRoomModeDefinitions() {
    return Object.entries(ROOM_MODE_DEFINITIONS).reduce((defs, [mode, definition]) => {
        defs[mode] = {
            label: definition.label,
            defaultConfig: { ...definition.defaultConfig },
            settings: definition.settings.map(setting => ({
                ...setting,
                options: Array.isArray(setting.options)
                    ? setting.options.map(option => ({ ...option }))
                    : undefined
            }))
        };
        return defs;
    }, {});
}

function sanitizeRoomModeConfig(mode, config = {}) {
    const definition = roomModeDefinition(mode);
    const source = config && typeof config === "object" ? config : {};
    const sanitized = {};

    for (const setting of definition.settings) {
        const fallback = definition.defaultConfig[setting.key];
        const rawValue = source[setting.key] ?? fallback;

        if (setting.type === "number") {
            const value = Number(rawValue);
            const min = Number.isFinite(setting.min) ? setting.min : Number.MIN_SAFE_INTEGER;
            const max = Number.isFinite(setting.max) ? setting.max : Number.MAX_SAFE_INTEGER;
            sanitized[setting.key] = Number.isFinite(value)
                ? Math.max(min, Math.min(max, value))
                : fallback;
        } else if (setting.type === "select") {
            const allowed = new Set((setting.options || []).map(option => option.value));
            sanitized[setting.key] = allowed.has(rawValue) ? rawValue : fallback;
        } else if (setting.type === "url") {
            const value = typeof rawValue === "string"
                ? rawValue.trim().slice(0, setting.maxLength || 240)
                : "";
            if (!value) {
                sanitized[setting.key] = "";
            } else {
                try {
                    const parsed = new URL(value);
                    sanitized[setting.key] = ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
                } catch (e) {
                    sanitized[setting.key] = "";
                }
            }
        } else if (setting.type === "color") {
            sanitized[setting.key] = typeof rawValue === "string" && /^#[0-9a-fA-F]{6}$/.test(rawValue)
                ? rawValue
                : fallback;
        } else {
            sanitized[setting.key] = typeof rawValue === "string"
                ? rawValue.trim().replace(/\s+/g, " ").slice(0, setting.maxLength || 120)
                : fallback;
        }
    }

    return sanitized;
}

function normalizeChannelBanDuration(duration) {
    if (duration === null || duration === undefined) return null;
    const minutes = Math.floor(Number(duration));
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return Math.min(minutes, MAX_CHANNEL_BAN_DURATION_MINUTES);
}

function clampSpawnPosition(x, y, size = 20) {
    return {
        x: Math.max(0, Math.min(Number(x) || 400, WORLD_WIDTH - size)),
        y: Math.max(0, Math.min(Number(y) || 300, WORLD_HEIGHT - size))
    };
}

function isSpawnOpen(roomId, candidate, size = 20) {
    return !Object.values(players).some((player) => {
        if ((player.roomId || DEFAULT_ROOM_ID) !== roomId) return false;

        const playerSize = player.size || 20;
        const dx = (player.x + playerSize / 2) - (candidate.x + size / 2);
        const dy = (player.y + playerSize / 2) - (candidate.y + size / 2);
        const minimumDistance = (playerSize + size) / 2 + 12;

        return Math.hypot(dx, dy) < minimumDistance;
    });
}

function pickSpawnPosition(roomId, preferredX = 400, preferredY = 300, size = 20) {
    const base = clampSpawnPosition(preferredX, preferredY, size);
    const offsets = [
        [0, 0], [200, 0], [-200, 0], [0, 96], [0, -96],
        [200, 96], [-200, 96], [200, -96], [-200, -96],
        [320, 0], [-320, 0], [0, 192], [0, -192],
        [320, 96], [-320, 96], [320, -96], [-320, -96]
    ];

    for (const [dx, dy] of offsets) {
        const candidate = clampSpawnPosition(base.x + dx, base.y + dy, size);
        if (isSpawnOpen(roomId, candidate, size)) return candidate;
    }

    return base;
}

function normalizeChannelDoc(doc) {
    return {
        id:          doc.channelId,
        name:        doc.name,
        description: doc.description || "",
        ownerUserId: doc.ownerUserId ? String(doc.ownerUserId) : null,
        ownerName:   doc.ownerName,
        code:        doc.code || null,
        isPublic:    !!doc.isPublic,
        createdAt:   doc.createdAt ? doc.createdAt.getTime() : Date.now(),
        isDefault:   !!doc.isDefault
    };
}

function normalizeRoomDoc(doc) {
    const mode = sanitizeRoomMode(doc.mode);
    return {
        id:          doc.roomId,
        name:        doc.name,
        description: doc.description || "",
        mode,
        modeConfig:  sanitizeRoomModeConfig(mode, doc.modeConfig),
        channelId:   doc.channelId || DEFAULT_CHANNEL_ID,
        ownerUserId: doc.ownerUserId ? String(doc.ownerUserId) : null,
        ownerName:   doc.ownerName,
        createdAt:   doc.createdAt ? doc.createdAt.getTime() : Date.now(),
        isDefault:   !!doc.isDefault
    };
}

async function generateChannelCode() {
    for (let i = 0; i < 12; i++) {
        const code = crypto.randomBytes(4)
            .toString("base64url")
            .replace(/[^A-Z0-9]/gi, "")
            .toUpperCase()
            .slice(0, CHANNEL_CODE_LENGTH);

        if (code.length !== CHANNEL_CODE_LENGTH) continue;
        const existsInMemory = Object.values(channels).some(channel => channel.code === code);
        if (existsInMemory) continue;
        const existsInDb = await Channel.exists({ code, isActive: true });
        if (!existsInDb) return code;
    }

    throw new Error("Could not generate a unique channel code");
}

function normalizeMembershipDoc(doc) {
    return {
        channelId:        doc.channelId,
        userId:           String(doc.userId),
        username:         doc.username,
        role:             doc.role || "member",
        status:           doc.status || "active",
        banExpiresAt:     timestampFromDateLike(doc.banExpiresAt),
        bannedAt:         timestampFromDateLike(doc.bannedAt),
        bannedByUserId:   doc.bannedByUserId ? String(doc.bannedByUserId) : null,
        bannedByUsername: doc.bannedByUsername || ""
    };
}

async function releaseExpiredChannelBansForUser(userId) {
    if (!userId) return;
    const expired = await ChannelMember.find(
        {
            userId,
            status: "banned",
            banExpiresAt: { $ne: null, $lte: new Date() }
        },
        "channelId"
    );
    if (!expired.length) return;

    await ChannelMember.updateMany(
        {
            userId,
            status: "banned",
            banExpiresAt: { $ne: null, $lte: new Date() }
        },
        {
            $set: {
                status: "active",
                banExpiresAt: null,
                bannedAt: null,
                bannedByUserId: null,
                bannedByUsername: ""
            }
        }
    );
    await Promise.all([...new Set(expired.map(membership => membership.channelId))]
        .map(channelId => refreshChannelMemberCount(channelId)));
}

async function loadChannelMembershipMap(userId) {
    await releaseExpiredChannelBansForUser(userId);
    const docs = await ChannelMember.find({
        userId,
        status: { $in: ["active", "banned"] }
    });
    return docs.reduce((map, doc) => {
        const membership = normalizeMembershipDoc(doc);
        map[membership.channelId] = membership;
        return map;
    }, {});
}

async function upsertChannelMembership({ channelId, userId, username, role = "member", status = "active" }) {
    const existing = await ChannelMember.findOne({ channelId, userId });
    if (existing && isActiveChannelBan(normalizeMembershipDoc(existing))) {
        return normalizeMembershipDoc(existing);
    }

    const resolvedRole = existing && roleRank(existing.role) > roleRank(role)
        ? existing.role
        : role;
    const result = await ChannelMember.findOneAndUpdate(
        { channelId, userId },
        {
            $set: {
                username,
                role: resolvedRole,
                status,
                banExpiresAt: null,
                bannedAt: null,
                bannedByUserId: null,
                bannedByUsername: ""
            },
            $setOnInsert: { joinedAt: new Date() }
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    return normalizeMembershipDoc(result);
}

async function ensureSocketChannelMembership(socket, channel, role = "member") {
    if (!socket?.data?.userId || !channel) return null;

    const existing = channelMembership(socket, channel.id);
    const resolvedRole = existing && roleRank(existing.role) > roleRank(role)
        ? existing.role
        : role;
    const membership = await upsertChannelMembership({
        channelId: channel.id,
        userId: socket.data.userId,
        username: socket.data.username,
        role: resolvedRole,
        status: "active"
    });

    socket.data.channelMemberships ||= {};
    socket.data.channelMemberships[channel.id] = membership;
    if (isActiveChannelBan(membership)) {
        const error = new Error(channelBanMessage(membership));
        error.code = "CHANNEL_BANNED";
        throw error;
    }
    await refreshChannelMemberCount(channel.id);
    return membership;
}

async function ensureUserDefaultMembership(user) {
    const membership = await upsertChannelMembership({
        channelId: DEFAULT_CHANNEL_ID,
        userId: user._id,
        username: user.username,
        role: "member",
        status: "active"
    });
    await refreshChannelMemberCount(DEFAULT_CHANNEL_ID);
    return membership;
}

async function migrateFavoriteMemberships(user) {
    const favoriteIds = Array.isArray(user.favoriteChannels) ? user.favoriteChannels : [];
    for (const channelId of favoriteIds) {
        const channel = channels[String(channelId)];
        if (!channel) continue;
        await upsertChannelMembership({
            channelId: channel.id,
            userId: user._id,
            username: user.username,
            role: "member",
            status: "active"
        });
        await refreshChannelMemberCount(channel.id);
    }
}

async function refreshChannelMemberCount(channelId) {
    if (!channels[channelId]) return 0;
    const count = await ChannelMember.countDocuments({ channelId, status: "active" });
    channels[channelId].memberCount = count;
    return count;
}

async function createChannelRecord({ name, description = "", ownerUserId, ownerName, isPublic = true }) {
    const channelId = `channel_${crypto.randomBytes(8).toString("hex")}`;
    const code = await generateChannelCode();
    const doc = await Channel.create({
        channelId,
        name,
        description: sanitizeChannelDescription(description),
        ownerUserId,
        ownerName,
        code,
        isPublic,
        isDefault: false,
        isActive: true
    });

    const channel = normalizeChannelDoc(doc);
    channel.memberCount = 0;
    channels[channel.id] = channel;
    return channel;
}

async function createRoomRecord({ name, description = "", mode = DEFAULT_ROOM_MODE, modeConfig = {}, channelId, ownerUserId, ownerName }) {
    const roomId = `room_${crypto.randomBytes(8).toString("hex")}`;
    const roomMode = sanitizeRoomMode(mode);
    const doc = await Room.create({
        roomId,
        name,
        description,
        mode: roomMode,
        modeConfig: sanitizeRoomModeConfig(roomMode, modeConfig),
        channelId: channelId || DEFAULT_CHANNEL_ID,
        ownerUserId,
        ownerName,
        code: null,
        isPrivate: false,
        isDefault: false,
        isActive: true
    });

    const room = normalizeRoomDoc(doc);
    rooms[room.id] = room;
    return room;
}

async function initializeWorldFromDb() {
    const defaultChannelDoc = await Channel.findOneAndUpdate(
        { channelId: DEFAULT_CHANNEL_ID },
        {
            $setOnInsert: {
                channelId: DEFAULT_CHANNEL_ID,
                name: "OpenRealm",
                description: "The default public community for new players, testing, and shared rooms.",
                ownerName: "System",
                ownerUserId: null,
                code: null,
                isPublic: true,
                isDefault: true,
                isActive: true
            }
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    await Room.updateMany(
        { $or: [{ channelId: { $exists: false } }, { channelId: null }] },
        { $set: { channelId: DEFAULT_CHANNEL_ID } }
    );

    await Room.updateMany(
        { isActive: true, $or: [{ isPrivate: true }, { code: { $ne: null } }] },
        { $set: { isPrivate: false, code: null } }
    );

    await Room.updateMany(
        { isActive: true, $or: [{ mode: { $exists: false } }, { mode: null }] },
        { $set: { mode: DEFAULT_ROOM_MODE } }
    );

    await Room.updateMany(
        { isActive: true, $or: [{ modeConfig: { $exists: false } }, { modeConfig: null }] },
        { $set: { modeConfig: {} } }
    );

    await Channel.updateMany(
        { isActive: true, $or: [{ description: { $exists: false } }, { description: null }] },
        { $set: { description: "" } }
    );

    const channelsMissingCodes = await Channel.find({
        isActive: true,
        isDefault: { $ne: true },
        $or: [{ code: { $exists: false } }, { code: null }]
    });

    for (const channel of channelsMissingCodes) {
        channel.code = await generateChannelCode();
        await channel.save();
    }

    const defaultDoc = await Room.findOneAndUpdate(
        { roomId: DEFAULT_ROOM_ID },
        {
            $setOnInsert: {
                roomId: DEFAULT_ROOM_ID,
                name: "Town Square",
                description: "The main public gathering room for OpenRealm.",
                mode: DEFAULT_ROOM_MODE,
                channelId: DEFAULT_CHANNEL_ID,
                ownerName: "System",
                ownerUserId: null,
                code: null,
                isPrivate: false,
                isDefault: true,
                isActive: true
            }
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    const activeChannels = await Channel.find({ isActive: true }).sort({ createdAt: 1 });
    const activeRooms = await Room.find({ isActive: true }).sort({ createdAt: 1 });

    for (const channel of activeChannels) {
        if (!channel.ownerUserId) continue;
        await upsertChannelMembership({
            channelId: channel.channelId,
            userId: channel.ownerUserId,
            username: channel.ownerName,
            role: "owner",
            status: "active"
        });
    }

    const activeMemberCounts = await ChannelMember.aggregate([
        { $match: { status: "active" } },
        { $group: { _id: "$channelId", count: { $sum: 1 } } }
    ]);
    const memberCountByChannel = activeMemberCounts.reduce((map, entry) => {
        map[entry._id] = entry.count;
        return map;
    }, {});

    for (const key of Object.keys(channels)) delete channels[key];
    for (const key of Object.keys(rooms)) delete rooms[key];

    activeChannels.forEach((doc) => {
        const channel = normalizeChannelDoc(doc);
        channel.memberCount = memberCountByChannel[channel.id] || 0;
        channels[channel.id] = channel;
    });

    if (!channels[DEFAULT_CHANNEL_ID]) {
        channels[DEFAULT_CHANNEL_ID] = normalizeChannelDoc(defaultChannelDoc);
        channels[DEFAULT_CHANNEL_ID].memberCount = memberCountByChannel[DEFAULT_CHANNEL_ID] || 0;
    }

    activeRooms.forEach((doc) => {
        const room = normalizeRoomDoc(doc);
        rooms[room.id] = room;
    });

    if (!rooms[DEFAULT_ROOM_ID]) {
        rooms[DEFAULT_ROOM_ID] = normalizeRoomDoc(defaultDoc);
    }

    broadcastChannelList();
    broadcastRoomList();
}

function setRestrictionTimer(targetId, type, timer) {
    restrictionTimers[targetId] ||= {};
    restrictionTimers[targetId][type] = timer;
}

function hasRestrictionTimer(targetId, type) {
    return !!restrictionTimers[targetId]?.[type];
}

function clearRestrictionTimer(targetId, type) {
    const timer = restrictionTimers[targetId]?.[type];
    if (!timer) return false;

    clearTimeout(timer);
    restrictionTimers[targetId][type] = null;

    if (!restrictionTimers[targetId].mute && !restrictionTimers[targetId].freeze) {
        delete restrictionTimers[targetId];
    }

    return true;
}

function clearAllRestrictionTimers(targetId) {
    clearRestrictionTimer(targetId, "mute");
    clearRestrictionTimer(targetId, "freeze");
}

// ============================================================
// Bot System
// ============================================================
// Bots are fake players stored in the players dictionary just
// like real ones, but keyed with a "bot_" prefix and driven by
// a server-side interval rather than socket input.
// botIntervals maps botId → intervalId so we can clear it on removal.
// ============================================================
const botIntervals = {};
let botCounter = 0; // Incremented each time a bot is created for unique IDs

function createBot(x, y, roomId = DEFAULT_ROOM_ID) {
    const id   = `bot_${++botCounter}`;
    const name = `Bot${botCounter}`;

    players[id] = {
        name,
        x,
        y,
        size:          20,
        chatBubble:    "",
        chatTimestamp: 0,
        muted:         false,
        frozen:        false,
        isAdmin:       false,
        roomId,
        isBot:         true,        // Flag so clients can distinguish bots
        joinedAt:      Date.now()
    };

    // Tell all clients a new "player" (bot) has appeared.
    io.to(roomChannel(roomId)).emit("newPlayer", publicPlayer(id, players[id]));
    broadcastRoomList();
    broadcastChannelList();

    // Bots wander by picking a new random target every 2–4 seconds
    // and moving toward it in small steps each tick (100ms).
    let targetX = x;
    let targetY = y;

    const pickTarget = () => {
        // Pick a random destination within world bounds.
        targetX = Math.floor(Math.random() * (WORLD_WIDTH  - 20));
        targetY = Math.floor(Math.random() * (WORLD_HEIGHT - 20));
    };

    pickTarget();
    // Pick a new wander target every 2–4 seconds.
    const wanderTimer = setInterval(pickTarget, 2000 + Math.random() * 2000);

    // Move the bot 2px per tick toward its current target.
    const moveTimer = setInterval(() => {
        if (!players[id] || players[id].frozen) return;

        const dx = targetX - players[id].x;
        const dy = targetY - players[id].y;
        const dist = Math.hypot(dx, dy);

        if (dist > 2) {
            players[id].x += (dx / dist) * 2;
            players[id].y += (dy / dist) * 2;
            io.to(roomChannel(players[id].roomId)).emit("playerMoved", { id, x: players[id].x, y: players[id].y });
        }
    }, 100);

    // Store both interval IDs so removeBot() can clean them up.
    botIntervals[id] = [wanderTimer, moveTimer];

    return id;
}

function removeBot(id) {
    if (!players[id] || !players[id].isBot) return;
    const roomId = players[id].roomId || DEFAULT_ROOM_ID;

    // Stop the bot's movement and wander timers.
    if (botIntervals[id]) {
        botIntervals[id].forEach(clearInterval);
        delete botIntervals[id];
    }

    delete players[id];
    io.to(roomChannel(roomId)).emit("playerDisconnected", id);
    broadcastRoomList();
    broadcastChannelList();
}

// --- Socket.IO Connection Handler ---
// This callback runs every time a new client connects.
// Each client gets their own 'socket' object — think of it as a
// dedicated phone line between the server and that one player.
// Calculates and broadcasts the current spectator count to all clients.
// Spectators are sockets that are connected but haven't sent a "join" event.
// Total connected sockets minus the number of active (non-bot) players gives us the count.
function broadcastSpectatorCount() {
    const activePlayers = Object.values(players).filter(p => !p.isBot).length;
    const totalSockets  = io.sockets.sockets.size;
    const spectators    = Math.max(0, totalSockets - activePlayers);
    io.emit("spectatorCount", spectators);
}

// --- scheduleExpiry ---
// Sets a setTimeout to auto-reverse a timed mute or freeze for `targetId`.
// Expects players[targetId].muteExpiresAt / freezeExpiresAt to already be set.
// When the timer fires it clears the in-memory state, updates MongoDB,
// and broadcasts the change to all clients.
function scheduleExpiry(targetId, type) {
    const expiryKey = type === "mute" ? "muteExpiresAt"   : "freezeExpiresAt";
    const statusKey = type === "mute" ? "muted"           : "frozen";
    const dbKey     = type === "mute" ? "muteRemainingMs" : "freezeRemainingMs";

    const remaining = players[targetId][expiryKey] - Date.now();

    if (remaining <= 0) {
        // Expiry already passed (e.g. player was offline longer than the duration).
        players[targetId][statusKey] = false;
        User.updateOne({ username: players[targetId].name }, { [dbKey]: null }).catch(() => {});
        return;
    }

    const timer = setTimeout(async () => {
        if (!players[targetId]) return; // player disconnected in the meantime
        players[targetId][statusKey] = false;
        players[targetId][expiryKey] = null;
        clearRestrictionTimer(targetId, type);

        await User.updateOne({ username: players[targetId].name }, { [dbKey]: null });

        const roomId = players[targetId].roomId || DEFAULT_ROOM_ID;
        io.to(roomChannel(roomId)).emit("playerStatusUpdate", {
            id:     targetId,
            muted:  players[targetId].muted,
            frozen: players[targetId].frozen
        });
        io.to(roomChannel(roomId)).emit("chatMessage", {
            name:    "System",
            message: `${players[targetId].name}'s ${type} has expired`
        });
    }, remaining);

    setRestrictionTimer(targetId, type, timer);
}

function firstRoomIdInChannel(channelId, excludeRoomId = null) {
    const match = Object.values(rooms)
        .filter(room => room.id !== excludeRoomId)
        .filter(room => (room.channelId || DEFAULT_CHANNEL_ID) === channelId)
        .sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            return a.createdAt - b.createdAt;
        })[0];

    return match?.id || null;
}

function fallbackRoomIdForClosedRoom(room) {
    ensureDefaultWorldInMemory();
    return firstRoomIdInChannel(room.channelId || DEFAULT_CHANNEL_ID, room.id) || DEFAULT_ROOM_ID;
}

function resolveJoinRoom(socket, requestedRoomId = null) {
    ensureDefaultWorldInMemory();

    const candidates = [
        typeof requestedRoomId === "string" ? rooms[requestedRoomId] : null,
        rooms[DEFAULT_ROOM_ID],
        ...Object.values(rooms)
    ].filter(Boolean);

    for (const room of candidates) {
        const channel = channels[room.channelId || DEFAULT_CHANNEL_ID];
        if (canEnterChannel(socket, channel)) return room;
    }

    return null;
}

function roomIdsInChannel(channelId) {
    return new Set(
        Object.values(rooms)
            .filter(room => (room.channelId || DEFAULT_CHANNEL_ID) === channelId)
            .map(room => room.id)
    );
}

function playerSocketIsInChannel(socket, channelId) {
    const roomIds = roomIdsInChannel(channelId);
    return roomIds.has(players[socket.id]?.roomId || DEFAULT_ROOM_ID)
        || socket.data.channelId === channelId;
}

async function removeFavoriteChannelForUser(userId, channelId) {
    await User.updateOne(
        { _id: userId },
        { $pull: { favoriteChannels: channelId } }
    );
}

async function moveUserOutOfChannel(userId, channel, notice, options = {}) {
    const targetSocket = findOnlineSocketByUserId(userId);
    if (!targetSocket) return;

    if (Array.isArray(targetSocket.data.favoriteChannels)) {
        targetSocket.data.favoriteChannels = targetSocket.data.favoriteChannels
            .filter(id => id !== channel.id);
    }
    if (options.membership) {
        targetSocket.data.channelMemberships ||= {};
        targetSocket.data.channelMemberships[channel.id] = options.membership;
    } else if (targetSocket.data.channelMemberships) {
        delete targetSocket.data.channelMemberships[channel.id];
    }

    if (players[targetSocket.id] && playerSocketIsInChannel(targetSocket, channel.id)) {
        movePlayerToRoom(targetSocket, DEFAULT_ROOM_ID, { announce: false });
    } else {
        targetSocket.emit("channelList", publicChannelsForSocket(targetSocket));
        targetSocket.emit("roomList", publicRoomsForSocket(targetSocket));
    }

    targetSocket.emit("channelModerationNotice", {
        channelId: channel.id,
        message: notice
    });
}

function publicBannedMember(membership) {
    const normalized = normalizeMembershipDoc(membership);
    return {
        userId: normalized.userId,
        username: normalized.username,
        banExpiresAt: normalized.banExpiresAt,
        bannedAt: normalized.bannedAt,
        bannedByUsername: normalized.bannedByUsername
    };
}

async function sendChannelBanList(socket, channel) {
    if (!socket || !channel || !canManageChannel(socket, channel)) return;
    const bannedMembers = await ChannelMember.find({
        channelId: channel.id,
        status: "banned"
    }).sort({ bannedAt: -1, updatedAt: -1 });

    socket.emit("channelBanList", {
        channelId: channel.id,
        bans: bannedMembers
            .map(publicBannedMember)
            .filter(member => !member.banExpiresAt || member.banExpiresAt > Date.now())
    });
}

function sendRoomState(socket, roomId) {
    const room = resolveJoinRoom(socket, roomId);
    if (!room) {
        socket.emit("roomError", { message: "No rooms are available right now." });
        socket.emit("channelList", publicChannelsForSocket(socket));
        socket.emit("roomList", publicRoomsForSocket(socket));
        return false;
    }

    const channel = channels[room.channelId || DEFAULT_CHANNEL_ID] || channels[DEFAULT_CHANNEL_ID];
    socket.data.channelId = channel.id;
    socket.emit("channelChanged", { channel: publicChannel(channel, socket) });
    socket.emit("roomChanged", { room: publicRoom(room, socket) });
    socket.emit("roomRuntime", {
        roomId: room.id,
        mode: sanitizeRoomMode(room.mode),
        modeConfig: sanitizeRoomModeConfig(room.mode, room.modeConfig)
    });
    socket.emit("roomList", publicRoomsForSocket(socket, channel.id));
    socket.emit("currentPlayers", publicPlayersSnapshot(room.id));
    return true;
}

function movePlayerToRoom(socket, roomId, { announce = true, resetPosition = true } = {}) {
    const player = players[socket.id];
    if (!player) return;

    const requestedRoom = resolveJoinRoom(socket, roomId);
    if (!requestedRoom) {
        socket.emit("roomError", { message: "No rooms are available right now." });
        return;
    }

    const targetRoomId = requestedRoom.id;
    const oldRoomId = player.roomId || socket.data.roomId || DEFAULT_ROOM_ID;

    if (oldRoomId === targetRoomId) {
        socket.join(roomChannel(targetRoomId));
        socket.data.roomId = targetRoomId;
        sendRoomState(socket, targetRoomId);
        return;
    }

    socket.leave(roomChannel(oldRoomId));
    socket.to(roomChannel(oldRoomId)).emit("playerDisconnected", socket.id);
    if (announce) {
        io.to(roomChannel(oldRoomId)).emit("chatMessage", {
            name:    "System",
            message: `${player.name} left ${rooms[oldRoomId]?.name || "the room"}`
        });
    }

    player.roomId = targetRoomId;
    player.chatBubble = "";
    player.chatTimestamp = 0;
    if (resetPosition) {
        const spawn = pickSpawnPosition(targetRoomId, 400, 300, player.size || 20);
        player.x = spawn.x;
        player.y = spawn.y;
    }

    socket.join(roomChannel(targetRoomId));
    socket.data.roomId = targetRoomId;
    sendRoomState(socket, targetRoomId);

    socket.to(roomChannel(targetRoomId)).emit("newPlayer", publicPlayer(socket.id, player));
    if (announce) {
        io.to(roomChannel(targetRoomId)).emit("chatMessage", {
            name:    "System",
            message: `${player.name} entered ${rooms[targetRoomId]?.name || requestedRoom.name || "the room"}`
        });
    }

    broadcastRoomList();
    broadcastChannelList();
    if (socket.data.userId) {
        sendFriendListsForUser(socket.data.userId).catch((e) => {
            console.error("friend presence update error:", e.message);
        });
    }
}

io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);
    ensureDefaultWorldInMemory();
    socket.data.roomId = DEFAULT_ROOM_ID;
    socket.data.channelId = DEFAULT_CHANNEL_ID;
    socket.join(roomChannel(DEFAULT_ROOM_ID));

    // Send the current player list to spectators immediately on connect.
    // This lets unauthenticated visitors see other players moving around
    // before they decide to register. They receive the same playerMoved
    // broadcasts as everyone else, so the view stays live.
    socket.emit("roomModeDefinitions", publicRoomModeDefinitions());
    socket.emit("channelList", publicChannelsForSocket(socket));
    socket.emit("roomList", publicRoomsForSocket(socket));
    sendRoomState(socket, DEFAULT_ROOM_ID);

    // A new socket just connected — spectator count goes up.
    broadcastSpectatorCount();

    // --- Event: "join" ---
    // Fired by the client after login, sending its token and starting position.
    socket.on("join", async (data = {}) => {

        // A socket may only become a player with a valid JWT. The server uses
        // the account identity from the token/DB, never a client-provided name.
        let decoded;
        try {
            if (typeof data.token !== "string" || !data.token) {
                throw new Error("Missing token");
            }
            decoded = jwt.verify(data.token, process.env.JWT_SECRET);
        } catch (e) {
            console.warn("Join rejected:", e.message);
            socket.emit("joinDenied", { message: "Please log in again." });
            return;
        }

        let user;
        try {
            user = decoded.id
                ? await User.findById(decoded.id, "username email emailVerified isAdmin canCreateRooms favoriteChannels muteRemainingMs freezeRemainingMs avatar")
                : await User.findOne(
                    { username: decoded.username },
                    "username email emailVerified isAdmin canCreateRooms favoriteChannels muteRemainingMs freezeRemainingMs avatar"
                );
        } catch (e) {
            console.error("join account lookup error:", e.message);
            socket.emit("joinDenied", { message: "Unable to load your account. Please try again." });
            return;
        }

        if (!user || typeof user.username !== "string") {
            socket.emit("joinDenied", { message: "Account not found. Please log in again." });
            return;
        }

        const name = user.username.trim().slice(0, MAX_NAME_LENGTH);
        const isAdmin = !!user.isAdmin;
        const canCreateRoomsFlag = isAdmin || !!user.canCreateRooms;

        socket.data.isAdmin = isAdmin;
        socket.data.canCreateRooms = canCreateRoomsFlag;
        socket.data.userId = String(user._id);
        socket.data.username = name;
        socket.data.favoriteChannels = Array.isArray(user.favoriteChannels)
            ? user.favoriteChannels.map(String)
            : [];

        await ensureUserDefaultMembership(user);
        await migrateFavoriteMemberships(user);
        socket.data.channelMemberships = await loadChannelMembershipMap(user._id);

        // Clamp x and y to keep the player inside the world.
        // Math.max(0, ...) prevents negative values (off the left/top edge).
        // Math.min(..., WORLD_WIDTH) prevents values beyond the right/bottom edge.
        // Number() converts the value to a number; || 400 provides a safe default
        // if the conversion fails (e.g. the client sent a string like "abc").
        const requestedX = Math.max(0, Math.min(Number(data.x) || 400, WORLD_WIDTH));
        const requestedY = Math.max(0, Math.min(Number(data.y) || 300, WORLD_HEIGHT));
        const requestedRoom = resolveJoinRoom(socket, data.roomId);
        if (!requestedRoom) {
            socket.emit("joinDenied", { message: "No rooms are available right now. Please try again." });
            return;
        }
        const roomId = requestedRoom.id;
        const spawn = pickSpawnPosition(roomId, requestedX, requestedY);

        // --- Duplicate Login Check ---
        // If this username is already connected on another socket, disconnect
        // that old session before registering the new one. This prevents two
        // copies of the same player appearing when someone opens a second tab.
        if (userSockets[name]) {
            const oldSocket = io.sockets.sockets.get(userSockets[name]);
            if (oldSocket) {
                oldSocket.emit("forcedDisconnect", "You logged in from another window.");
                oldSocket.disconnect(true);
            }
        }

        // Track which socket owns this username.
        userSockets[name] = socket.id;

        // Store this player in our server-side dictionary.
        players[socket.id] = {
            name,
            userId:         String(user._id),
            x:             spawn.x,
            y:             spawn.y,
            chatBubble:    "",
            chatTimestamp: 0,
            muted:         false,  // Muted players cannot send chat messages
            frozen:        false,  // Frozen players cannot move
            isAdmin,
            roomId,
            joinedAt:      Date.now()  // Unix timestamp — used for join-time sort on the client
        };

        // --- Restore active mute/freeze from MongoDB ---
        // The timer was paused when the player last disconnected. We resume it
        // here using the remaining milliseconds stored in their DB record.
        // -1 = permanent (no timer needed), positive = resume countdown.
        // Restore avatar color saved from a previous session.
        players[socket.id].avatar = { color: user.avatar?.color || "#4caf50" };

        if (user.muteRemainingMs !== null && user.muteRemainingMs !== undefined) {
            players[socket.id].muted = true;
            if (user.muteRemainingMs > 0) {
                players[socket.id].muteExpiresAt = Date.now() + user.muteRemainingMs;
                scheduleExpiry(socket.id, "mute");
            }
            // -1 = permanent: muted stays true, no timer set
        }
        if (user.freezeRemainingMs !== null && user.freezeRemainingMs !== undefined) {
            players[socket.id].frozen = true;
            if (user.freezeRemainingMs > 0) {
                players[socket.id].freezeExpiresAt = Date.now() + user.freezeRemainingMs;
                scheduleExpiry(socket.id, "freeze");
            }
        }

        if (roomId !== DEFAULT_ROOM_ID) {
            socket.leave(roomChannel(DEFAULT_ROOM_ID));
        }
        socket.join(roomChannel(roomId));
        socket.data.roomId = roomId;

        // Confirm verified admin status back to the joining client.
        // The client also decodes isAdmin from the JWT payload, but that
        // doesn't validate the signature. This event is the ground truth.
        socket.emit("joinConfirmed", {
            isAdmin,
            canCreateRooms: canCreateRoomsFlag,
            requiresEmail: !user.email,
            requiresEmailVerification: !!user.email && !user.emailVerified
        });

        // Send the full current player list back to THIS player only.
        // socket.emit() targets only the sender — the new player needs to
        // know about everyone already in the game.
        sendRoomState(socket, roomId);

        // Tell all OTHER connected clients that a new player has arrived.
        // socket.broadcast.emit() sends to everyone except the sender.
        socket.to(roomChannel(roomId)).emit("newPlayer", publicPlayer(socket.id, players[socket.id]));

        // If the rejoining player has an active restriction, broadcast their
        // status so all clients show the correct badges immediately.
        if (players[socket.id].muted || players[socket.id].frozen) {
            io.to(roomChannel(roomId)).emit("playerStatusUpdate", {
                id:     socket.id,
                muted:  players[socket.id].muted,
                frozen: players[socket.id].frozen
            });
        }

        // Announce in chat that this player joined.
        // io.emit() sends to ALL clients including the sender.
        io.to(roomChannel(roomId)).emit("chatMessage", {
            name: "System",
            message: `${name} entered ${rooms[roomId]?.name || requestedRoom.name || "the room"}`
        });

        // A spectator just became a player — spectator count goes down.
        broadcastSpectatorCount();
        broadcastRoomList();
        broadcastChannelList();
        sendFriendListsForUser(socket.data.userId).catch((e) => {
            console.error("friend presence update error:", e.message);
        });
    });

    socket.on("sendFriendRequest", async ({ targetId, username } = {}) => {
        const player = players[socket.id];
        if (!player || !socket.data.userId) return;

        let targetUser = null;
        try {
            if (typeof targetId === "string" && players[targetId] && !players[targetId].isBot) {
                if (players[targetId].roomId !== player.roomId) {
                    socket.emit("friendError", { message: "That player is no longer nearby." });
                    return;
                }
                targetUser = await User.findOne({ username: players[targetId].name }, "username");
            } else if (typeof username === "string" && username.trim()) {
                targetUser = await User.findOne({ username: username.trim().slice(0, MAX_NAME_LENGTH) }, "username");
            }
        } catch (e) {
            console.error("friend target lookup error:", e.message);
            socket.emit("friendError", { message: "Unable to look up that player right now." });
            return;
        }

        if (!targetUser) {
            socket.emit("friendError", { message: "Player account not found." });
            return;
        }
        if (normalizedUserId(targetUser._id) === normalizedUserId(socket.data.userId)) {
            socket.emit("friendError", { message: "You cannot add yourself." });
            return;
        }

        const pairKey = friendshipPairKey(socket.data.userId, targetUser._id);
        try {
            let friendship = await Friendship.findOne({ pairKey });
            if (friendship?.status === "accepted") {
                socket.emit("friendNotice", { message: `${targetUser.username} is already your friend.` });
            } else if (friendship?.status === "pending") {
                const currentUserIsRecipient = normalizedUserId(friendship.recipientUserId) === normalizedUserId(socket.data.userId);
                if (currentUserIsRecipient) {
                    friendship.status = "accepted";
                    await friendship.save();
                    socket.emit("friendNotice", { message: `${targetUser.username} is now your friend.` });
                    const requesterSocket = findOnlineSocketByUserId(friendship.requesterUserId);
                    if (requesterSocket) {
                        requesterSocket.emit("friendNotice", { message: `${player.name} accepted your friend request.` });
                    }
                } else {
                    socket.emit("friendNotice", { message: `Friend request already sent to ${targetUser.username}.` });
                }
            } else {
                friendship = await Friendship.create({
                    pairKey,
                    requesterUserId: socket.data.userId,
                    requesterUsername: player.name,
                    recipientUserId: targetUser._id,
                    recipientUsername: targetUser.username,
                    status: "pending"
                });
                socket.emit("friendNotice", { message: `Friend request sent to ${targetUser.username}.` });
                const targetSocket = findOnlineSocketByUserId(targetUser._id);
                if (targetSocket) {
                    targetSocket.emit("friendNotice", { message: `${player.name} sent you a friend request.` });
                }
            }

            await Promise.all([
                sendFriendList(socket),
                sendFriendListToUser(targetUser._id)
            ]);
        } catch (e) {
            console.error("sendFriendRequest error:", e.message);
            socket.emit("friendError", { message: "Unable to send friend request right now." });
        }
    });

    socket.on("respondFriendRequest", async ({ friendshipId, action } = {}) => {
        if (!players[socket.id] || !socket.data.userId) return;
        if (typeof friendshipId !== "string") return;

        try {
            const friendship = await Friendship.findById(friendshipId);
            if (!friendship || friendship.status !== "pending") {
                socket.emit("friendError", { message: "Friend request no longer exists." });
                await sendFriendList(socket);
                return;
            }
            if (normalizedUserId(friendship.recipientUserId) !== normalizedUserId(socket.data.userId)) {
                socket.emit("friendError", { message: "Only the recipient can answer that request." });
                return;
            }

            const requesterUserId = normalizedUserId(friendship.requesterUserId);
            if (action === "accept") {
                friendship.status = "accepted";
                await friendship.save();
                socket.emit("friendNotice", { message: `${friendship.requesterUsername} is now your friend.` });
                const requesterSocket = findOnlineSocketByUserId(requesterUserId);
                if (requesterSocket) {
                    requesterSocket.emit("friendNotice", { message: `${players[socket.id].name} accepted your friend request.` });
                }
            } else if (action === "decline") {
                await Friendship.deleteOne({ _id: friendship._id });
                socket.emit("friendNotice", { message: `Friend request from ${friendship.requesterUsername} declined.` });
            } else {
                socket.emit("friendError", { message: "Unknown friend action." });
                return;
            }

            await Promise.all([
                sendFriendList(socket),
                sendFriendListToUser(requesterUserId)
            ]);
        } catch (e) {
            console.error("respondFriendRequest error:", e.message);
            socket.emit("friendError", { message: "Unable to update friend request right now." });
        }
    });

    socket.on("removeFriend", async ({ friendshipId } = {}) => {
        if (!players[socket.id] || !socket.data.userId || typeof friendshipId !== "string") return;

        try {
            const friendship = await Friendship.findById(friendshipId);
            if (!friendship) {
                await sendFriendList(socket);
                return;
            }

            const isRequester = normalizedUserId(friendship.requesterUserId) === normalizedUserId(socket.data.userId);
            const isRecipient = normalizedUserId(friendship.recipientUserId) === normalizedUserId(socket.data.userId);
            if (!isRequester && !isRecipient) return;

            const otherUserId = isRequester ? friendship.recipientUserId : friendship.requesterUserId;
            await Friendship.deleteOne({ _id: friendship._id });
            socket.emit("friendNotice", { message: "Friend removed." });
            await Promise.all([
                sendFriendList(socket),
                sendFriendListToUser(otherUserId)
            ]);
        } catch (e) {
            console.error("removeFriend error:", e.message);
            socket.emit("friendError", { message: "Unable to remove friend right now." });
        }
    });

    socket.on("joinFriend", async ({ friendUserId } = {}) => {
        if (!players[socket.id] || !socket.data.userId || typeof friendUserId !== "string") return;

        try {
            const friendship = await acceptedFriendshipBetween(socket.data.userId, friendUserId);
            if (!friendship) {
                socket.emit("friendError", { message: "You can only join accepted friends." });
                return;
            }

            const friendSocket = findOnlineSocketByUserId(friendUserId);
            const friendPlayer = friendSocket ? players[friendSocket.id] : null;
            const friendRoom = friendPlayer ? rooms[friendPlayer.roomId || DEFAULT_ROOM_ID] : null;
            const friendChannel = friendRoom ? channels[friendRoom.channelId || DEFAULT_CHANNEL_ID] : null;
            if (!friendPlayer || !friendRoom || !friendChannel) {
                socket.emit("friendError", { message: "That friend is offline." });
                await sendFriendList(socket);
                return;
            }

            if (!canEnterChannel(socket, friendChannel)) {
                if (!friendChannel.isPublic) {
                    socket.emit("friendError", { message: "That friend is in a private channel." });
                    await sendFriendList(socket);
                    return;
                }
                await ensureSocketChannelMembership(socket, friendChannel, "member");
                broadcastChannelList();
            }

            movePlayerToRoom(socket, friendRoom.id);
        } catch (e) {
            if (e.code === "CHANNEL_BANNED") {
                socket.emit("friendError", { message: e.message });
                await sendFriendList(socket);
                return;
            }
            console.error("joinFriend error:", e.message);
            socket.emit("friendError", { message: "Unable to join that friend right now." });
        }
    });

    socket.on("openDirectChat", async ({ friendUserId } = {}) => {
        if (!players[socket.id] || !socket.data.userId || typeof friendUserId !== "string") return;

        try {
            const friendship = await acceptedFriendshipBetween(socket.data.userId, friendUserId);
            if (!friendship) {
                socket.emit("directError", { message: "You can only message accepted friends." });
                return;
            }

            const messages = await DirectMessage.find({
                conversationKey: friendshipPairKey(socket.data.userId, friendUserId)
            }).sort({ createdAt: -1 }).limit(50);

            socket.emit("directHistory", {
                friendUserId,
                messages: messages
                    .reverse()
                    .map(message => publicDirectMessage(message, socket.data.userId))
            });
        } catch (e) {
            console.error("openDirectChat error:", e.message);
            socket.emit("directError", { message: "Unable to load private chat right now." });
        }
    });

    socket.on("sendDirectMessage", async ({ friendUserId, body } = {}) => {
        if (!players[socket.id] || !socket.data.userId || typeof friendUserId !== "string") return;
        const messageBody = typeof body === "string"
            ? body.trim().slice(0, MAX_DIRECT_MESSAGE_LENGTH)
            : "";
        if (!messageBody) return;

        try {
            const friendship = await acceptedFriendshipBetween(socket.data.userId, friendUserId);
            if (!friendship) {
                socket.emit("directError", { message: "You can only message accepted friends." });
                return;
            }

            const conversationKey = friendshipPairKey(socket.data.userId, friendUserId);
            const message = await DirectMessage.create({
                conversationKey,
                participants: [socket.data.userId, friendUserId],
                senderUserId: socket.data.userId,
                senderUsername: players[socket.id].name,
                body: messageBody
            });

            const senderPayload = publicDirectMessage(message, socket.data.userId);
            socket.emit("directMessage", { friendUserId, message: senderPayload });

            const friendSocket = findOnlineSocketByUserId(friendUserId);
            if (friendSocket) {
                friendSocket.emit("directMessage", {
                    friendUserId: normalizedUserId(socket.data.userId),
                    message: publicDirectMessage(message, friendUserId)
                });
            }
        } catch (e) {
            console.error("sendDirectMessage error:", e.message);
            socket.emit("directError", { message: "Unable to send private message right now." });
        }
    });

    socket.on("createChannel", async ({ name, isPrivate } = {}) => {
        if (!players[socket.id]) return;

        const channelName = sanitizeChannelName(name);
        if (!channelName) {
            socket.emit("channelError", { message: "Channel name is required." });
            return;
        }

        try {
            const channel = await createChannelRecord({
                name: channelName,
                description: `${players[socket.id].name}'s OpenRealm community.`,
                ownerUserId: socket.data.userId,
                ownerName: players[socket.id].name,
                isPublic: !isPrivate
            });
            await ensureSocketChannelMembership(socket, channel, "owner");
            const room = await createRoomRecord({
                name: "General",
                description: `The main room for ${channel.name}.`,
                channelId: channel.id,
                ownerUserId: socket.data.userId,
                ownerName: players[socket.id].name
            });

            await User.updateOne(
                { _id: socket.data.userId },
                { $addToSet: { favoriteChannels: channel.id } }
            );
            socket.data.favoriteChannels = [...new Set([...favoriteChannelIds(socket), channel.id])];

            broadcastChannelList();
            broadcastRoomList();
            movePlayerToRoom(socket, room.id);
        } catch (e) {
            console.error("createChannel error:", e.message);
            socket.emit("channelError", { message: "Unable to create channel right now." });
        }
    });

    socket.on("joinChannelByCode", async ({ code } = {}) => {
        if (!players[socket.id]) return;
        const normalizedCode = typeof code === "string"
            ? code.trim().toUpperCase().replace(/\s+/g, "")
            : "";
        const channel = Object.values(channels).find(c => c.code === normalizedCode);

        if (!channel) {
            socket.emit("channelError", { message: "No active channel uses that code." });
            return;
        }

        try {
            await ensureSocketChannelMembership(socket, channel, "member");
            await User.updateOne(
                { _id: socket.data.userId },
                { $addToSet: { favoriteChannels: channel.id } }
            );
            socket.data.favoriteChannels = [...new Set([...favoriteChannelIds(socket), channel.id])];
            socket.emit("channelList", publicChannelsForSocket(socket));

            const roomId = firstRoomIdInChannel(channel.id);
            if (roomId) {
                movePlayerToRoom(socket, roomId);
            } else {
                socket.data.channelId = channel.id;
                socket.emit("channelChanged", { channel: publicChannel(channel, socket) });
                socket.emit("roomList", publicRoomsForSocket(socket, channel.id));
                socket.emit("channelError", { message: "Channel saved. It has no rooms yet." });
            }
        } catch (e) {
            if (e.code === "CHANNEL_BANNED") {
                socket.emit("channelError", { message: e.message });
                socket.emit("channelList", publicChannelsForSocket(socket));
                return;
            }
            console.error("joinChannelByCode error:", e.message);
            socket.emit("channelError", { message: "Unable to join channel right now." });
        }
    });

    socket.on("joinChannel", async ({ channelId } = {}) => {
        if (!players[socket.id]) return;
        const channel = typeof channelId === "string" ? channels[channelId] : null;

        if (!channel || !canViewChannel(socket, channel)) {
            socket.emit("channelError", { message: "That channel is no longer available." });
            broadcastChannelList();
            return;
        }
        if (!channel.isPublic && !canEnterChannel(socket, channel)) {
            socket.emit("channelError", { message: "Private channels require a channel code." });
            return;
        }

        try {
            if (!canEnterChannel(socket, channel)) {
                await ensureSocketChannelMembership(socket, channel, "member");
            }
        } catch (e) {
            if (e.code === "CHANNEL_BANNED") {
                socket.emit("channelError", { message: e.message });
                socket.emit("channelList", publicChannelsForSocket(socket));
                return;
            }
            console.error("joinChannel membership error:", e.message);
            socket.emit("channelError", { message: "Unable to join channel right now." });
            return;
        }

        const roomId = firstRoomIdInChannel(channel.id);
        if (!roomId) {
            socket.data.channelId = channel.id;
            socket.emit("channelChanged", { channel: publicChannel(channel, socket) });
            socket.emit("roomList", publicRoomsForSocket(socket, channel.id));
            socket.emit("channelError", { message: "Channel opened. Create a room to start chatting." });
            return;
        }

        movePlayerToRoom(socket, roomId);
    });

    socket.on("updateChannel", async ({ channelId, name, description, isPrivate, isPublic } = {}) => {
        if (!players[socket.id]) return;
        const channel = typeof channelId === "string" ? channels[channelId] : null;

        if (!channel) {
            socket.emit("channelError", { message: "That channel cannot be edited." });
            return;
        }
        if (!canManageChannel(socket, channel)) {
            socket.emit("channelError", { message: "Only channel admins can edit this channel." });
            return;
        }

        const channelName = sanitizeChannelName(name);
        const channelDescription = sanitizeChannelDescription(description);
        const nextIsPublic = typeof isPublic === "boolean"
            ? isPublic
            : (typeof isPrivate === "boolean" ? !isPrivate : !!channel.isPublic);
        const savedIsPublic = channel.isDefault ? true : nextIsPublic;

        if (!channelName) {
            socket.emit("channelError", { message: "Channel name is required." });
            return;
        }

        try {
            const updated = await Channel.findOneAndUpdate(
                { channelId: channel.id, isActive: true },
                {
                    $set: {
                        name: channelName,
                        description: channelDescription,
                        isPublic: savedIsPublic
                    }
                },
                { returnDocument: "after" }
            );

            if (!updated) {
                socket.emit("channelError", { message: "That channel is no longer available." });
                return;
            }

            const nextChannel = {
                ...normalizeChannelDoc(updated),
                memberCount: Number(channel.memberCount) || 0
            };
            channels[channel.id] = nextChannel;

            io.sockets.sockets.forEach((viewerSocket) => {
                if (viewerSocket.data.channelId === channel.id) {
                    viewerSocket.emit("channelChanged", {
                        channel: publicChannel(nextChannel, viewerSocket)
                    });
                }
            });

            socket.emit("channelError", { message: "Channel settings saved.", ok: true });
            broadcastChannelList();
            broadcastRoomList();
        } catch (e) {
            console.error("updateChannel error:", e.message);
            socket.emit("channelError", { message: "Unable to update channel settings right now." });
        }
    });

    socket.on("toggleFavoriteChannel", async ({ channelId } = {}) => {
        if (!players[socket.id]) return;
        const channel = typeof channelId === "string" ? channels[channelId] : null;

        if (!channel || !canViewChannel(socket, channel)) {
            socket.emit("channelError", { message: "That channel is no longer available." });
            return;
        }
        if (!canEnterChannel(socket, channel)) {
            socket.emit("channelError", { message: "Join the channel before saving it." });
            return;
        }

        const favorites = new Set(favoriteChannelIds(socket));
        const isFavorite = favorites.has(channel.id);

        try {
            if (isFavorite) {
                favorites.delete(channel.id);
                await User.updateOne(
                    { _id: socket.data.userId },
                    { $pull: { favoriteChannels: channel.id } }
                );
            } else {
                favorites.add(channel.id);
                await User.updateOne(
                    { _id: socket.data.userId },
                    { $addToSet: { favoriteChannels: channel.id } }
                );
            }

            socket.data.favoriteChannels = [...favorites];
            socket.emit("channelList", publicChannelsForSocket(socket));
        } catch (e) {
            console.error("toggleFavoriteChannel error:", e.message);
            socket.emit("channelError", { message: "Unable to update favorites right now." });
        }
    });

    socket.on("deleteChannel", async ({ channelId } = {}) => {
        if (!players[socket.id]) return;
        const channel = typeof channelId === "string" ? channels[channelId] : null;

        if (!channel || channel.isDefault) {
            socket.emit("channelError", { message: "That channel cannot be deleted." });
            return;
        }
        if (!canDeleteChannel(socket, channel)) {
            socket.emit("channelError", { message: "Only the channel owner can delete that channel." });
            return;
        }

        const channelRoomIds = new Set(
            Object.values(rooms)
                .filter(room => (room.channelId || DEFAULT_CHANNEL_ID) === channel.id)
                .map(room => room.id)
        );
        const socketsToMove = [...io.sockets.sockets.values()].filter((roomSocket) => {
            const player = players[roomSocket.id];
            return !!player && (
                channelRoomIds.has(player.roomId || DEFAULT_ROOM_ID)
                || roomSocket.data.channelId === channel.id
            );
        });
        const botsToRemove = Object.entries(players)
            .filter(([, player]) => player.isBot && channelRoomIds.has(player.roomId || DEFAULT_ROOM_ID))
            .map(([id]) => id);

        try {
            const channelUpdate = await Channel.updateOne(
                { channelId: channel.id },
                { isActive: false }
            );
            if (channelUpdate.matchedCount === 0) {
                throw new Error("Channel document was not found");
            }
            await Room.updateMany(
                { channelId: channel.id },
                { isActive: false }
            );
            await ChannelMember.deleteMany({ channelId: channel.id });
            await User.updateMany(
                { favoriteChannels: channel.id },
                { $pull: { favoriteChannels: channel.id } }
            );

            io.sockets.sockets.forEach((roomSocket) => {
                if (Array.isArray(roomSocket.data.favoriteChannels)) {
                    roomSocket.data.favoriteChannels = roomSocket.data.favoriteChannels
                        .filter(id => id !== channel.id);
                }
                if (roomSocket.data.channelMemberships) {
                    delete roomSocket.data.channelMemberships[channel.id];
                }
            });

            botsToRemove.forEach(removeBot);
            socketsToMove.forEach((roomSocket) => {
                movePlayerToRoom(roomSocket, DEFAULT_ROOM_ID, { announce: false });
                roomSocket.emit("channelDeleted", {
                    channelId: channel.id,
                    message: `${channel.name} was deleted. You were moved to Town Square.`
                });
            });

            for (const roomId of channelRoomIds) {
                delete rooms[roomId];
            }
            delete channels[channel.id];

            io.to(roomChannel(DEFAULT_ROOM_ID)).emit("chatMessage", {
                name: "System",
                message: `${players[socket.id]?.name || "The owner"} deleted ${channel.name}`
            });
            broadcastRoomList();
            broadcastChannelList();
        } catch (e) {
            console.error("deleteChannel error:", e.message);
            socket.emit("channelError", { message: "Unable to delete channel right now." });
        }
    });

    socket.on("channelModerationAction", async ({ targetId, action, duration } = {}) => {
        if (!players[socket.id] || !socket.data.userId) return;
        const target = typeof targetId === "string" ? players[targetId] : null;
        if (!target || target.isBot || targetId === socket.id) {
            socket.emit("channelError", { message: "That player cannot be moderated." });
            return;
        }

        const roomId = target.roomId || DEFAULT_ROOM_ID;
        const room = rooms[roomId];
        const channel = channels[room?.channelId || DEFAULT_CHANNEL_ID];
        if (!channel || channel.isDefault) {
            socket.emit("channelError", { message: "Channel moderation is only available in user-created channels." });
            return;
        }
        if (!canManageChannel(socket, channel)) {
            socket.emit("channelError", { message: "Only channel admins can do that." });
            return;
        }
        if (players[socket.id]?.roomId !== roomId) {
            socket.emit("channelError", { message: "That player is no longer in your room." });
            return;
        }

        const targetMembershipDoc = await ChannelMember.findOne({
            channelId: channel.id,
            userId: target.userId
        });
        if (!targetMembershipDoc) {
            socket.emit("channelError", { message: "That player is not a channel member." });
            return;
        }
        const targetMembership = normalizeMembershipDoc(targetMembershipDoc);
        if (!canModerateChannelMember(socket, channel, targetMembership)) {
            socket.emit("channelError", { message: "You cannot moderate that channel member." });
            return;
        }

        try {
            if (action === "kick") {
                if (channel.isPublic) {
                    socket.emit("channelError", { message: "Kick is only available for private channels. Use ban for public channels." });
                    return;
                }

                await ChannelMember.deleteOne({ _id: targetMembershipDoc._id });
                await removeFavoriteChannelForUser(target.userId, channel.id);
                await refreshChannelMemberCount(channel.id);
                await moveUserOutOfChannel(
                    target.userId,
                    channel,
                    `You were kicked from ${channel.name}.`
                );

                io.to(roomChannel(DEFAULT_ROOM_ID)).emit("chatMessage", {
                    name: "System",
                    message: `${target.name} was kicked from ${channel.name}`
                });
            } else if (action === "ban") {
                const minutes = normalizeChannelBanDuration(duration);
                const banExpiresAt = minutes ? new Date(Date.now() + minutes * 60 * 1000) : null;
                const updated = await ChannelMember.findOneAndUpdate(
                    { _id: targetMembershipDoc._id },
                    {
                        $set: {
                            status: "banned",
                            banExpiresAt,
                            bannedAt: new Date(),
                            bannedByUserId: socket.data.userId,
                            bannedByUsername: players[socket.id].name
                        }
                    },
                    { returnDocument: "after" }
                );
                const bannedMembership = normalizeMembershipDoc(updated);

                await removeFavoriteChannelForUser(target.userId, channel.id);
                await refreshChannelMemberCount(channel.id);
                await moveUserOutOfChannel(
                    target.userId,
                    channel,
                    banExpiresAt
                        ? `You were banned from ${channel.name} until ${banExpiresAt.toLocaleString()}.`
                        : `You were permanently banned from ${channel.name}.`,
                    { membership: bannedMembership }
                );

                const durationLabel = minutes ? ` for ${minutes} minute${minutes === 1 ? "" : "s"}` : " permanently";
                io.to(roomChannel(DEFAULT_ROOM_ID)).emit("chatMessage", {
                    name: "System",
                    message: `${target.name} was banned from ${channel.name}${durationLabel}`
                });
            } else {
                socket.emit("channelError", { message: "Unknown channel moderation action." });
                return;
            }

            socket.emit("channelList", publicChannelsForSocket(socket));
            broadcastRoomList();
            broadcastChannelList();
            await sendChannelBanList(socket, channel);
        } catch (e) {
            console.error("channelModerationAction error:", e.message);
            socket.emit("channelError", { message: "Unable to update channel moderation right now." });
        }
    });

    socket.on("getChannelBanList", async ({ channelId } = {}) => {
        if (!players[socket.id]) return;
        const channel = typeof channelId === "string" ? channels[channelId] : null;
        if (!channel || !canManageChannel(socket, channel)) {
            socket.emit("channelError", { message: "Only channel admins can view the ban list." });
            return;
        }

        try {
            await sendChannelBanList(socket, channel);
        } catch (e) {
            console.error("getChannelBanList error:", e.message);
            socket.emit("channelError", { message: "Unable to load bans right now." });
        }
    });

    socket.on("unbanChannelMember", async ({ channelId, userId } = {}) => {
        if (!players[socket.id]) return;
        const channel = typeof channelId === "string" ? channels[channelId] : null;
        if (!channel || !canManageChannel(socket, channel)) {
            socket.emit("channelError", { message: "Only channel admins can unban members." });
            return;
        }

        try {
            const membershipDoc = await ChannelMember.findOne({ channelId: channel.id, userId });
            if (!membershipDoc || membershipDoc.status !== "banned") {
                socket.emit("channelError", { message: "That ban is no longer active." });
                await sendChannelBanList(socket, channel);
                return;
            }

            const membership = normalizeMembershipDoc(membershipDoc);
            if (!canModerateChannelMember(socket, channel, membership)) {
                socket.emit("channelError", { message: "You cannot unban that member." });
                return;
            }

            await ChannelMember.updateOne(
                { _id: membershipDoc._id },
                {
                    $set: {
                        status: "active",
                        banExpiresAt: null,
                        bannedAt: null,
                        bannedByUserId: null,
                        bannedByUsername: ""
                    }
                }
            );
            await refreshChannelMemberCount(channel.id);

            const targetSocket = findOnlineSocketByUserId(userId);
            if (targetSocket) {
                targetSocket.data.channelMemberships ||= {};
                targetSocket.data.channelMemberships[channel.id] = {
                    ...membership,
                    status: "active",
                    banExpiresAt: null,
                    bannedAt: null,
                    bannedByUserId: null,
                    bannedByUsername: ""
                };
                targetSocket.emit("channelList", publicChannelsForSocket(targetSocket));
                targetSocket.emit("channelModerationNotice", {
                    channelId: channel.id,
                    message: `You were unbanned from ${channel.name}.`
                });
            }

            socket.emit("channelError", { message: `${membership.username} was unbanned from ${channel.name}.` });
            await sendChannelBanList(socket, channel);
            broadcastChannelList();
        } catch (e) {
            console.error("unbanChannelMember error:", e.message);
            socket.emit("channelError", { message: "Unable to unban that member right now." });
        }
    });

    socket.on("updateRoomModeConfig", async ({ roomId, mode, modeConfig } = {}) => {
        if (!players[socket.id]) return;
        const room = typeof roomId === "string" ? rooms[roomId] : null;
        if (!room) {
            socket.emit("roomError", { message: "That room is no longer available." });
            return;
        }
        if (!canCustomizeRoom(socket, room)) {
            socket.emit("roomError", { message: "Only channel admins can customize this room." });
            return;
        }

        const nextMode = sanitizeRoomMode(mode);
        const nextConfig = sanitizeRoomModeConfig(nextMode, modeConfig);

        try {
            await Room.updateOne(
                { roomId: room.id },
                { $set: { mode: nextMode, modeConfig: nextConfig } }
            );

            rooms[room.id] = {
                ...room,
                mode: nextMode,
                modeConfig: nextConfig
            };

            io.sockets.sockets.forEach((roomSocket) => {
                if (players[roomSocket.id]?.roomId !== room.id) return;
                roomSocket.emit("roomChanged", {
                    room: publicRoom(rooms[room.id], roomSocket)
                });
                roomSocket.emit("roomRuntime", {
                    roomId: room.id,
                    mode: nextMode,
                    modeConfig: nextConfig
                });
            });
            io.to(roomChannel(room.id)).emit("chatMessage", {
                name: "System",
                message: `${players[socket.id]?.name || "A channel admin"} updated the room mode`
            });
            broadcastRoomList();
            broadcastChannelList();
        } catch (e) {
            console.error("updateRoomModeConfig error:", e.message);
            socket.emit("roomError", { message: "Unable to update room customization right now." });
        }
    });

    socket.on("updateRoom", async ({ roomId, name, description, mode, modeConfig } = {}) => {
        if (!players[socket.id]) return;
        const room = typeof roomId === "string" ? rooms[roomId] : null;
        if (!room) {
            socket.emit("roomError", { message: "That room is no longer available." });
            return;
        }
        if (!canCustomizeRoom(socket, room)) {
            socket.emit("roomError", { message: "Only channel admins can edit this room." });
            return;
        }

        const roomName = sanitizeRoomName(name);
        const roomDescription = sanitizeRoomDescription(description);
        const nextMode = sanitizeRoomMode(mode || room.mode);
        const nextConfig = sanitizeRoomModeConfig(
            nextMode,
            modeConfig && typeof modeConfig === "object" ? modeConfig : room.modeConfig
        );

        if (!roomName) {
            socket.emit("roomError", { message: "Room name is required." });
            return;
        }

        try {
            const updated = await Room.findOneAndUpdate(
                { roomId: room.id, isActive: true },
                {
                    $set: {
                        name: roomName,
                        description: roomDescription,
                        mode: nextMode,
                        modeConfig: nextConfig
                    }
                },
                { returnDocument: "after" }
            );

            if (!updated) {
                socket.emit("roomError", { message: "That room is no longer available." });
                return;
            }

            rooms[room.id] = normalizeRoomDoc(updated);

            io.sockets.sockets.forEach((roomSocket) => {
                if (players[roomSocket.id]?.roomId !== room.id) return;
                roomSocket.emit("roomChanged", {
                    room: publicRoom(rooms[room.id], roomSocket)
                });
                roomSocket.emit("roomRuntime", {
                    roomId: room.id,
                    mode: nextMode,
                    modeConfig: nextConfig
                });
            });
            io.to(roomChannel(room.id)).emit("chatMessage", {
                name: "System",
                message: `${players[socket.id]?.name || "A channel admin"} updated ${roomName}`
            });

            socket.emit("roomError", { message: "Room settings saved.", ok: true });
            broadcastRoomList();
            broadcastChannelList();
        } catch (e) {
            console.error("updateRoom error:", e.message);
            socket.emit("roomError", { message: "Unable to update room settings right now." });
        }
    });

    socket.on("createRoom", async ({ name, description, mode, modeConfig, channelId } = {}) => {
        if (!players[socket.id]) return;

        const roomName = sanitizeRoomName(name);
        const roomDescription = sanitizeRoomDescription(description);
        const roomMode = sanitizeRoomMode(mode);
        if (!roomName) {
            socket.emit("roomError", { message: "Room name is required." });
            return;
        }

        const targetChannelId = typeof channelId === "string" && channels[channelId]
            ? channelId
            : socket.data.channelId || rooms[players[socket.id].roomId]?.channelId || DEFAULT_CHANNEL_ID;
        const channel = channels[targetChannelId] || channels[DEFAULT_CHANNEL_ID];
        if (!canEnterChannel(socket, channel)) {
            socket.emit("roomError", { message: "That channel is no longer available." });
            return;
        }
        if (!canManageRooms(socket, channel)) {
            socket.emit("roomError", { message: "Only the channel owner can create rooms here." });
            return;
        }

        try {
            const room = await createRoomRecord({
                name: roomName,
                description: roomDescription,
                mode: roomMode,
                modeConfig: sanitizeRoomModeConfig(roomMode, modeConfig),
                channelId: channel.id,
                ownerUserId: socket.data.userId,
                ownerName: players[socket.id].name
            });
            broadcastRoomList();
            movePlayerToRoom(socket, room.id);
        } catch (e) {
            console.error("createRoom error:", e.message);
            socket.emit("roomError", { message: "Unable to create room right now." });
        }
    });

    socket.on("joinRoom", ({ roomId } = {}) => {
        if (!players[socket.id]) return;
        if (typeof roomId !== "string" || !rooms[roomId]) {
            socket.emit("roomError", { message: "That room is no longer available." });
            broadcastRoomList();
            return;
        }
        if (!canEnterChannel(socket, channels[rooms[roomId].channelId || DEFAULT_CHANNEL_ID])) {
            socket.emit("roomError", { message: "Join that channel before entering its rooms." });
            return;
        }

        movePlayerToRoom(socket, roomId);
    });

    socket.on("closeRoom", async ({ roomId } = {}) => {
        if (!players[socket.id]) return;
        const room = typeof roomId === "string" ? rooms[roomId] : null;

        if (!room || room.isDefault) {
            socket.emit("roomError", { message: "That room cannot be closed." });
            return;
        }
        if (!canManageRoom(socket, room)) {
            socket.emit("roomError", { message: "Only the channel owner can close rooms here." });
            return;
        }

        try {
            const fallbackRoomId = fallbackRoomIdForClosedRoom(room);
            await Room.updateOne({ roomId: room.id }, { isActive: false });

            for (const [id, player] of Object.entries(players)) {
                if (player.isBot && player.roomId === room.id) {
                    removeBot(id);
                }
            }

            const socketsToMove = [...io.sockets.sockets.values()].filter(
                s => players[s.id]?.roomId === room.id
            );

            socketsToMove.forEach((roomSocket) => {
                movePlayerToRoom(roomSocket, fallbackRoomId, { announce: false });
                roomSocket.emit("roomClosed", { message: `${room.name} was closed.` });
            });

            delete rooms[room.id];
            io.to(roomChannel(fallbackRoomId)).emit("chatMessage", {
                name: "System",
                message: `${players[socket.id]?.name || "A moderator"} closed ${room.name}`
            });
            broadcastRoomList();
            broadcastChannelList();
        } catch (e) {
            console.error("closeRoom error:", e.message);
            socket.emit("roomError", { message: "Unable to close room right now." });
        }
    });

    socket.on("leaveRoom", () => {
        if (!players[socket.id]) return;
        movePlayerToRoom(socket, DEFAULT_ROOM_ID);
    });

    // --- Event: "playerMove" ---
    // Fired by the client whenever the player's position changes.
    // We update the server's record and relay the new position to
    // all other players so their screens stay in sync.
    socket.on("playerMove", (data) => {
        // Guard: make sure this socket has a registered player and is not frozen.
        if (players[socket.id] && !players[socket.id].frozen) {
            // Clamp the incoming coordinates to valid world bounds,
            // just like we did in "join" — clients could send anything.
            const x = Math.max(0, Math.min(Number(data.x) || 0, WORLD_WIDTH));
            const y = Math.max(0, Math.min(Number(data.y) || 0, WORLD_HEIGHT));

            // Update the server's authoritative record of this player's position.
            players[socket.id].x = x;
            players[socket.id].y = y;

            // Relay the new position to everyone else.
            // We use socket.broadcast.emit (not io.emit) because the moving
            // player already updated their own position locally on the client —
            // there's no need to send it back to them.
            socket.to(roomChannel(players[socket.id].roomId || DEFAULT_ROOM_ID)).emit("playerMoved", {
                id: socket.id,
                x,
                y
            });
        }
    });

    // --- Event: "chatMessage" ---
    // Fired when a player sends a chat message.
    socket.on("chatMessage", (data) => {
        // Guard: ignore messages from sockets that haven't joined or are muted.
        if (!players[socket.id]) return;
        if (players[socket.id].muted) return;

        // Sanitize the message: must be a string, trimmed, max 200 characters.
        // This prevents spam, XSS attempts, or oversized payloads.
        const message = typeof data.message === "string"
            ? data.message.trim().slice(0, 200)
            : "";

        // If the message is empty after sanitization, ignore it entirely.
        if (!message) return;

        // Use the server's stored name rather than any name the client sent.
        // This prevents a player from faking another player's name in chat.
        const name = players[socket.id].name;
        const roomId = players[socket.id].roomId || DEFAULT_ROOM_ID;

        // Store the message on the player so the chat bubble can be drawn.
        players[socket.id].chatBubble = message;
        players[socket.id].chatTimestamp = Date.now();

        // Broadcast the message to all clients (including the sender so
        // their own chat log and bubble update correctly).
        io.to(roomChannel(roomId)).emit("chatMessage", {
            id: socket.id,
            name,
            message,
            timestamp: Date.now()
        });

        // --- Bot @mention replies ---
        // If the message contains @BotName matching a live bot, the bot
        // replies with a random message after a short natural-feeling delay.
        const BOT_REPLIES = [
            "Hi!", "Hello there!", "Hey!", "Greetings!",
            "Oh, you talking to me?", "Beep boop.", "...",
            "What do you want?", "I'm just a bot!",
            "👋", "Leave me alone, I'm wandering."
        ];

        const mentions = [...message.matchAll(/@(\S+)/g)].map(m => m[1].toLowerCase());
        mentions.forEach(mentioned => {
            const botEntry = Object.entries(players).find(
                ([, p]) => p.isBot && p.roomId === roomId && p.name.toLowerCase() === mentioned
            );
            if (!botEntry) return;
            const [botId, bot] = botEntry;
            if (bot.muted) return;
            const reply = BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
            setTimeout(() => {
                if (!players[botId]) return;
                players[botId].chatBubble    = reply;
                players[botId].chatTimestamp = Date.now();
                io.to(roomChannel(roomId)).emit("chatMessage", {
                    id:        botId,
                    name:      bot.name,
                    message:   reply,
                    timestamp: Date.now()
                });
            }, 800 + Math.random() * 1000);
        });
    });

    // --- Event: "spawnBot" ---
    // Admin places a bot at a specific canvas position.
    socket.on("spawnBot", ({ x, y }) => {
        if (!players[socket.id]) return;
        const roomId = players[socket.id].roomId || DEFAULT_ROOM_ID;
        const channel = channels[rooms[roomId]?.channelId || DEFAULT_CHANNEL_ID];
        if (!canManageRooms(socket, channel)) return;
        const cx = Math.max(0, Math.min(Number(x) || 0, WORLD_WIDTH));
        const cy = Math.max(0, Math.min(Number(y) || 0, WORLD_HEIGHT));
        const botId = createBot(cx, cy, roomId);
        const adminName = players[socket.id]?.name || "Admin";
        io.to(roomChannel(roomId)).emit("chatMessage", {
            name: "System",
            message: `${adminName} created ${players[botId].name}`
        });
    });

    // --- Event: "removeBot" ---
    // Admin removes a bot by its ID.
    socket.on("removeBot", ({ botId }) => {
        if (!players[botId]) return;
        const roomId = players[botId].roomId || DEFAULT_ROOM_ID;
        const channel = channels[rooms[roomId]?.channelId || DEFAULT_CHANNEL_ID];
        if (!canManageRooms(socket, channel)) return;
        if (players[socket.id]?.roomId !== roomId) return;
        const adminName = players[socket.id]?.name || "Admin";
        const botName   = players[botId].name;
        removeBot(botId);
        io.to(roomChannel(roomId)).emit("chatMessage", {
            name: "System",
            message: `${adminName} removed ${botName}`
        });
    });

    // --- Event: "adminAction" ---
    // Sent by admin clients to mute, unmute, freeze, or unfreeze a player.
    // Optional `duration` (minutes) auto-reverses mute/freeze after that time.
    // Timed actions are persisted to MongoDB so the timer pauses between sessions —
    // re-logging resumes the countdown from where it left off, not from zero.
    // `duration` null = permanent; omitted entirely for unmute/unfreeze.
    // We verify isAdmin server-side — the client's claim alone is never trusted.
    socket.on("adminAction", async ({ targetId, action, duration }) => {
        if (!players[targetId]) return;
        const roomId = players[targetId].roomId || DEFAULT_ROOM_ID;
        const channel = channels[rooms[roomId]?.channelId || DEFAULT_CHANNEL_ID];
        if (!canModerateChannel(socket, channel)) return;
        if (players[socket.id]?.roomId !== roomId) return;

        // Note whether a timed restriction was active before we clear it —
        // used below to include a "timer cleared" note in the chat message.
        const hadActiveTimer = (action === "unmute"   && hasRestrictionTimer(targetId, "mute"))
                            || (action === "unfreeze" && hasRestrictionTimer(targetId, "freeze"));

        // Clear any existing auto-expire timer for this status type before changing it.
        if (action === "mute" || action === "unmute") {
            clearRestrictionTimer(targetId, "mute");
            players[targetId].muteExpiresAt = null;
        }
        if (action === "freeze" || action === "unfreeze") {
            clearRestrictionTimer(targetId, "freeze");
            players[targetId].freezeExpiresAt = null;
        }

        if      (action === "mute")     players[targetId].muted  = true;
        else if (action === "unmute")   players[targetId].muted  = false;
        else if (action === "freeze")   players[targetId].frozen = true;
        else if (action === "unfreeze") players[targetId].frozen = false;
        else return;

        // Persist to MongoDB for real players so the restriction survives re-logins.
        // Bots have no DB record, so we skip them.
        if (!players[targetId].isBot) {
            const isMuteType = action === "mute"   || action === "unmute";
            const isRemoving = action === "unmute" || action === "unfreeze";
            const dbKey      = isMuteType ? "muteRemainingMs" : "freezeRemainingMs";
            // null = cleared, -1 = permanent sentinel, positive = ms remaining
            const dbValue    = isRemoving ? null
                             : duration   ? duration * 60 * 1000
                             :              -1;
            try {
                await User.updateOne({ username: players[targetId].name }, { [dbKey]: dbValue });
            } catch (e) {
                console.error("adminAction DB error:", e.message);
            }
        }

        // Broadcast the updated status to every client so badges update live.
        io.to(roomChannel(roomId)).emit("playerStatusUpdate", {
            id:     targetId,
            muted:  players[targetId].muted,
            frozen: players[targetId].frozen
        });

        // Announce the action in chat so everyone can see it.
        const adminName  = players[socket.id]?.name  || "Admin";
        const targetName = players[targetId]?.name   || "Player";
        const pastTense  = { mute: "muted", unmute: "unmuted", freeze: "froze", unfreeze: "unfroze" };
        const durationLabel   = duration       ? ` for ${duration} minute${duration === 1 ? "" : "s"}` : "";
        const timerClearedNote = hadActiveTimer ? " (timer cleared)" : "";
        io.to(roomChannel(roomId)).emit("chatMessage", {
            name: "System",
            message: `${adminName} ${pastTense[action]} ${targetName}${durationLabel}${timerClearedNote}`
        });

        // Schedule auto-expiry for timed mute/freeze (not permanent).
        if (duration && (action === "mute" || action === "freeze")) {
            const expiryKey = action === "mute" ? "muteExpiresAt" : "freezeExpiresAt";
            players[targetId][expiryKey] = Date.now() + duration * 60 * 1000;
            scheduleExpiry(targetId, action);
        }
    });

    // --- Event: "updateAvatar" ---
    // Sent when a player picks a new avatar color from the swatch panel.
    // We validate the hex value server-side before saving to prevent injection,
    // update the in-memory player, persist to MongoDB, and broadcast to all
    // clients so the change is visible to everyone immediately.
    socket.on("updateAvatar", async ({ color }) => {
        if (!players[socket.id]) return;
        if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return;

        players[socket.id].avatar = { color };

        try {
            await User.updateOne({ username: players[socket.id].name }, { "avatar.color": color });
        } catch (e) {
            console.error("updateAvatar DB error:", e.message);
        }

        io.to(roomChannel(players[socket.id].roomId || DEFAULT_ROOM_ID)).emit("playerAvatarUpdate", { id: socket.id, avatar: { color } });
    });

    // --- Event: "getProfile" ---
    // Any logged-in player can request the public profile of another player.
    // We respond only to the requester (socket.emit, not io.emit) with:
    //   - name, avatar colour, joinedAt (from live players dict)
    //   - createdAt (from MongoDB — when they registered their account)
    // Bots don't have a DB record, so we return a simplified profile for them.
    socket.on("getProfile", async ({ targetId }) => {
        if (!players[socket.id]) return; // Must be logged in to view profiles
        const target = players[targetId];
        if (!target) return;
        if (target.roomId !== players[socket.id].roomId) return;

        // Base profile from the live players dictionary.
        const profile = {
            id:       targetId,
            name:     target.name,
            avatar:   target.avatar || { color: target.isBot ? "#ffa726" : "#4caf50" },
            joinedAt: target.joinedAt,
            isBot:    target.isBot || false,
            createdAt: null
        };

        // For real players, look up their registration date from MongoDB.
        if (!target.isBot) {
            try {
                const user = await User.findOne({ username: target.name }, "createdAt");
                if (user) profile.createdAt = user.createdAt;
            } catch (e) {
                console.error("getProfile DB error:", e.message);
            }
        }

        socket.emit("profileData", profile);
    });

    // --- Event: "disconnect" ---
    // Fires automatically when a player closes their browser tab,
    // loses connection, or navigates away.
    socket.on("disconnect", () => {
        const roomId = players[socket.id]?.roomId || socket.data.roomId || DEFAULT_ROOM_ID;

        // If the player had joined, announce their departure in chat.
        if (players[socket.id]) {
            io.to(roomChannel(roomId)).emit("chatMessage", {
                name: "System",
                message: `${players[socket.id].name} left ${rooms[roomId]?.name || "the room"}`
            });
        }

        console.log("Player disconnected:", socket.id);

        // Pause timed mute/freeze: write the remaining ms back to MongoDB so the
        // countdown resumes from where it left off when the player rejoins.
        if (players[socket.id] && !players[socket.id].isBot) {
            const p = players[socket.id];
            const updates = {};

            if (hasRestrictionTimer(socket.id, "mute") && p.muteExpiresAt) {
                updates.muteRemainingMs = Math.max(0, p.muteExpiresAt - Date.now());
            }
            if (hasRestrictionTimer(socket.id, "freeze") && p.freezeExpiresAt) {
                updates.freezeRemainingMs = Math.max(0, p.freezeExpiresAt - Date.now());
            }

            if (Object.keys(updates).length) {
                User.updateOne({ username: p.name }, updates).catch(() => {});
            }

            clearAllRestrictionTimers(socket.id);
        }

        // Remove them from the server's player dictionary so they
        // no longer take up memory or appear in currentPlayers snapshots.
        delete players[socket.id];

        // Clean up the username → socket mapping, but only if it still
        // points to this socket. If a duplicate login already replaced it
        // with a new socket ID, we don't want to wipe that newer entry.
        for (const [username, sid] of Object.entries(userSockets)) {
            if (sid === socket.id) {
                delete userSockets[username];
                break;
            }
        }

        // Tell all clients to remove this player from their local state.
        io.to(roomChannel(roomId)).emit("playerDisconnected", socket.id);

        // Someone left — recalculate the spectator count.
        broadcastSpectatorCount();
        broadcastRoomList();
        broadcastChannelList();
        if (socket.data.userId) {
            sendFriendListsForUser(socket.data.userId, false).catch((e) => {
                console.error("friend presence update error:", e.message);
            });
        }
    });
});

// --- Start the Server ---
// Begin listening for incoming connections on the specified port.
// The callback runs once the server is ready.
server.listen(PORT, () => {
    console.log(`OpenRealm server running at http://localhost:${PORT}`);
});
