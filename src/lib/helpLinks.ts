/**
 * Help & Feedback destinations. All three land in the Discord server.
 *
 * The two channel links are `discord.com/channels/...` deep links, so they
 * only resolve for readers who are already signed in AND already members —
 * `joinDiscord` is the invite that gets newcomers in the door.
 *
 * Kept out of the component file: eslint's react-refresh rule requires a
 * file that defines components to export components only.
 */
export const HELP_LINKS = {
    reportIssue: "https://discord.com/channels/1557281873070391376/1560498008167284868",
    requestFeature: "https://discord.com/channels/1557281873070391376/1569361039366291486",
    joinDiscord: "https://discord.gg/NxrthkM8y",
} as const;
