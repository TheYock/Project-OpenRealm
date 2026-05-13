# OpenRealm

Version: `0.2.2`

OpenRealm is a browser-based multiplayer social game where players can log in, enter live rooms, chat, customize their avatar color, and move around a shared 2D canvas world.

The project is moving toward a Discord-like social structure: public channels contain individual rooms, users can browse, join, and favorite channels, and channel owners can shape their own communities.

## Current Features

- Real-time multiplayer presence with Socket.IO
- Account registration with username/email/password, login with username or email, and email verification
- Legacy account email prompt for users created before email collection
- Spectator mode before login
- Canvas movement with click-to-move
- Room-scoped players, chat, movement, bots, moderation, and profile lookups
- Public channels shown in a left sidebar
- Channel favorites saved per user
- Searchable public channel browser
- Channel home panel with owner, description, rooms, member count, online count, and join/save actions
- Channel membership and channel-scoped roles
- Expandable channel navigation with selectable rooms inside each channel
- Public and private channels with shareable channel codes
- Friends list with pending requests, online presence, and join-friend shortcuts
- Private one-to-one messages between accepted friends
- Owner-only channel deletion with automatic room cleanup
- Optional room descriptions with expandable room info panels
- Room modes for social, watch, game, and custom room concepts
- Owner-only room creation and close-room controls
- Channel-scoped mute, freeze, spawn-bot, and remove-bot actions
- Avatar color customization saved to MongoDB
- Responsive desktop/mobile layout

## Accounts

New accounts require a username, valid email, and password. Registration creates an email verification token and sends the player into the game with a verification banner.

Login accepts either username or email with the account password. Older accounts created before email support are prompted to add a valid email after authentication.

In local development, verification links are printed to the server console:

```text
[email verification] Username: http://localhost:3000/api/verify-email?token=...
```

Set `PUBLIC_URL` in `.env` when testing behind a tunnel or deployed host so generated links use the public address.

## Channels And Rooms

OpenRealm now uses a `channel -> room` structure.

- Channels are public containers shown in the left sidebar.
- Users can browse and search public channels before joining.
- Selecting a channel opens its channel home, where users can preview public rooms and community details.
- Users must join a channel before entering its rooms or chatting there.
- Users can favorite joined channels for quick access.
- Channels can be expanded in the left sidebar to show their rooms.
- Rooms are selected from inside their channel.
- Room names can be clicked to show full details, description, owner, and live player/bot counts.
- Rooms can start as social, watch, game, or custom mode rooms.
- Private channels are joined with a channel code, then their rooms can be explored from the sidebar.
- Creating a channel automatically creates a `General` room.
- Closing a room moves players to another public room in the same channel when possible, otherwise back to Town Square.
- Only channel owners can create or close rooms inside user-created channels.
- Channel owners can delete their own non-default channels, which removes all rooms in that channel and moves active players back to Town Square.

The default channel is `OpenRealm`, and the default room is `Town Square`.

## Friends And Private Messages

Logged-in players can right-click another real player in the online list or on the canvas to send a friend request. Incoming requests appear in the top-bar Friends drawer, where they can be accepted or declined.

Accepted friends show whether they are online and where they are playing. Public channels and joined private channels show the channel and room name with a Join action. If a friend is inside a private channel the viewer has not joined, the location is shown as `Private Channel` and Join is disabled.

The Messages tab opens one-to-one private chats with accepted friends. Direct messages are saved in MongoDB and the latest conversation history loads when a friend chat is opened.

## Permissions

Any logged-in user can create a channel.

Channel owners can create and close rooms inside their channel. The default `OpenRealm` channel is system-owned, so global admins can manage rooms there.

Channel membership roles are stored as `owner`, `admin`, `moderator`, or `member`. The role assignment UI is still upcoming, but the server now uses these roles for channel-scoped moderation checks. Deleting a channel and changing its room structure are owner-only and do not apply to the default `OpenRealm` channel.

```bash
node makeAdmin.js <username>
node setRoomCreator.js <username> on
node setRoomCreator.js <username> off
```

## Getting Started

Install dependencies:

```bash
npm install
```

Create a `.env` file:

```bash
MONGODB_URI=<your MongoDB connection string>
JWT_SECRET=<your JWT secret>
PUBLIC_URL=http://localhost:3000
PORT=3000
```

Start the server:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Useful Scripts

```bash
npm start
node makeAdmin.js <username>
node setRoomCreator.js <username> on
node setRoomCreator.js <username> off
```

## Project Structure

```text
server.js              Express, Socket.IO, world state, channels, rooms
public/index.html      Browser UI layout
public/game.js         Client game, socket, canvas, channel and room UI logic
public/auth.js         Login/register client logic
models/User.js         User accounts, permissions, favorites, avatar data
models/Channel.js      Public channel containers
models/ChannelMember.js Channel membership, roles, and membership status
models/Room.js         Joinable rooms inside channels
models/Friendship.js   Friend requests and accepted friend relationships
models/DirectMessage.js Private one-to-one chat messages
routes/auth.js         Register/login API routes
makeAdmin.js           Grants admin and creation privileges
setRoomCreator.js      Grants/revokes creation privileges only
```

## Version 0.2.2 Notes

- Added friends, pending friend requests, friend presence, and join-friend shortcuts.
- Added private direct messages between accepted friends.
- Private friend locations now hide channel/room names unless the viewer has channel access.
- Added top-bar Friends and DMs drawers.
- Added right-click Add Friend and Message actions for real players.

## Version 0.2.1 Notes

- Added persistent public channels.
- Added channel favorites.
- Added a searchable public channel browser and channel home preview panel.
- Added an expandable left channel sidebar.
- Added channel access codes for private channel discovery.
- Added real channel membership and role records.
- Scoped rooms under channels.
- Added public-channel previews with a join gate before room entry/chat.
- Moved room selection out of the top bar and into the channel list.
- Added optional room descriptions and expandable room detail panels.
- Added room mode metadata for social, watch, game, and custom rooms.
- Scoped room creation and moderation checks to channel membership roles.
- Restricted room creation and room closing to channel owners.
- Added owner-only channel deletion with active player relocation to Town Square.
- Added required email support for registration/login and a legacy email capture prompt.
- Added email verification tokens, a verification route, resend support, and a local-dev console delivery path.
- Fixed the Mongoose `new` option deprecation warning by using `returnDocument: "after"`.
- Fixed duplicate-login reload behavior so old sessions clear saved auth before reloading.
