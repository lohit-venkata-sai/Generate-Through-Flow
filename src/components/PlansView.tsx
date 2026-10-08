import { useState } from "react";
import {
    ArrowRight, BarChart3, Check, Crown, Image as ImageIcon,
    Infinity as InfinityIcon, Lock, ShieldCheck, Star, X, Zap,
} from "lucide-react";
import { PASS_RENEW_PRICE, nextTier, passDaysLeft, passOffer, tierDiff } from "../lib/store";
import { useLockBodyScroll } from "../lib/useLockBodyScroll";
import type { ActivePlan, PlanId } from "../types";

interface PlansViewProps {
    plan: ActivePlan;
    billing: { busy: boolean; msg: string | null; onCancel: () => void };
    onChooseBase: (id: "free" | "p3" | "p4" | "p5") => void;
    onBuyPass: (id: "p7" | "p10") => void;
    onRenewPass: () => void;
    onClose: () => void;
}

const CHECKS = [
    "Unlimited image generation",
    "Automated generation support",
    "Batch prompts & bulk download",
    "Prompt templates & management",
    "Priority generation queue",
];

const TIERS: { images: string; desc: string; price: number; id: PlanId; icon: React.ReactNode; badge?: string }[] = [
    { images: "100 images per day", desc: "Good for occasional generation.", price: 3, id: "p3", icon: <ImageIcon className="size-5" /> },
    { images: "300 images per day", desc: "Great for regular use.", price: 4, id: "p4", icon: <ImageIcon className="size-5" /> },
    { images: "500 images per day", desc: "Best for heavy users.", price: 5, id: "p5", icon: <ImageIcon className="size-5" />, badge: "BEST VALUE" },
];

const TRUST: { icon: React.ReactNode; title: string; sub: string }[] = [
    { icon: <ShieldCheck className="size-5" />, title: "One-time payment", sub: "No recurring charges" },
    { icon: <InfinityIcon className="size-5" />, title: "Flexible terms", sub: "Lifetime or timed plans" },
    { icon: <Zap className="size-5" />, title: "Instant activation", sub: "Start generating now" },
    { icon: <Lock className="size-5" />, title: "Secure checkout", sub: "Your payment is safe" },
];

