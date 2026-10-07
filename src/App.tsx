import { useEffect, useState } from 'react'
import { ArrowLeft, Moon, Settings as SettingsIcon, Sparkles, Sun } from 'lucide-react'
import './App.css'
import { AgentView } from './components/AgentView'
import { AuthGate } from './components/AuthGate'
import { AutomateView } from './components/AutomateView'
import { ModeTabs } from './components/ModeTabs'
import { PlansView } from './components/PlansView'
import { ProfileView } from './components/ProfileView'
import { SettingsView } from './components/SettingsView'
import { SetupView } from './components/SetupView'
import { TourOverlay } from './components/TourOverlay'
import { signOut } from './lib/auth'
import { loadServerUrl, serverConsume, serverGetUsage, serverVerify } from './lib/server'
import { defaultBatchName, defaultPrefs, effectiveLimit, loadHistory, loadPlan, loadPrefs, loadPresets, loadSession, loadUsage, migratePlan, ONE_YR_MS, PASS_RENEW_DAYS, saveHistory, savePlan, savePrefs, savePresets, saveUsage, SIX_MO_MS, tierDiff, todayKey, uid } from './lib/store'
import type { ActivePlan, AppView, AutomationPrefs, BatchRecord, DailyUsage, FormValues, GoogleSession, LogEntry, LogLevel, Mode, QueueItem, SavedPreset } from './types'

const STORAGE_KEY = "flowpilot-form-values"

const defaultFormValues: FormValues = {
  model: "nano-banana-2-lite",
  aspect_ratio: "16:9",
  quality: "standard",
  file_name_pattern: "",
  images_per_prompt: 1,
  separator: "empty-line",
  user_prompts: "",
  total_prompts: 0,
}

function loadSavedFormValues(): Promise<Partial<FormValues> | null> {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        resolve((result[STORAGE_KEY] as Partial<FormValues> | undefined) ?? null)
      })
      return
    }
    try {
      const savedValues = localStorage.getItem(STORAGE_KEY)
      resolve(savedValues ? JSON.parse(savedValues) as Partial<FormValues> : null)
    } catch {
      resolve(null)
    }
  })
}

function saveFormValues(formValues: FormValues) {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.set({ [STORAGE_KEY]: formValues })
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(formValues))
}

async function downscaleThumb(src: string): Promise<string | undefined> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("thumb"));
      el.src = src;
    });
    const scale = Math.min(1, 96 / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  }
}

