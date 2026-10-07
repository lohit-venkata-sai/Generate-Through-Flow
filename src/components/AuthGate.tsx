import { useState } from "react";
import { LogIn, Sparkles, TriangleAlert } from "lucide-react";
import { redirectURL, signIn } from "../lib/auth";

interface AuthGateProps {
    onSignedIn: () => void;
}

export function AuthGate({ onSignedIn }: AuthGateProps) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSignIn = async () => {
        setBusy(true);
        setError(null);
        try {
            await signIn(true);
            onSignedIn();
        } catch (e) {
            const msg = (e as Error).message;
            setError(msg.includes("redirect_uri_mismatch") ? "mismatch" : msg);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-lg">
                <Sparkles className="size-8" />
            </div>
            <h1 className="mt-5 text-xl font-bold tracking-tight">Generate Through Flow</h1>
            <p className="mt-1 text-xs text-muted-foreground">Automate Google Flow Generations</p>
            <p className="mt-5 max-w-60 text-xs leading-relaxed text-muted-foreground">
                Sign in with Google to start batch-generating images through your Flow project.
            </p>
            <button
                type="button"
                onClick={handleSignIn}
                disabled={busy}
                className="mt-5 inline-flex h-12 w-full max-w-60 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-60"
            >
                <LogIn className="size-4" />
                {busy ? "Signing in…" : "Continue with Google"}
            </button>
            {error && (
                <div className="mt-4 w-full max-w-60 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-left">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                        <TriangleAlert className="size-3.5 shrink-0" />
                        Sign-in failed
                    </p>
                    {error === "mismatch" ? (
                        <p className="mt-1.5 font-mono text-[10px] leading-relaxed break-all text-muted-foreground">
                            redirect_uri_mismatch — whitelist this URL on the OAuth client:<br />
                            {redirectURL()}
                        </p>
                    ) : (
                        <p className="mt-1 text-[11px] text-muted-foreground">{error}</p>
                    )}
                </div>
            )}
        </div>
    );
}
