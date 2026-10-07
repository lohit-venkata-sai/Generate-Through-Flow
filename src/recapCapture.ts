// Intercepts reCAPTCHA Enterprise before Flow wraps it.
// Flow's bundle replaces the public grecaptcha.enterprise.execute with a
// wrapper that stamps external callers "extension_hijack_detected". The native
// ref is captured on first assignment and kept public, so automation mints a
// genuine IMAGE_GENERATION token like Flow's own code.
// Runs in the page MAIN world at document_start (see manifest content_scripts).
(function () {
    if ((window as unknown as { __fpCaptureLoaded?: boolean }).__fpCaptureLoaded) return;
    (window as unknown as { __fpCaptureLoaded?: boolean }).__fpCaptureLoaded = true;

    const holder = window as unknown as { __fpRealExecute?: (key: string, opts: { action: string }) => Promise<string> };

    const isNative = (fn: unknown): boolean => {
        try {
            return typeof fn === "function" && Function.prototype.toString.call(fn).indexOf("[native code]") >= 0;
        } catch {
            return false;
        }
    };

    const saveReal = (ent: object, fn: (...args: never[]) => unknown) => {
        try {
            const b = (fn.bind(ent) as (...args: unknown[]) => Promise<string>);
            holder.__fpRealExecute = (k: string, o: { action: string }) => b(k, o);
        } catch { /* ignore */ }
    };

    const trapExecute = (ent: Record<string, unknown> & { __fpTrapped?: boolean }) => {
        if (!ent || ent.__fpTrapped) return;
        let current: unknown;
        try {
            current = ent.execute;
        } catch {
            current = undefined;
        }
        if (isNative(current)) saveReal(ent, current as (...args: never[]) => Promise<string>);
        try {
            Object.defineProperty(ent, "execute", {
                configurable: true,
                enumerable: true,
                get: () => current,
                set: (v: unknown) => {
                    if (isNative(v)) {
                        current = v;
                        saveReal(ent, v as (...args: never[]) => Promise<string>);
                    } else if (!isNative(current)) {
                        current = v;
                    }
                },
            });
            ent.__fpTrapped = true;
        } catch {
            if (isNative(current)) saveReal(ent, current as (...args: never[]) => Promise<string>);
        }
    };

    const trapGre = (gre: Record<string, unknown> & { __fpGreTrapped?: boolean }) => {
        if (!gre || gre.__fpGreTrapped) return;
        gre.__fpGreTrapped = true;
        let ent: unknown;
        try {
            ent = gre.enterprise;
        } catch { /* ignore */ }
        if (ent) {
            trapExecute(ent as Record<string, unknown>);
            return;
        }
        try {
            Object.defineProperty(gre, "enterprise", {
                configurable: true,
                enumerable: true,
                get: () => ent,
                set: (v: unknown) => {
                    ent = v;
                    trapExecute(v as Record<string, unknown>);
                },
            });
        } catch { /* ignore */ }
    };

    const gw = window as unknown as { grecaptcha?: Record<string, unknown> };
    if (gw.grecaptcha) {
        trapGre(gw.grecaptcha);
        return;
    }
    let g: unknown;
    try {
        Object.defineProperty(window, "grecaptcha", {
            configurable: true,
            enumerable: true,
            get: () => g,
            set: (v: unknown) => {
                g = v;
                trapGre(v as Record<string, unknown>);
            },
        });
    } catch { /* ignore */ }
})();
