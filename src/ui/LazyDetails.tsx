import { useState, type ReactNode } from 'react'

/** Mount expensive detail bodies only while their disclosure is expanded. */
export function LazyDetails({ summary, children, className, initialOpen = false }: {
  readonly summary: ReactNode
  readonly children: () => ReactNode
  readonly className?: string
  readonly initialOpen?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(initialOpen)
  return <details className={className} open={open}>
    <summary onClick={event => { event.preventDefault(); setOpen(value => !value) }}>{summary}</summary>
    {open && children()}
  </details>
}
