import { useEffect, useState } from 'react'
import { Moon, Sparkles, Sun } from 'lucide-react'
import './App.css'
import { GeneratedPrompt } from './components/GeneratedPrompt'
import { PromptInput } from './components/PromptInput'
import { SettingsAccordion } from './components/SettingsAccordion'
import { buildAgentPrompt } from './lib/promptBuilder'
import type { FormValues } from './types'

const STORAGE_KEY = "flowpilot-form-values"

const defaultFormValues: FormValues = {
  model: "nano-banana-2-lite",
  aspect_ratio: "",
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

function App() {

  const [formValues, setFormValues] = useState<FormValues>(defaultFormValues)
  const [generatedPrompt, setGeneratedPrompt] = useState("")
  const [generationVersion, setGenerationVersion] = useState(0)
  const [isFormReady, setIsFormReady] = useState(false)
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const savedTheme = localStorage.getItem("flowpilot-theme")
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
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
        }
        setFormValues({ ...defaultFormValues, ...migratedValues })
      }
      setIsFormReady(true)
    })
  }, [])

  useEffect(() => {
    if (isFormReady) saveFormValues(formValues)
  }, [formValues, isFormReady])

  const handleGenerate = () => {
    setGeneratedPrompt(buildAgentPrompt(formValues))
    setGenerationVersion((version) => version + 1)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-3 py-4 sm:px-5">
        <header className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Generate Through Flow</h1>
              <p className="text-xs text-muted-foreground">Google Flow prompt compiler</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setTheme((currentTheme) => currentTheme === "dark" ? "light" : "dark")}
            className="flex size-10 items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </header>

        <main className="flex flex-col gap-4">
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <SettingsAccordion formValues={formValues} setFormValues={setFormValues} />
          </section>
          <section>
            <PromptInput formValues={formValues} setFormValues={setFormValues} onGenerate={handleGenerate} />
          </section>
          {generatedPrompt && <GeneratedPrompt key={generationVersion} prompt={generatedPrompt} />}
        </main>
        <p className="mt-auto pt-6 text-center text-[11px] text-muted-foreground">
          Build prompts here, then paste them into Google Flow Agent.
        </p>
      </div>
    </div>
  )
}

export default App
