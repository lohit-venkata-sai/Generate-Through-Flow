// Google sign-in for the panel gate (local session, no backend).
// Uses an OAuth2 web-application client + chrome.identity.launchWebAuthFlow
// (implicit flow). The extension's redirect URL must be whitelisted on the
// client or Google answers redirect_uri_mismatch — the gate shows the fix.

import { saveSession } from "./store";
import type { GoogleSession } from "../types";

export const GOOGLE_CLIENT_ID = "1064543963079-34muhr16ctumlcf5kmk37b6abgjop3af.apps.googleusercontent.com";

export function redirectURL(): string {
    try {
        return chrome.identity.getRedirectURL();
    } catch {
        return "";
    }
}

interface UserInfo {
    id?: string;
    email?: string;
    name?: string;
    picture?: string;
}

async function readUserInfo(accessToken: string): Promise<UserInfo | null> {
    try {
        const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: "Bearer " + accessToken },
        });
        if (!res.ok) return null;
        return (await res.json()) as UserInfo;
    } catch {
        return null;
    }
}

export async function signIn(interactive = true): Promise<GoogleSession> {
    if (!GOOGLE_CLIENT_ID) throw new Error("Sign-in is not configured yet.");
    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        response_type: "token",
        redirect_uri: redirectURL(),
        scope: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        prompt: "select_account",
    });
    const authURL = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
    const redirected = await chrome.identity.launchWebAuthFlow({ url: authURL, interactive });
    if (!redirected) throw new Error("Sign-in was cancelled.");
    const hash = new URL(redirected).hash.slice(1);
    const token = new URLSearchParams(hash).get("access_token");
    if (!token) {
        if (/error=redirect_uri_mismatch/i.test(redirected)) throw new Error("redirect_uri_mismatch");
        throw new Error("Google did not return a token.");
    }
    const info = await readUserInfo(token);
    if (!info?.id) throw new Error("Could not read your Google account.");
    const session: GoogleSession = {
        sub: info.id,
        email: (info.email || "").toLowerCase(),
        name: info.name || "",
        picture: info.picture || "",
        accessToken: token,
        exp: Date.now() + 55 * 60_000,
    };
    await saveSession(session);
    return session;
}

export async function signOut(): Promise<void> {
    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            await chrome.storage.local.remove("flowpilot-session");
        } else {
            localStorage.removeItem("flowpilot-session");
        }
    } catch { /* ignore */ }
}