function App() {
  const [formValues, setFormValues] = useState<FormValues>(defaultFormValues)
  const [prefs, setPrefs] = useState<AutomationPrefs>(defaultPrefs)
  const [presets, setPresets] = useState<SavedPreset[]>([])
  const [history, setHistory] = useState<BatchRecord[]>([])
  const [view, setView] = useState<AppView>("main")
  const [mode, setMode] = useState<Mode>("auto")
  const [isFormReady, setIsFormReady] = useState(false)
  const [queueItems, setQueueItems] = useState<QueueItem[]>([])
  const [queueLogs, setQueueLogs] = useState<LogEntry[]>([])
  const [session, setSession] = useState<GoogleSession | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [plansOpen, setPlansOpen] = useState(false)
  const [plan, setPlan] = useState<ActivePlan>({ base: "free", pass: null })
  const [usage, setUsage] = useState<DailyUsage>({ date: todayKey(), used: 0 })
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const savedTheme = localStorage.getItem("flowpilot-theme")
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme
    return "dark"
  })

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("flowpilot-theme", theme)
  }, [theme])

  useEffect(() => {
    loadSavedFormValues().then((savedValues) => {
      if (savedValues) {
        const migratedValues = {
          ...savedValues,
          model: savedValues.model === "nano-banana-lite"
            ? "nano-banana-2-lite"
            : savedValues.model ?? defaultFormValues.model,
          aspect_ratio: savedValues.aspect_ratio || defaultFormValues.aspect_ratio,
          quality: savedValues.quality === "standard" ? savedValues.quality : defaultFormValues.quality,
          separator: savedValues.separator || defaultFormValues.separator,
        }
        setFormValues({ ...defaultFormValues, ...migratedValues })
      }
      setIsFormReady(true)
    })
    loadPrefs().then((p) => {
      const merged = { ...defaultPrefs, ...p };
      if (![0, 5, 10, 15].includes(merged.bufferSec)) merged.bufferSec = 0;
      if (![1, 2, 3].includes(merged.parallel as number)) merged.parallel = 1;
      setPrefs(merged);
    }).catch(() => undefined)
    loadPresets().then((p) => p && setPresets(p)).catch(() => undefined)
    loadHistory().then((h) => h && setHistory(h)).catch(() => undefined)
    loadPlan().then((p) => {
      const migrated = migratePlan(p);
      if (migrated) setPlan(migrated);
    }).catch(() => undefined)
    loadUsage().then((u) => {
      const today = todayKey();
      setUsage(u && u.date === today ? u : { date: today, used: 0 });
    }).catch(() => undefined)
    loadSession().then((s) => {
      setSession(s);
      // No backend yet: treat every launch as a fresh user → tour after login.
      if (s) setShowTour(true);
    }).catch(() => undefined).finally(() => setSessionChecked(true))
  }, [])

  useEffect(() => {
    if (isFormReady) saveFormValues(formValues)
  }, [formValues, isFormReady])

  useEffect(() => {
    savePrefs(prefs).catch(() => undefined)
  }, [prefs])

  const pushQueueLog = (level: LogLevel, msg: string) =>
    setQueueLogs((l) => [...l.slice(-199), { ts: Date.now(), level, msg }])

  const consumeUsage = (images: number) => {
    setUsage((prev) => {
      const today = todayKey();
      const next = prev.date === today
        ? { date: today, used: prev.used + images }
        : { date: today, used: images };
      saveUsage(next).catch(() => undefined);
      return next;
    });
    // Mirror to the server best-effort (local stays authoritative offline).
    const sub = session?.sub;
    if (sub) {
      void (async () => {
        const base = await loadServerUrl();
        await serverConsume(base, sub, images);
      })();
    }
  };

  // Once signed in, verify with the server (upserts profile) and prefer
  // server-side usage when reachable. Local storage remains the fallback.
  const sessionSub = session?.sub;
  const sessionToken = session?.accessToken;
  useEffect(() => {
    if (!sessionChecked || !sessionSub) return;
    void (async () => {
      const base = await loadServerUrl();
      if (sessionToken) void serverVerify(base, sessionToken);
      const remote = await serverGetUsage(base, sessionSub);
      if (remote && remote.date === todayKey()) setUsage(remote);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionChecked, sessionSub]);

  const activePlan = plan;
  const dailyLimit = effectiveLimit(activePlan);

  const handleSignedIn = () => {
    loadSession().then((s) => {
      setSession(s);
      setShowTour(true);
    }).catch(() => undefined);
  };

  const handleSignOut = async () => {
    await signOut();
    setSession(null);
    setProfileOpen(false);
    setView("main");
  };

  const handleChooseBase = async (id: ActivePlan["base"]) => {
    if (tierDiff(plan.base, id) < 0) return;
    const next: ActivePlan = { ...plan, base: id };
    setPlan(next);
    await savePlan(next);
    setPlansOpen(false);
  };

  const handleChoosePass = async (id: "p7" | "p10") => {
    const now = Date.now();
    const dur = id === "p7" ? SIX_MO_MS : ONE_YR_MS;
    const next: ActivePlan = { ...plan, pass: { id, startedAt: now, expiresAt: now + dur } };
    setPlan(next);
    await savePlan(next);
    setPlansOpen(false);
  };

  const handleRenewPass = async () => {
    // Final-15-days renewal only: another 6 months for the $3 difference,
    // added onto the current expiry. Lifetimes stay untouched.
    if (!plan.pass || plan.pass.expiresAt <= Date.now()) return;
    if (plan.pass.expiresAt - Date.now() > PASS_RENEW_DAYS * 86_400_000) return;
    const next: ActivePlan = {
      ...plan,
      pass: { ...plan.pass, expiresAt: plan.pass.expiresAt + SIX_MO_MS },
    };
    setPlan(next);
    await savePlan(next);
    setPlansOpen(false);
  };

  const handleComplete = async (items: QueueItem[], elapsedMs: number) => {
    const doneItems = items.filter((i) => i.status === "done");
    const failedItems = items.filter((i) => i.status === "error");
    const firstImg = doneItems[0]?.images[0]?.preview;
    const thumb = firstImg ? await downscaleThumb(firstImg) : undefined;
    const prompts = items.map((i) => (i.filename ? `#${i.filename}\n${i.prompt}` : i.prompt));
    const record: BatchRecord = {
      id: uid(),
      name: defaultBatchName(prompts),
      ts: Date.now(),
      total: items.length,
      done: doneItems.length,
      failed: failedItems.length,
      thumb,
      settings: {
        model: formValues.model,
        aspect_ratio: formValues.aspect_ratio,
        quality: formValues.quality,
        images_per_prompt: formValues.images_per_prompt,
      },
      prompts,
    };
    void elapsedMs;
    setHistory((h) => {
      const next = [record, ...h].slice(0, 30);
      saveHistory(next).catch(() => undefined);
      return next;
    });
    if (prefs.notifyDone) {
      try {
        await chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/flowpilot-48.png",
          title: "FlowPilot batch finished",
          message: `${record.done}/${record.total} images generated${record.failed ? `, ${record.failed} failed` : ""}.`,
        });
      } catch { /* notifications unavailable — ignore */ }
    }
  };

  const handleSavePreset = async () => {
    const entry: SavedPreset = {
      id: uid(),
      name: `Preset ${presets.length + 1}`,
      ts: Date.now(),
      values: { ...formValues },
      prefs: { ...prefs },
    };
    const next = [entry, ...presets];
    setPresets(next);
    await savePresets(next);
  };

  const handleLoadBatch = (b: BatchRecord) => {
    const text = b.prompts.join("\n\n");
    setFormValues((p) => ({
      ...p,
      model: b.settings.model,
      aspect_ratio: b.settings.aspect_ratio,
      quality: b.settings.quality,
      images_per_prompt: b.settings.images_per_prompt,
      user_prompts: text,
      total_prompts: b.prompts.length,
    }));
    setProfileOpen(false);
    setView("main");
  };

  const backLabel = view === "settings" ? "Back to Main" : mode === "auto" ? "Back to Queue" : "Back to Main";
  const avatarLabel = (session?.name || session?.email || "?").slice(0, 1).toUpperCase();

  if (!sessionChecked) {
    return <div className="min-h-screen bg-background" />;
  }

  if (!session) {
    return (
      <div className="min-h-screen overflow-x-clip bg-background text-foreground">
        <AuthGate onSignedIn={handleSignedIn} />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-3 py-4 sm:px-5">
        <header className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Generate Through Flow</h1>
              <p className="text-xs text-muted-foreground">Automate Google Flow Generations</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              aria-label="Profile"
              title="Profile"
              className="flex size-10 items-center justify-center overflow-hidden rounded-full border bg-card shadow-sm transition-colors hover:border-primary/60"
            >
              {session.picture ? (
                <img src={session.picture} alt="" className="size-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center bg-primary text-sm font-bold text-primary-foreground">
                  {avatarLabel}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setView("settings")}
              aria-label="Settings"
              title="Settings"
              className="flex size-10 items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <SettingsIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setTheme((t) => t === "dark" ? "light" : "dark")}
              className="flex size-10 items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </header>

        {(view === "prompt" || view === "auto") && (
          <div className="mb-4">
            <ModeTabs mode={mode} onChange={(m) => { setMode(m); setView(m === "prompt" ? "prompt" : "auto"); }} />
          </div>
        )}

        <main className="flex flex-col gap-4">
          {view === "main" && (
            <>
              <ModeTabs mode={mode} onChange={setMode} />
              <SetupView
                formValues={formValues}
                setFormValues={setFormValues}
                onSavePreset={handleSavePreset}
                onContinue={() => setView(mode === "prompt" ? "prompt" : "auto")}
              />
            </>
          )}
          {view === "prompt" && (
            <AgentView formValues={formValues} setFormValues={setFormValues} />
          )}
          {view === "auto" && (
            <AutomateView
              formValues={formValues}
              prefs={prefs}
              setPrefs={setPrefs}
              items={queueItems}
              setItems={setQueueItems}
              logs={queueLogs}
              pushLog={pushQueueLog}
              dailyLimit={dailyLimit}
              usedToday={usage.used}
              onConsume={consumeUsage}
              onNeedUpgrade={() => setPlansOpen(true)}
              onComplete={handleComplete}
            />
          )}
          {view === "settings" && (
            <SettingsView
              formValues={formValues}
              setFormValues={setFormValues}
              prefs={prefs}
              setPrefs={setPrefs}
              presets={presets}
              setPresets={setPresets}
              onApplyPreset={(values, p) => { setFormValues({ ...values }); setPrefs({ ...p }); setView("main"); }}
            />
          )}
          {view !== "main" && (
            <button
              type="button"
              onClick={() => setView("main")}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-primary/50 text-xs font-medium text-primary hover:bg-primary/10"
            >
              <ArrowLeft className="size-3.5" />
              {backLabel}
            </button>
          )}
        </main>
        <p className="mt-auto pt-6 text-center text-[11px] text-muted-foreground">
          Runs directly in your Flow project tab — no servers.
        </p>
      </div>
      {showTour && <TourOverlay onDone={() => setShowTour(false)} />}
      {profileOpen && session && (
        <ProfileView
          session={session}
          plan={activePlan}
          usage={usage.date === todayKey() ? usage : { date: todayKey(), used: 0 }}
          history={history}
          onOpenPlans={() => { setProfileOpen(false); setPlansOpen(true); }}
          onRenewPass={handleRenewPass}
          onReplayTour={() => { setProfileOpen(false); setShowTour(true); }}
          onSignOut={handleSignOut}
          onClose={() => setProfileOpen(false)}
          onClearHistory={() => { setHistory([]); saveHistory([]).catch(() => undefined); }}
          onDeleteBatch={(id) => {
            setHistory((h) => {
              const next = h.filter((b) => b.id !== id);
              saveHistory(next).catch(() => undefined);
              return next;
            });
          }}
          onLoadBatch={handleLoadBatch}
        />
      )}
      {plansOpen && (
        <PlansView
          plan={activePlan}
          onChooseBase={handleChooseBase}
          onBuyPass={handleChoosePass}
          onRenewPass={handleRenewPass}
          onClose={() => setPlansOpen(false)}
        />
      )}
    </div>
  )
}

export default App
