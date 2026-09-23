import { useEffect, useState } from 'react'
import './App.css'
import { PromptInput } from './components/PromptInput'
import { SettingsAccordion } from './components/SettingsAccordion'

function App() {

  const [formValues, setFormValues] = useState({
    model: "nano-banana-2-lite",
    aspect_ratio: "",
    file_name_pattern: "",
    separator: "",
    user_prompts: "",
    total_prompts: 0,
  })

  useEffect(() => { console.log(formValues) }, [formValues])
  return (
    <>
      <div className='p-4 flex flex-col gap-2'>
        <header className='text-xl font-bold text-center text-cyan-600'>
          FlowPilot
        </header>
        <main className='flex flex-col gap-2'>
          {/* Generator form section */}
          <section>
            <SettingsAccordion setFormValues={setFormValues} />
          </section>
          <section>
            <PromptInput setFormValues={setFormValues} />
          </section>
        </main>
      </div>
    </>
  )
}

export default App
