import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'

const root = document.getElementById('root')
if (root === null) throw new Error('DSH Session Log Explorer requires #root')
createRoot(root).render(<App />)
