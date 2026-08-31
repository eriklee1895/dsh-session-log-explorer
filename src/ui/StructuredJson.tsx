import type { ComponentProps } from 'react'
import { JsonView } from 'react-json-view-lite'
import './StructuredJson.css'

type JsonComposite = Record<string, unknown> | readonly unknown[]

const devtoolsStyle: NonNullable<ComponentProps<typeof JsonView>['style']> = {
  container: 'devtools-json-viewer',
  basicChildStyle: 'devtools-json-row',
  label: 'devtools-json-key',
  clickableLabel: 'devtools-json-key',
  nullValue: 'devtools-json-null',
  undefinedValue: 'devtools-json-null',
  numberValue: 'devtools-json-number',
  stringValue: 'devtools-json-string',
  booleanValue: 'devtools-json-boolean',
  otherValue: 'devtools-json-other',
  punctuation: 'devtools-json-punctuation',
  expandIcon: 'devtools-json-expand',
  collapseIcon: 'devtools-json-collapse',
  collapsedContent: 'devtools-json-ellipsis',
  childFieldsContainer: 'devtools-json-children',
  noQuotesForStringValues: false,
  quotesForFieldNames: false,
  ariaLables: { collapseJson: 'Collapse JSON', expandJson: 'Expand JSON' },
  stringifyStringValues: true,
}

function parseJson(value: string): { readonly value: unknown } | undefined {
  if (value.trim() === '') return undefined
  try {
    return { value: JSON.parse(value) as unknown }
  } catch {
    return undefined
  }
}

function jsonComposite(value: unknown): value is JsonComposite {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

/** Expand serialised nested JSON objects while preserving ordinary string values. */
function normalizeJson(value: unknown): unknown {
  if (typeof value === 'string') {
    const parsed = parseJson(value)?.value
    return jsonComposite(parsed) ? normalizeJson(parsed) : value
  }
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, normalizeJson(child)]))
}

/** Render JSON with Chrome DevTools-style tree rows and syntax colours. */
export function StructuredJson({ value, empty, className }: {
  readonly value: string
  readonly empty: string
  readonly className?: string
}): React.JSX.Element {
  const parsed = parseJson(value)
  const normalized = parsed === undefined ? undefined : normalizeJson(parsed.value)
  return <div className={`structured-json${className === undefined ? '' : ` ${className}`}`}>
    {value === '' ? <p className="empty-value">{empty}</p>
      : normalized === undefined ? <pre>{value}</pre>
        : jsonComposite(normalized) ? <JsonView aria-label="JSON preview" data={normalized} shouldExpandNode={level => level < 3} style={devtoolsStyle} />
          : <code className={`devtools-json-${normalized === null ? 'null' : typeof normalized}`}>{JSON.stringify(normalized)}</code>}
  </div>
}
