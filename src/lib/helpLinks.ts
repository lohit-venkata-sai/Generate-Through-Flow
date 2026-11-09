/**
 * The single Help & Feedback destination.
 *
 * Only the server invite is used. The bug-report and feature-request
 * channels were linked directly at first, but `discord.com/channels/...`
 * deep links resolve ONLY for readers who are already signed into Discord
 * AND already members — everyone else lands in a dead end with no prompt
 * to join (Discord does not redirect non-members to an invite).
 *
 * Rescuing them automatically would need a membership check, which is not
 * possible from the browser: every real route (bot + backend, or OAuth2
 * `guilds.members.read`) needs a server this extension no longer runs.
 *
 * If you ever want the channel buttons back, create an invite FROM each
 * channel (Create Invite → Edit invite link → Expire After: Never,
 * Max Uses: No Limit) — channel-specific invites work for members and
 * non-members alike and land new users in the right channel.
 *
 * Kept out of the component file: eslint's react-refresh rule requires a
 * file that defines components to export components only.
 */
export const DISCORD_INVITE = "https://discord.gg/NxrthkM8y";
