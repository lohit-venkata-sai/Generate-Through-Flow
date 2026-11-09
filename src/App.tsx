import { useEffect, useState } from 'react'
import { ArrowLeft, History, Moon, Settings as SettingsIcon, Sparkles, Sun } from 'lucide-react'
import './App.css'
import { AgentView } from './components/AgentView'
import { AutomateView } from './components/AutomateView'
import { HistoryView } from './components/HistoryView'
import { ModeTabs } from './components/ModeTabs'
import { HelpFeedbackCard } from './components/HelpFeedbackCard'
import { SettingsView } from './components/SettingsView'
import { SetupView } from './components/SetupView'
import { TourOverlay } from './components/TourOverlay'
import { defaultBatchName, defaultPrefs, addTodayCount, loadHistory, loadPrefs, loadPresets, loadTodayCount, loadTourSeen, saveHistory, savePrefs, savePresets, saveTourSeen, uid } from './lib/store'
import type { AppView, AutomationPrefs, BatchRecord, FormValues, LogEntry, LogLevel, Mode, QueueItem, SavedPreset } from './types'

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
  const [showTour, setShowTour] = useState(false)
  // Help & Feedback card: shown on every open, closed manually for that
  // session only — deliberately NOT persisted, so it comes back next time.
  const [showHelp, setShowHelp] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [todayCount, setTodayCount] = useState(0)
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
            : savedValues.model === "nano-banana-2"
              ? "nano-banana-2.1"
              : savedValues.model ?? defaultFormValues.model,
          aspect_ratio: savedValues.aspect_ratio || defaultFormValues.aspect_ratio,
          quality: savedValues.quality === "standard" || savedValues.quality === "1080p" || savedValues.quality === "2k" ? savedValues.quality : defaultFormValues.quality,
          separator: savedValues.separator || defaultFormValues.separator,
        }
        setFormValues({ ...defaultFormValues, ...migratedValues })
      }
      setIsFormReady(true)
    })
    loadPrefs().then((p) => {
      const merged = { ...defaultPrefs, ...p };
      if (![0, 5, 10, 15].includes(merged.bufferSec)) merged.bufferSec = 0;
      if (![1, 2, 5, 7, 10].includes(merged.parallel as number)) merged.parallel = 1;
      setPrefs(merged);
    }).catch(() => undefined)
    loadPresets().then((p) => p && setPresets(p)).catch(() => undefined)
    loadHistory().then((h) => h && setHistory(h)).catch(() => undefined)
    loadTodayCount().then((c) => setTodayCount(c)).catch(() => undefined)
    // First-run tour only (single local flag — no account).
    loadTourSeen().then((seen) => {
      if (!seen) setShowTour(true)
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (isFormReady) saveFormValues(formValues)
  }, [formValues, isFormReady])

  useEffect(() => {
    savePrefs(prefs).catch(() => undefined)
  }, [prefs])

  const pushQueueLog = (level: LogLevel, msg: string) =>
    setQueueLogs((l) => [...l.slice(-199), { ts: Date.now(), level, msg }])

  // Images-generated-today counter (local only). addTodayCount serializes
  // internally, so parallel completions never lose increments.
  const bumpToday = (n: number) => {
    if (n > 0) void addTodayCount(n).then((c) => setTodayCount(c)).catch(() => undefined);
  };

  const handleTourDone = () => {
    void saveTourSeen().catch(() => undefined);
    setShowTour(false);
  };

  const handleDismissHelp = () => {
    setShowHelp(false);
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
    setHistoryOpen(false);
    setView("main");
  };

  const backLabel = view === "settings" ? "Back to Main" : mode === "auto" ? "Back to Queue" : "Back to Main";

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
              onClick={() => setHistoryOpen(true)}
              aria-label="History"
              title="History"
              className="flex size-10 items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <History className="size-4" />
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

        {view === "main" && showHelp && (
          <HelpFeedbackCard onDismiss={handleDismissHelp} />
        )}

        {view !== "main" && (
          <div className="mb-4 flex justify-start">
            <button
              type="button"
              onClick={() => setView("main")}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-primary/50 px-3 text-xs font-medium text-primary hover:bg-primary/10"
            >
              <ArrowLeft className="size-3.5" />
              {backLabel}
            </button>
          </div>
        )}

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
              onComplete={handleComplete}
              onImagesDone={bumpToday}
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
              todayCount={todayCount}
              onApplyPreset={(values, p) => { setFormValues({ ...values }); setPrefs({ ...p }); setView("main"); }}
            />
          )}
        </main>
        <p className="mt-auto pt-6 text-center text-[11px] text-muted-foreground">
          Free forever · runs locally in your Flow project tab — no servers.
        </p>
      </div>
      {showTour && <TourOverlay onDone={handleTourDone} />}
      {historyOpen && (
        <HistoryView
          history={history}
          onReplayTour={() => { setHistoryOpen(false); setShowTour(true); }}
          onClose={() => setHistoryOpen(false)}
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
    </div>
  )
}

export default App
