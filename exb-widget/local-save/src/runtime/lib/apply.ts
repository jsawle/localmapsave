/**
 * Open an .amap file into the live Experience Builder map.
 *
 * The map widget owns its view and map, so we never swap view.map (that breaks
 * ExB's layer data sources and other widgets). Instead we:
 *   1. read the file with the public WebMap.fromJSON() into a temporary WebMap,
 *   2. keep live layers that match a file layer (same id + same service/item),
 *      updating visibility, opacity and style from the file,
 *   3. add file layers the map doesn't have, remove ones the file doesn't have,
 *   4. clear (not remove) drawing layers so the Draw widget keeps its layer,
 *   5. set the basemap if different and go to the saved viewpoint.
 */
import { hardenWebMapJson, isSameLayerSource, stableStringify, type JsonObject, type SaveWarning } from './amap-format'

export interface ApplyCtors {
  WebMap: { fromJSON: (json: any) => any }
  Basemap: { fromJSON: (json: any) => any }
  Viewpoint: { fromJSON: (json: any) => any }
}

export interface ApplyOptions {
  maxFeaturesPerLayer: number
  clearDrawings: boolean
}

export interface ApplyResult {
  warnings: SaveWarning[]
  layerCount: number
}

function describe (layer: any) {
  return { id: layer?.id, url: layer?.url ?? null, layerId: layer?.layerId ?? null, itemId: layer?.portalItem?.id ?? null }
}

function copyState (target: any, source: any): void {
  target.visible = source.visible
  target.opacity = source.opacity
  if (source.title) target.title = source.title
  if (target.type === 'feature' && source.type === 'feature') {
    if ('definitionExpression' in source) target.definitionExpression = source.definitionExpression ?? null
    if (source.renderer) target.renderer = source.renderer.clone?.() ?? source.renderer
    if (source.labelingInfo?.length) target.labelingInfo = source.labelingInfo.map((l: any) => l.clone?.() ?? l)
    if (typeof source.labelsVisible === 'boolean') target.labelsVisible = source.labelsVisible
    if (source.popupTemplate) target.popupTemplate = source.popupTemplate.clone?.() ?? source.popupTemplate
  }
}

export async function applyWebMapJson (raw: JsonObject, view: any, ctors: ApplyCtors, opts: ApplyOptions): Promise<ApplyResult> {
  const { json, warnings } = hardenWebMapJson(raw, opts.maxFeaturesPerLayer)
  const map = view.map

  const temp = ctors.WebMap.fromJSON(json)
  try {
    await temp.load()
  } catch {
    // A failing basemap or layer must not stop the rest of the file from opening.
  }
  const fileLayers: any[] = temp.layers?.toArray?.() ?? []
  temp.layers?.removeAll?.()

  const live: any[] = map.layers.toArray()
  const used = new Set<any>()
  const finalOrder: any[] = []
  const toAdd: any[] = []

  for (const fileLayer of fileLayers) {
    const match = live.find(l => !used.has(l) && l.type !== 'graphics' && isSameLayerSource(describe(l), describe(fileLayer)))
    if (match) {
      used.add(match)
      copyState(match, fileLayer)
      finalOrder.push(match)
      fileLayer.destroy?.()
    } else {
      toAdd.push(fileLayer)
      finalOrder.push(fileLayer)
    }
  }

  const keepOnTop: any[] = []
  for (const l of live) {
    if (used.has(l)) continue
    if (l.type === 'graphics') {
      if (opts.clearDrawings) l.graphics?.removeAll?.()
      keepOnTop.push(l)
    } else if (l.listMode === 'hide') {
      keepOnTop.push(l) // helper layers owned by other widgets
    } else {
      map.remove(l)
    }
  }

  // Layer ids must stay unique (ExB keys layer data sources by id).
  const takenIds = new Set<string>(map.layers.toArray().map((l: any) => l.id))
  for (const layer of toAdd) {
    if (takenIds.has(layer.id)) {
      let n = 2
      while (takenIds.has(`${layer.id}-${n}`)) n++
      layer.id = `${layer.id}-${n}`
    }
    takenIds.add(layer.id)
  }

  if (toAdd.length) map.addMany(toAdd)
  finalOrder.forEach((layer, index) => map.reorder(layer, index))
  keepOnTop.forEach(layer => map.reorder(layer, map.layers.length - 1))

  if (json.baseMap) {
    let current = ''
    try { current = stableStringify(map.basemap?.toJSON?.()) } catch { /* ignore */ }
    if (current !== stableStringify(json.baseMap)) {
      try {
        map.basemap = ctors.Basemap.fromJSON(json.baseMap)
      } catch {
        warnings.push({ layer: json.baseMap.title ?? 'Basemap', reason: 'failed' })
      }
    }
  }

  const vp = json.initialState?.viewpoint
  if (vp) {
    try {
      await view.goTo(ctors.Viewpoint.fromJSON(vp), { animate: false })
    } catch { /* view may be busy or the extent invalid; not fatal */ }
  }

  temp.destroy?.()
  return { warnings, layerCount: fileLayers.length }
}
