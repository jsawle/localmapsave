import { React, jsx, css, hooks, ReactRedux, type AllWidgetProps, type IMState, defaultMessages as jimuCoreMessages } from 'jimu-core'
import { Paper, Button, WidgetPlaceholder } from 'jimu-ui'
import { JimuMapViewComponent, loadArcGISJSAPIModules, type JimuMapView } from 'jimu-arcgis'
import { type IMConfig, readConfig } from '../config'
import defaultMessages from './translations/default'
import { AmapError, parseWebMapText, safeFileName, type SaveWarning } from './lib/amap-format'
import { buildWebMapJson } from './lib/serialize'
import { applyWebMapJson, type ApplyCtors } from './lib/apply'
import { openLocalFile, chooseSaveTarget, writeSaveTarget, type FileHandle } from './lib/file-io'
import { FORMAT_VERSION, WIDGET_VERSION } from './lib/version'

const { useState, useEffect, useRef, useCallback } = React

type Busy = 'saving' | 'opening' | null
type Confirm = 'discard' | 'firstSave' | null
interface Status { kind: 'info' | 'error', text: string, details?: string[] }

interface Modules extends ApplyCtors {
  reactiveUtils: { watch: (getter: () => any, cb: (v: any) => void) => { remove: () => void } }
}

const CREATE_PRIVILEGE = 'portal:user:createItem'

/** Top-level and grouped operational layers (not basemap layers). */
function flattenLayers (collection: any): any[] {
  const out: any[] = []
  for (const l of collection?.toArray?.() ?? []) {
    out.push(l)
    if (l.type === 'group') out.push(...flattenLayers(l.layers))
  }
  return out
}

/** A cheap fingerprint of what the user can change; used for "unsaved changes". */
function mapSignature (view: any): string {
  const map = view?.map
  if (!map) return ''
  const layers = flattenLayers(map.layers).map(l =>
    `${l.id}:${l.visible ? 1 : 0}:${l.opacity}:${l.type === 'graphics' ? (l.graphics?.length ?? 0) : ''}`
  )
  return layers.join('|') + '#' + (map.basemap?.id ?? '')
}

const style = css`
  &.widget-local-save {
    height: 100%;
    overflow: auto;
    padding: var(--sys-spacing-3);
    display: flex;
    flex-direction: column;
    gap: var(--sys-spacing-2);
  }
  .ls-file { margin: 0; font-weight: var(--sys-typography-font-weight-medium); overflow-wrap: anywhere; }
  .ls-state { margin: 0; }
  .ls-state-dirty { color: var(--sys-color-warning-dark); }
  .ls-buttons { display: flex; flex-wrap: wrap; gap: var(--sys-spacing-2); }
  .ls-panel {
    border: 1px solid var(--sys-color-divider-secondary);
    border-radius: var(--sys-shape-shape2);
    padding: var(--sys-spacing-2);
    background: var(--sys-color-surface-background);
    color: var(--sys-color-surface-background-text);
  }
  .ls-panel p { margin: 0 0 var(--sys-spacing-2) 0; }
  .ls-status p, .ls-status ul { margin: 0; }
  .ls-status ul { padding-inline-start: var(--sys-spacing-5); }
  .ls-error { color: var(--sys-color-error-dark); }
  .ls-note { margin: 0; color: var(--sys-color-surface-paper-text); }
  .ls-footer {
    margin-top: auto;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--sys-spacing-1);
    font-size: 0.75rem;
    color: var(--sys-color-surface-paper-hint);
  }
`

