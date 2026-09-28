import { useEffect } from 'react'
import { useRoute } from './router'
import { useSettings } from './storage/settings'
import { AmbientOverlay } from './components/AmbientOverlay'
import { LibraryScreen } from './library/LibraryScreen'
import { ProcessingScreen } from './processing/ProcessingScreen'
import { ReaderScreen } from './reader/ReaderScreen'

export default function App() {
  const route = useRoute()
  const { theme } = useSettings()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const meta = document.querySelector('meta[name="theme-color"]') ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }))
    meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--paper').trim())
  }, [theme])

  return (
    <>
      {route.name === 'library' && <LibraryScreen />}
      {route.name === 'processing' && <ProcessingScreen key={route.bookId} bookId={route.bookId} />}
      {route.name === 'reader' && <ReaderScreen key={route.bookId} bookId={route.bookId} />}
      <AmbientOverlay />
    </>
  )
}
