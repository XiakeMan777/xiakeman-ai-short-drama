import { useEffect } from 'react'
import { useTheme } from 'next-themes'

export function ThemeBootstrap() {
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (!theme || theme === 'system') {
      setTheme('dark')
    }
  }, [theme, setTheme])

  return null
}
