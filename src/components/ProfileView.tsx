import { ArrowRight, CalendarDays, Crown, History, Hourglass, Infinity as InfinityIcon, LogOut, Play, Sparkles, Trash2, Upload, User, X } from "lucide-react";
import { PASS_RENEW_DAYS, PASS_RENEW_PRICE, passDaysLeft, passStatus, planDef, planName } from "../lib/store";
import type { ActivePlan, BatchRecord, DailyUsage, GoogleSession } from "../types";

interface ProfileViewProps {
    session: GoogleSession;
    plan: ActivePlan;
    usage: DailyUsage;
    history: BatchRecord[];
    onOpenPlans: () => void;
    onRenewPass: () => void;
    onReplayTour: () => void;
    onSignOut: () => void;
    onClose: () => void;
    onClearHistory: () => void;
    onDeleteBatch: (id: string) => void;
    onLoadBatch: (batch: BatchRecord) => void;
}

function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function daysLeft(expiresAt: number): number {
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 86_400_000));
}

export function ProfileView({
    session, plan, usage, history,
    onOpenPlans, onRenewPass, onReplayTour, onSignOut, onClose,
    onClearHistory, onDeleteBatch, onLoadBatch,
}: ProfileViewProps) {
    const status = passStatus(plan);
    const baseDef = planDef(plan.base);
    const baseLimit = baseDef.dailyLimit ?? 50;
    const pass = plan.pass;
    const initial = (session.name || session.email || "?").slice(0, 1).toUpperCase();

    const usagePct = Math.min(100, Math.round((usage.used / baseLimit) * 100));
    const remaining = Math.max(0, baseLimit - usage.used);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="Profile">
            <div className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-3xl border bg-card shadow-2xl">
                <div className="flex items-start justify-between p-4 pb-0">
                    <div className="flex items-center gap-2">
                        <User className="size-6 shrink-0 text-indigo-300" />
                        <div>
                            <h2 className="text-lg font-extrabold tracking-tight">Profile</h2>
                            <p className="text-[11px] text-muted-foreground">Manage your account, view usage and history.</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close profile" className="rounded-xl border p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <X className="size-4" />
                    </button>
                </div>

                <div className="flex items-center gap-3 px-4 pt-3">
                    {session.picture ? (
                        <img src={session.picture} alt="" className="size-14 shrink-0 rounded-full border object-cover" />
                    ) : (
                        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-sky-500 text-2xl font-bold text-white">
                            {initial}
                        </span>
                    )}
                    <div className="min-w-0">
                        <p className="truncate text-[15px] font-bold">{session.name || "Google user"}</p>
                        <p className="truncate text-xs text-muted-foreground">{session.email}</p>
                    </div>
                </div>

                {/* Active unlimited pass */}
                {status === "active" && pass && (
                    <div className="px-4 pt-3">
                        <button
                            type="button"
                            onClick={onOpenPlans}
                            className="flex w-full items-center gap-3 rounded-3xl border border-emerald-400/50 bg-gradient-to-br from-emerald-950/80 via-[#10233a] to-sky-950/60 p-3.5 text-left shadow-[0_0_30px_-12px_var(--primary)] transition-all active:scale-[0.99]"
                        >
                            <InfinityIcon className="size-7 shrink-0 text-emerald-300" />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                    <span className="text-sm font-bold">Unlimited Pass</span>
                                    <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Active</span>
                                </span>
                                <span className="block truncate text-[11px] text-muted-foreground">Unlimited images per day.</span>
                            </span>
                            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                        </button>

                        <div className="mt-2.5 rounded-3xl border border-emerald-400/40 bg-emerald-950/40 p-3.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2">
                                    <CalendarDays className="size-5 shrink-0 text-emerald-300" />
                                    <span>
                                        <span className="block text-[11px] text-muted-foreground">Expires on</span>
                                        <span className="block text-sm font-bold">{fmtDate(pass.expiresAt)}</span>
                                    </span>
                                </span>
                                <span className="rounded-full bg-emerald-400/20 px-2.5 py-1 text-[11px] font-bold whitespace-nowrap text-emerald-200">
                                    {daysLeft(pass.expiresAt)} days left
                                </span>
                            </div>
                            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-black/40">
                                <div
                                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-all"
                                    style={{ width: `${Math.min(100, Math.max(0, Math.round(((Date.now() - pass.startedAt) / Math.max(1, pass.expiresAt - pass.startedAt)) * 100)))}%` }}
                                />
                            </div>
                        </div>

                        <p className="mt-2.5 flex items-start gap-2 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-3 text-[11px] leading-relaxed">
                            <Sparkles className="mt-0.5 size-4 shrink-0 text-amber-300" />
                            Your {planName(plan.base)} ({baseLimit} images/day, lifetime) will automatically resume after your Unlimited Pass ends.
                        </p>

                        <div className="mt-2.5 rounded-2xl border bg-background p-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-muted-foreground">Usage today</span>
                                <span className="flex items-center gap-1 text-xs font-bold text-sky-300">
                                    <InfinityIcon className="size-3.5" /> Unlimited
                                </span>
                            </div>
                            <p className="mt-1 text-xs">{usage.used} images generated today</p>
                            <p className="text-[11px] text-muted-foreground">No daily limit</p>
                        </div>

                        {pass && passDaysLeft(pass) <= PASS_RENEW_DAYS ? (
                            <button
                                type="button"
                                onClick={onRenewPass}
                                className="mt-2.5 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-500 to-blue-500 p-3 text-left text-white shadow-lg transition-all hover:brightness-110 active:scale-[0.99]"
                            >
                                <CalendarDays className="size-6 shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-bold">Renew Unlimited Pass</span>
                                    <span className="block truncate text-[11px] text-white/80">Another 6 months for ${PASS_RENEW_PRICE}</span>
                                </span>
                                <ArrowRight className="size-5 shrink-0" />
                            </button>
                        ) : (
                            pass && (
                                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                                    Renewal opens in the final {PASS_RENEW_DAYS} days ({passDaysLeft(pass)} days left).
                                </p>
                            )
                        )}
                    </div>
                )}

                {/* Expired pass */}
                {status === "expired" && pass && (
                    <div className="px-4 pt-3">
                        <div className="flex w-full items-center gap-3 rounded-3xl border border-orange-400/50 bg-gradient-to-br from-orange-950/60 via-[#231a10] to-transparent p-3.5">
                            <Hourglass className="size-7 shrink-0 text-orange-300" />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                    <span className="text-sm font-bold">Unlimited Pass</span>
                                    <span className="rounded-full bg-orange-400/20 px-2 py-0.5 text-[10px] font-bold text-orange-300">Expired</span>
                                </span>
                                <span className="block truncate text-[11px] text-muted-foreground">Your Unlimited Pass has ended.</span>
                            </span>
                        </div>
                        <p className="mt-2.5 rounded-2xl border border-sky-300/30 bg-sky-400/10 p-3 text-[11px] leading-relaxed">
                            <span className="font-semibold">ⓘ </span>
                            Your Unlimited Pass expired on {fmtDate(pass.expiresAt)}. You are now back to your {planName(plan.base)} ({baseLimit} images/day, lifetime).
                        </p>
                    </div>
                )}

                {/* Base plan card (lifetime tiers, or under an expired pass) */}
                {status !== "active" && (
                    <div className="px-4 pt-3">
                        <button
                            type="button"
                            onClick={onOpenPlans}
                            className="flex w-full items-center gap-3 rounded-3xl border border-violet-400/50 bg-gradient-to-br from-violet-950/70 via-[#1a1440] to-transparent p-3.5 text-left shadow-[0_0_30px_-12px_var(--primary)] transition-all active:scale-[0.99]"
                        >
                            <Crown className="size-7 shrink-0 text-fuchsia-400" />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                    <span className="text-sm font-bold">{planName(plan.base)}</span>
                                    <span className="rounded-full bg-violet-400/20 px-2 py-0.5 text-[10px] font-bold text-violet-200">Lifetime</span>
                                </span>
                                <span className="block truncate text-[11px] text-muted-foreground">
                                    {plan.base === "free" ? "50 images per day, forever." : `${baseLimit} images per day, forever.`}
                                </span>
                            </span>
                            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                        </button>

                        <div className="mt-2.5 rounded-2xl border bg-background p-3">
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-muted-foreground">Daily usage</span>
                                <span className="tabular-nums font-semibold">{usage.used} / {baseLimit}</span>
                            </div>
                            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-all" style={{ width: `${usagePct}%` }} />
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                <span>{remaining} images remaining today</span>
                                <span>{usagePct}% used</span>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onOpenPlans}
                            className="mt-2.5 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 p-3 text-left text-white shadow-lg transition-all hover:brightness-110 active:scale-[0.99]"
                        >
                            <InfinityIcon className="size-6 shrink-0" />
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-bold">Get Unlimited Pass</span>
                                <span className="block truncate text-[11px] text-white/80">Unlimited images for 6 months · $7</span>
                            </span>
                            <ArrowRight className="size-5 shrink-0" />
                        </button>
                    </div>
                )}

                <div className="px-4 pt-3">
                    <div className="mb-2 flex items-center justify-between">
                        <h3 className="flex items-center gap-1.5 text-sm font-bold">
                            <History className="size-4 text-muted-foreground" />
                            History
                        </h3>
                        {history.length > 0 && (
                            <button type="button" onClick={onClearHistory} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                                <Trash2 className="size-3.5" />
                                Clear all
                            </button>
                        )}
                    </div>
                    {history.length === 0 && (
                        <p className="rounded-2xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                            No batches yet.
                        </p>
                    )}
                    <ul className="max-h-56 space-y-2 overflow-y-auto">
                        {history.map((b) => (
                            <li key={b.id} className="flex items-center gap-2.5 rounded-2xl border bg-background p-2.5">
                                {b.thumb ? (
                                    <img src={b.thumb} alt="" className="size-11 shrink-0 rounded-xl border object-cover" />
                                ) : (
                                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-muted text-xs font-bold text-muted-foreground">
                                        {b.name.slice(0, 1).toUpperCase()}
                                    </span>
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-medium">{b.name}</p>
                                    <p className="text-[11px] tabular-nums text-muted-foreground">
                                        {b.done}/{b.total}{b.failed > 0 && <span className="text-destructive"> · {b.failed} failed</span>} · {new Date(b.ts).toLocaleDateString()} · {new Date(b.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                    </p>
                                </div>
                                <button type="button" onClick={() => onLoadBatch(b)} aria-label={`Reload ${b.name}`} title="Reload prompts" className="rounded-xl bg-primary/10 p-2 text-primary hover:bg-primary/20">
                                    <Upload className="size-4" />
                                </button>
                                <button type="button" onClick={() => onDeleteBatch(b.id)} aria-label={`Delete ${b.name}`} className="rounded-xl bg-muted p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                                    <Trash2 className="size-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="flex gap-2.5 p-4">
                    <button
                        type="button"
                        onClick={onReplayTour}
                        className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl border text-xs font-semibold hover:bg-accent"
                    >
                        <Play className="size-4" />
                        Replay tour
                    </button>
                    <button
                        type="button"
                        onClick={onSignOut}
                        className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-destructive/50 text-xs font-semibold text-destructive hover:bg-destructive/10"
                    >
                        <LogOut className="size-4" />
                        Sign out
                    </button>
                </div>
            </div>
        </div>
    );
}
