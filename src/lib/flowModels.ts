// Flow model/aspect codenames + tab matching.
// Verified against the live Flow frontend (2026-10 build):
// Nano Banana 2.1 -> BELUGA, Lite -> HARBOR_SEAL, Pro -> GEM_PIX_2.

export const FLOW_MODEL_CODES: Record<string, string> = {
    "nano-banana-2.1": "BELUGA",
    // Legacy id — migrated to 2.1 on load.
    "nano-banana-2": "BELUGA",
    "nano-banana-2-lite": "HARBOR_SEAL",
    "nano-banana-pro": "GEM_PIX_2",
};

export const FLOW_MODEL_LABELS: Record<string, string> = {
    "nano-banana-2.1": "Nano Banana 2.1",
    "nano-banana-2": "Nano Banana 2.1",
    "nano-banana-2-lite": "Nano Banana 2 Lite",
    "nano-banana-pro": "Nano Banana Pro",
};

// Numeric aspect codes used by the generateImage RPC payload.
export const FLOW_ASPECT_CODES: Record<string, number> = {
    "16:9": 3,
    "9:16": 2,
    "1:1": 1,
};

// The reCAPTCHA Enterprise site key used by the Flow page itself.
export const FLOW_RECAPTCHA_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";

// Tab URL patterns for finding an open Flow project tab.
export const FLOW_TAB_URLS = [
    "https://flow.google.com/project/*",
    "https://flow.google.com/*/project/*",
];
