import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import './i18n'
import './index.css'
import App from './App.tsx'
import { ThemeBootstrap } from './components/theme/ThemeBootstrap'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <ThemeBootstrap />
      <App />
    </ThemeProvider>
  </StrictMode>,
)
