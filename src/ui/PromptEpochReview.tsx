import { diffLines } from 'diff'
import { useMemo } from 'react'
import type { PromptEpoch } from '../model/projection.ts'
import { promptEpochLabel } from '../model/projection.ts'
import { StructuredJson } from './StructuredJson.tsx'
import './PromptEpochReview.css'

function epochCode(ordinal: number): string {
  return `E${String(ordinal).padStart(2, '0')}`
}

function cardLabel(epoch: PromptEpoch): string {
  if (epoch.reason === 'initial') return 'INITIAL REQUEST CONTEXT'
  if (epoch.reason === 'resume' && epoch.changedFields.length === 0) return 'SESSION RESUMED · CONTEXT UNCHANGED'
  const changed = new Set(epoch.changedFields)
  if (changed.has('system') && changed.has('tools')) return 'SYSTEM PROMPT + TOOLS UPDATED'
  if (changed.has('system') && changed.has('config')) return 'SYSTEM PROMPT + MODEL CONFIG UPDATED'
  if (changed.has('system')) return 'SYSTEM PROMPT UPDATED'
  if (changed.has('tools') && changed.has('config')) return 'MODEL CONFIG + TOOLS UPDATED · SYSTEM PROMPT UNCHANGED'
  if (changed.has('tools')) return 'TOOLS UPDATED · SYSTEM PROMPT UNCHANGED'
  if (changed.has('config')) return 'MODEL CONFIG UPDATED · SYSTEM PROMPT UNCHANGED'
  return 'REQUEST CONTEXT UPDATED'
}

function modelName(epoch: PromptEpoch): string {
  return typeof epoch.config.model === 'string' ? epoch.config.model : 'model not recorded'
}

function PromptDiff({ before, after }: { readonly before: string; readonly after: string }): React.JSX.Element {
  const parts = useMemo(() => diffLines(before, after), [after, before])
  return <pre className="prompt-diff" aria-label="System prompt diff">{parts.map((part, index) => <span
    className={part.added ? 'added' : part.removed ? 'removed' : 'unchanged'}
    key={`${part.added ? 'a' : part.removed ? 'r' : 'u'}:${String(index)}`}
  >{part.value}</span>)}</pre>
}

function ToolList({ current, previous }: {
  readonly current: readonly string[]
  readonly previous: readonly string[]
}): React.JSX.Element {
  const currentSet = new Set(current)
  const previousSet = new Set(previous)
  const removed = previous.filter(name => !currentSet.has(name))
  return <ul className="prompt-tool-list">
    {current.map(name => <li className={previousSet.size > 0 && !previousSet.has(name) ? 'added' : ''} key={name}>{name}</li>)}
    {removed.map(name => <li className="removed" key={`removed:${name}`}>{name}</li>)}
  </ul>
}

/** Present model-visible request-header epochs without repeating unchanged resume snapshots. */
export function PromptEpochReview({ epochs, onEventSelect }: {
  readonly epochs: readonly PromptEpoch[]
  readonly onEventSelect: (eventId: string) => void
}): React.JSX.Element | null {
  if (epochs.length === 0) return null
  const byId = new Map(epochs.map(epoch => [epoch.eventId, epoch] as const))
  const counts = {
    initial: epochs.filter(epoch => epoch.reason === 'initial').length,
    resume: epochs.filter(epoch => epoch.reason === 'resume').length,
    update: epochs.filter(epoch => epoch.reason === 'change' || epoch.changedFields.length > 0).length,
  }
  return <section aria-label="Prompt epochs" className="prompt-review">
    <header className="prompt-review-header">
      <div><span>MODEL REQUEST CONTEXT</span><p>Snapshots of the model-visible system prompt, model configuration, and tools.</p></div>
      <strong>{counts.initial} INITIAL · {counts.resume} RESUME · {counts.update} UPDATE</strong>
    </header>
    <ol>{epochs.map((epoch) => {
      const previous = epoch.previousEventId === undefined ? undefined : byId.get(epoch.previousEventId)
      const unchangedResume = epoch.reason === 'resume' && epoch.changedFields.length === 0
      return <li key={epoch.eventId}><details className={`prompt-epoch ${epoch.reason}${unchangedResume ? ' unchanged' : ''}`}>
        <summary>
          <span className="prompt-epoch-index">{epochCode(epoch.ordinal)}</span>
          <div className="prompt-epoch-title"><strong>{cardLabel(epoch)}</strong><p>{unchangedResume
            ? `SYSTEM PROMPT, MODEL, AND TOOLS UNCHANGED FROM ${previous === undefined ? 'THE PREVIOUS SNAPSHOT' : epochCode(previous.ordinal)}`
            : epoch.system.replaceAll(/\s+/g, ' ').trim().slice(0, 170) || 'No rendered system prompt'}</p></div>
          <div className="prompt-epoch-meta"><span>{modelName(epoch)}</span><span>{epoch.toolNames.length} {epoch.toolNames.length === 1 ? 'TOOL' : 'TOOLS'}</span></div>
        </summary>
        <div className="prompt-epoch-body">
          {unchangedResume ? <p className="prompt-resume-note">The Agent loop resumed with the same model-visible system prompt, model configuration, and tool catalog.</p>
            : <section className="prompt-document">
              <header><h3>{previous === undefined || previous.system === epoch.system ? 'RENDERED SYSTEM PROMPT' : 'SYSTEM PROMPT DIFF'}</h3><small>{epoch.system.length.toLocaleString('en-US')} CHARACTERS</small></header>
              {previous !== undefined && previous.system !== epoch.system
                ? <PromptDiff before={previous.system} after={epoch.system} />
                : <pre>{epoch.system || 'No system prompt was recorded for this request.'}</pre>}
            </section>}
          {!unchangedResume && <aside className="prompt-epoch-aside">
            <section><h3>MODEL CONFIG</h3><StructuredJson value={JSON.stringify(epoch.config)} empty="No model configuration was recorded." /></section>
            <details className="prompt-tools"><summary>TOOLS <span>{epoch.toolNames.length}</span></summary><ToolList current={epoch.toolNames} previous={previous?.toolNames ?? []} /></details>
          </aside>}
          <button aria-label={`View raw request header ${epochCode(epoch.ordinal)}`} className="prompt-raw-event" onClick={() => { onEventSelect(epoch.eventId) }}>VIEW RAW REQUEST HEADER</button>
        </div>
      </details></li>
    })}</ol>
  </section>
}
