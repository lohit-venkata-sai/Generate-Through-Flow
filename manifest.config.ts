import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
    manifest_version: 3,

    name: "FlowPilot",

    version: "0.0.1",

    description:
        "Build optimized prompts for Google Flow Agent.",

    action: {
        default_title: "Open FlowPilot",
    },


    permissions: ["sidePanel"],

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