export default function Widget (props: AllWidgetProps<IMConfig>) {
  const translate = hooks.useTranslation(jimuCoreMessages, defaultMessages)
  const config = readConfig(props.config as any)
  const mapWidgetId = props.useMapWidgetIds?.[0]

  const [jimuMapView, setJimuMapView] = useState<JimuMapView>(null)
  const [modules, setModules] = useState<Modules>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [status, setStatus] = useState<Status>(null)
  const [fileName, setFileName] = useState<string>(null)
  const [openedOriginal, setOpenedOriginal] = useState(false)
  const [dirty, setDirty] = useState(false)

  const handleRef = useRef<FileHandle>(null)
  const baselineRef = useRef<string>('')
  const confirmFirstButton = useRef<HTMLButtonElement>(null)

  const user = ReactRedux.useSelector((state: IMState) => state.user)
  const privileges: string[] = Array.from((user as any)?.privileges ?? [])
  const canSave = !config.respectUserPrivileges || !user || privileges.includes(CREATE_PRIVILEGE)

  const view: any = jimuMapView?.view
  const is3d = view?.type === '3d'

  // Load SDK modules once.
  useEffect(() => {
    let cancelled = false
    loadArcGISJSAPIModules(['esri/WebMap', 'esri/Basemap', 'esri/Viewpoint', 'esri/core/reactiveUtils'])
      .then(([WebMap, Basemap, Viewpoint, reactiveUtils]) => {
        if (!cancelled) setModules({ WebMap, Basemap, Viewpoint, reactiveUtils })
      })
      .catch(() => { if (!cancelled) setStatus({ kind: 'error', text: translate('lsErrOpen') }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track unsaved changes on the active view; rebind when the view changes.
  useEffect(() => {
    setReady(false)
    if (!jimuMapView || !modules || is3d) return
    let handle: { remove: () => void } = null
    let stale = false
    jimuMapView.whenJimuMapViewLoaded().then(() => {
      if (stale) return
      const v: any = jimuMapView.view
      baselineRef.current = mapSignature(v)
      setDirty(false)
      handle = modules.reactiveUtils.watch(() => mapSignature(v), sig => {
        if (!stale) setDirty(sig !== baselineRef.current)
      })
      setReady(true)
    })
    return () => { stale = true; handle?.remove() }
  }, [jimuMapView, modules, is3d])

  // Browser warning when leaving with unsaved changes.
  useEffect(() => {
    if (!config.warnBeforeLeaving || !dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [config.warnBeforeLeaving, dirty])

  // Move focus into a confirmation panel when it appears.
  useEffect(() => {
    if (confirm) confirmFirstButton.current?.focus()
  }, [confirm])

  const describeWarnings = useCallback((warnings: SaveWarning[]): string[] => {
    const seen = new Set<string>()
    return warnings
      .map(w => translate(`lsWarn_${w.reason}`, { layer: w.layer, max: config.maxFeaturesPerLayer }))
      .filter(t => (seen.has(t) ? false : (seen.add(t), true)))
  }, [translate, config.maxFeaturesPerLayer])

  const markSaved = () => {
    baselineRef.current = mapSignature(view)
    setDirty(false)
  }

  const runSave = async (forceNew: boolean) => {
    setConfirm(null)
    if (!view || !canSave) return
    setStatus(null)
    const suggested = safeFileName(fileName ?? config.defaultFileName)
    let target = null
    try {
      // Ask where to save first, while the click still counts as a user gesture.
      target = await chooseSaveTarget(suggested, forceNew ? null : handleRef.current)
    } catch {
      setStatus({ kind: 'error', text: translate('lsErrSave') })
      return
    }
    if (!target) return // cancelled
    setBusy('saving')
    try {
      const { json, warnings, layerCount } = await buildWebMapJson(view, {
        includeDrawings: config.includeDrawings,
        maxFeaturesPerLayer: config.maxFeaturesPerLayer
      })
      const text = JSON.stringify(json, null, 2)
      const saved = await writeSaveTarget(target, text)
      handleRef.current = saved.handle
      setFileName(saved.name)
      setOpenedOriginal(false)
      markSaved()
      setStatus({
        kind: 'info',
        text: translate(saved.method === 'download' ? 'lsDownloaded' : 'lsSaved', { name: saved.name, count: layerCount }),
        details: describeWarnings(warnings)
      })
    } catch {
      setStatus({ kind: 'error', text: translate('lsErrSave') })
    } finally {
      setBusy(null)
    }
  }

  const onSave = () => {
    // Role-free overwrite protection: after opening someone's file (e.g. a
    // lesson file from the LMS), the first Save asks before overwriting it.
    if (openedOriginal && handleRef.current) setConfirm('firstSave')
    else runSave(false)
  }

  const runOpen = async () => {
    setConfirm(null)
    if (!view || !modules) return
    setStatus(null)
    let file = null
    try {
      file = await openLocalFile()
    } catch {
      setStatus({ kind: 'error', text: translate('lsErrOpen') })
      return
    }
    if (!file) return // cancelled
    if (file.size > config.maxFileSizeMB * 1024 * 1024) {
      setStatus({ kind: 'error', text: translate('lsErrTooLarge', { size: config.maxFileSizeMB }) })
      return
    }
    setBusy('opening')
    try {
      const raw = parseWebMapText(await file.text())
      const { warnings, layerCount } = await applyWebMapJson(raw, view, modules, {
        maxFeaturesPerLayer: config.maxFeaturesPerLayer,
        clearDrawings: true
      })
      handleRef.current = file.handle
      setFileName(file.name)
      setOpenedOriginal(!!file.handle)
      markSaved()
      setStatus({ kind: 'info', text: translate('lsOpened', { name: file.name, count: layerCount }), details: describeWarnings(warnings) })
    } catch (e) {
      const code = e instanceof AmapError ? e.code : null
      const key = code === 'notJson' ? 'lsErrNotJson' : code === 'notWebMap' ? 'lsErrNotWebMap' : code === 'webScene' ? 'lsErrWebScene' : 'lsErrOpen'
      setStatus({ kind: 'error', text: translate(key) })
    } finally {
      setBusy(null)
    }
  }

  const onOpen = () => {
    if (dirty) setConfirm('discard')
    else runOpen()
  }

  // ----- Render -----

  const mapView = mapWidgetId && (
    <JimuMapViewComponent useMapWidgetId={mapWidgetId} onActiveViewChange={setJimuMapView} />
  )

  if (!mapWidgetId) {
    return <WidgetPlaceholder widgetId={props.id} message={translate('lsSelectMap')} />
  }

  const footer = (
    <div className='ls-footer'>
      <span>{translate('lsVersions', { widget: WIDGET_VERSION, format: FORMAT_VERSION })}</span>
      <span>{translate('lsCredit')}</span>
    </div>
  )

  if (is3d) {
    return (
      <Paper className='widget-local-save jimu-widget' css={style} variant='flat' shape='none'>
        {mapView}
        <p className='ls-note'>{translate('lsScene3d')}</p>
        {footer}
      </Paper>
    )
  }

  const disabled = !ready || !!busy

  return (
    <Paper
      className='widget-local-save jimu-widget'
      css={style}
      variant='flat'
      shape='none'
      role='region'
      aria-label={props.label || translate('_widgetLabel')}
      aria-busy={!!busy}
    >
      {mapView}

      <p className='ls-file'>{fileName ? translate('lsFileName', { name: fileName }) : translate('lsNoFile')}</p>
      {ready && (
        <p className={`ls-state ${dirty ? 'ls-state-dirty' : ''}`}>
          {dirty ? translate('lsUnsaved') : (fileName ? translate('lsAllSaved') : '')}
        </p>
      )}
      {!ready && <p className='ls-note'>{translate('lsMapLoading')}</p>}

      <div className='ls-buttons' role='group' aria-label={props.label || translate('_widgetLabel')}>
        <Button type='default' size='sm' onClick={onOpen} disabled={disabled}>
          {busy === 'opening' ? translate('lsOpening') : translate('lsOpen')}
        </Button>
        <Button type='primary' size='sm' onClick={onSave} disabled={disabled || !canSave}>
          {busy === 'saving' ? translate('lsSaving') : translate('lsSave')}
        </Button>
        <Button type='default' size='sm' onClick={() => runSave(true)} disabled={disabled || !canSave}>
          {translate('lsSaveAs')}
        </Button>
      </div>

      {!canSave && <p className='ls-note'>{translate('lsNoPrivilege')}</p>}

      {confirm === 'discard' && (
        <div className='ls-panel' role='group' aria-labelledby='ls-confirm-discard'>
          <p id='ls-confirm-discard'>{translate('lsConfirmDiscard')}</p>
          <div className='ls-buttons'>
            <Button ref={confirmFirstButton} type='primary' size='sm' onClick={runOpen}>{translate('lsOpenAnyway')}</Button>
            <Button type='default' size='sm' onClick={() => setConfirm(null)}>{translate('lsCancel')}</Button>
          </div>
        </div>
      )}

      {confirm === 'firstSave' && (
        <div className='ls-panel' role='group' aria-labelledby='ls-confirm-first-save'>
          <p id='ls-confirm-first-save'>{translate('lsFirstSaveQuestion', { name: fileName })}</p>
          <div className='ls-buttons'>
            <Button ref={confirmFirstButton} type='primary' size='sm' onClick={() => runSave(true)}>{translate('lsSaveCopy')}</Button>
            <Button type='default' size='sm' onClick={() => runSave(false)}>{translate('lsUpdateOriginal')}</Button>
            <Button type='tertiary' size='sm' onClick={() => setConfirm(null)}>{translate('lsCancel')}</Button>
          </div>
        </div>
      )}

      <div className='ls-status' role='status' aria-live='polite'>
        {status?.kind === 'info' && <p>{status.text}</p>}
        {status?.details?.length > 0 && (
          <React.Fragment>
            <p>{translate('lsWarnIntro')}</p>
            <ul>{status.details.map(d => <li key={d}>{d}</li>)}</ul>
          </React.Fragment>
        )}
      </div>
      <div role='alert'>
        {status?.kind === 'error' && <p className='ls-error'>{status.text}</p>}
      </div>

      <p className='ls-note'>{translate('lsPrivacy')}</p>
      {footer}
    </Paper>
  )
}
