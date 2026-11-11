import { defineManifest } from "@crxjs/vite-plugin";

/**
 * Extension version — the value chrome://extensions shows. Exported so
 * vite.config.ts can inline it into the UI footer from this same literal,
 * keeping the footer and the installed version from ever drifting apart.
 */
export const APP_VERSION = "1.5.9";

export default defineManifest({
    manifest_version: 3,

    name: "Generate Through Flow",

    version: APP_VERSION,

    description:
        "Automate bulk AI content generation through Google Flow.",

    action: {
        default_title: "Open Generate Through Flow",
        default_icon: {
            "16": "icons/flowpilot-16.png",
            "32": "icons/flowpilot-32.png",
            "48": "icons/flowpilot-48.png",
            "128": "icons/flowpilot-128.png",
        },
    },

    icons: {
        "16": "icons/flowpilot-16.png",
        "32": "icons/flowpilot-32.png",
        "48": "icons/flowpilot-48.png",
        "128": "icons/flowpilot-128.png",
    },


    permissions: ["sidePanel", "storage", "scripting", "tabs", "downloads", "notifications"],

    side_panel: {
        default_path: "index.html"
    },

    content_scripts: [
        {
            matches: ["https://flow.google.com/*"],
            js: ["src/recapCapture.ts"],
            run_at: "document_start",
            world: "MAIN",
        },
    ],
    background: {
        service_worker: "src/background.ts",
        type: "module",
    },

    host_permissions: [
        "https://flow.google.com/*",
    ],
});