export function PlansView({ plan, billing, onChooseBase, onBuyPass, onRenewPass, onClose }: PlansViewProps) {
    const [term, setTerm] = useState<"p7" | "p10">("p7");
    const offer = passOffer(plan);
    const days = plan.pass ? passDaysLeft(plan.pass) : 0;
    useLockBodyScroll();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="Upgrade plans">
            <div className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-3xl border bg-card shadow-2xl">
                <div className="flex items-start justify-between p-4 pb-0">
                    <div className="flex items-center gap-2.5">
                        <Crown className="size-7 shrink-0 text-fuchsia-400" />
                        <div>
                            <h2 className="bg-gradient-to-r from-fuchsia-400 via-indigo-300 to-sky-400 bg-clip-text text-lg font-extrabold tracking-tight text-transparent">
                                Upgrade Your Image Limit
                            </h2>
                            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                                Generate more images, automate your workflow and create without limits.
                            </p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close plans" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <X className="size-4" />
                    </button>
                </div>

                {/* Unlimited hero */}
                <div className="p-4">
                    <div className="relative overflow-hidden rounded-3xl border border-indigo-500/50 bg-gradient-to-br from-indigo-950 via-[#141a35] to-fuchsia-950 p-4 shadow-[0_0_40px_-10px_var(--primary)]">
                        <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-600 to-blue-500 px-2.5 py-1 text-[10px] font-bold text-white">
                            <Star className="size-3" /> RECOMMENDED
                        </span>
                        <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="bg-gradient-to-r from-fuchsia-400 via-indigo-300 to-sky-400 bg-clip-text text-[26px] font-black leading-none tracking-tight text-transparent">
                                UNLIMITED
                            </p>
                            <InfinityIcon className="size-9 shrink-0 text-amber-400" />
                        </div>
                        <p className="mt-1 text-sm font-bold">Images per day, your way.</p>
                        <p className="text-[11px] text-muted-foreground">Everything you need to create without limits.</p>
                        <ul className="mt-2.5 space-y-1.5">
                            {CHECKS.map((c) => (
                                <li key={c} className="flex items-center gap-2 text-xs">
                                    <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-sky-400/90 text-[10px] font-bold text-slate-950">
                                        <Check className="size-3" />
                                    </span>
                                    {c}
                                </li>
                            ))}
                        </ul>
                        {offer === "fresh" && (
                        <div className="mt-3 flex items-center gap-2">
                            {(["p7", "p10"] as const).map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setTerm(t)}
                                    aria-pressed={term === t}
                                    className={`h-8 flex-1 rounded-xl border text-xs font-semibold transition-colors ${term === t ? "border-primary bg-primary text-primary-foreground" : "border-white/15 text-muted-foreground hover:text-foreground"}`}
                                >
                                    {t === "p7" ? "$7 · 6 months" : "$10 · 1 year"}
                                </button>
                            ))}
                        </div>
                        )}
                        {offer === "locked" && (
                            <p className="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-center text-[11px] font-medium text-muted-foreground">
                                Renewal opens in the final 15 days ({days} days left).
                            </p>
                        )}
                        <div className="mt-2.5 flex items-center gap-3">
                            <div>
                                <p className="flex items-center gap-2">
                                    <span className="text-3xl font-black">${offer === "renew" ? PASS_RENEW_PRICE : term === "p7" ? 7 : 10}</span>
                                    <span className="rounded-full border border-violet-400/60 bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-violet-200">
                                        {offer === "renew" ? "Another 6 Months" : term === "p7" ? "6 Months Access" : "1 Year Access"}
                                    </span>
                                </p>
                                <p className="mt-0.5 text-[10px] text-white/70">
                                    {offer === "renew"
                                        ? "Pay only the $3 difference · added onto your expiry"
                                        : offer === "locked"
                                            ? "Your pass is active"
                                            : term === "p7" ? "Unlimited images for 6 months" : "Unlimited images for 1 year"}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => (offer === "renew" ? onRenewPass() : onBuyPass(term))}
                                disabled={offer === "locked" || billing.busy}
                                className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-violet-600 to-blue-500 text-sm font-bold whitespace-nowrap text-white shadow-lg transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
                            >
                                {billing.busy ? "Opening…" : offer === "renew" ? "Renew for $3" : "Get Unlimited"}
                                <ArrowRight className="size-4" />
                            </button>
                        </div>
                        {billing.msg && (
                            <div className="mt-2 rounded-xl bg-sky-400/10 px-3 py-2 text-center">
                                <p className="text-[11px] font-medium text-sky-200">
                                    {billing.msg}
                                </p>
                                {billing.busy && (
                                    <button
                                        type="button"
                                        onClick={billing.onCancel}
                                        className="mt-1.5 h-8 rounded-lg border border-white/15 px-4 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Daily limit plans */}
                <div className="px-4">
                    <div className="flex items-center gap-2">
                        <span className="h-px flex-1 bg-border" />
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                            <BarChart3 className="size-3.5" /> Daily Limit Plans
                        </span>
                        <span className="h-px flex-1 bg-border" />
                    </div>
                    <p className="mt-1 text-center text-[11px] text-muted-foreground">One-time payment, lifetime access.</p>
                    {(() => {
                        const next = nextTier(plan.base);
                        const shown = plan.base === "free" ? TIERS : TIERS.filter((t) => t.id === next);
                        if (plan.base !== "free" && !next) {
                            return (
                                <p className="mt-2.5 rounded-xl bg-muted/60 px-3 py-2.5 text-center text-[11px] font-medium text-muted-foreground">
                                    You're on the top lifetime tier.
                                </p>
                            );
                        }
                        return (
                    <div className={`mt-2.5 grid gap-2 ${shown.length === 1 ? "grid-cols-1" : "grid-cols-3"}`}>
                        {shown.map((t) => {
                            const tierId = t.id as "p3" | "p4" | "p5";
                            const active = plan.base === tierId;
                            const diff = tierDiff(plan.base, tierId);
                            return (
                                <div key={t.id} className={`relative rounded-2xl border bg-background p-2.5 ${active ? "border-primary" : ""}`}>
                                    {t.badge && (
                                        <span className="absolute -top-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-full bg-amber-400 px-1.5 py-px text-[8px] font-black text-slate-950">
                                            <Star className="size-2" /> {t.badge}
                                        </span>
                                    )}
                                    <div className="flex items-center gap-1.5">
                                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                            {t.icon}
                                        </span>
                                        <p className="text-[11px] font-bold leading-tight">{t.images}</p>
                                    </div>
                                    <p className="mt-1.5 min-h-7 text-[10px] leading-snug text-muted-foreground">{t.desc}</p>
                                    {plan.base === "free" ? (
                                        <p className="mt-1 flex items-center gap-1.5">
                                            <span className="text-lg font-black">${t.price}</span>
                                            <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-medium text-muted-foreground">Lifetime</span>
                                        </p>
                                    ) : (
                                        <p className="mt-1 flex items-center gap-1.5">
                                            <span className="text-lg font-black">${diff}</span>
                                            <span className="rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-bold text-primary">pay only extra</span>
                                        </p>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onChooseBase(tierId)}
                                        disabled={active || billing.busy}
                                        title={active ? "Current base plan" : `Pay only $${diff} extra`}
                                        className="mt-1.5 h-8 w-full rounded-xl bg-primary/15 text-[11px] font-bold text-primary hover:bg-primary/25 disabled:opacity-60"
                                    >
                                        {billing.busy ? "Opening…" : active ? "Current" : plan.base === "free" ? `Choose $${t.price}` : `Pay $${diff}`}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                        );
                    })()}
                </div>

                {/* Trust row */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 p-4">
                    {TRUST.map((t) => (
                        <div key={t.title} className="flex items-center gap-2">
                            <span className="shrink-0 text-sky-400">{t.icon}</span>
                            <div>
                                <p className="text-[11px] font-semibold">{t.title}</p>
                                <p className="text-[10px] text-muted-foreground">{t.sub}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
