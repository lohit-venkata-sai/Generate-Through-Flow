import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
    manifest_version: 3,

    name: "Generate Through Flow",

    version: "0.0.1",

    description:
        "Automate bulk AI content generation through Google Flow.",

    action: {
        default_title: "Open Generate Through Flow",
        default_icon: {
            // "16": "icons/flowpilot-16.png",
            "32": "icons/flowpilot-32.png",
            "48": "icons/flowpilot-48.png",
            "128": "icons/flowpilot-128.png",
        },
    },

    icons: {
        // "16": "icons/flowpilot-16.png",
        "32": "icons/flowpilot-32.png",
        "48": "icons/flowpilot-48.png",
        "128": "icons/flowpilot-128.png",
    },


    permissions: ["sidePanel", "storage"],

    side_panel: {
        default_path: "index.html"
    },
    background: {
        service_worker: "src/background.ts",
        type: "module",
    },

    host_permissions: [
        "https://flow.google.com/*",
    ],
});
