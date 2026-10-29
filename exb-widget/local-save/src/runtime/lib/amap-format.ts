/**
 * Pure helpers for the .amap local map file.
 *
 * An .amap file is a plain ArcGIS web map JSON document (web map specification),
 * so it can be read by WebMap.fromJSON() and inspected by any developer.
 * Nothing in this module touches the ArcGIS Maps SDK or Experience Builder,
 * so it can be unit-tested in isolation.
 */
import { FILE_EXTENSION } from './version'

export type JsonObject = Record<string, any>

export interface SaveWarning {
  /** Layer title (or id) that could not be saved, or was reduced. */
  layer: string
  /** Machine-readable reason, mapped to a translation key in the UI. */
  reason: 'unsupportedType' | 'localFileSource' | 'truncated' | 'noGeometry' | 'notHttps' | 'failed'
}

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

/** Make a safe file name that always ends in .amap. */
export function safeFileName (name: string | undefined | null, fallback = 'my-map'): string {
  let base = (name ?? '').trim()
  if (base.toLowerCase().endsWith(FILE_EXTENSION)) base = base.slice(0, -FILE_EXTENSION.length)
  if (base.toLowerCase().endsWith('.json')) base = base.slice(0, -5)
  // Remove characters not allowed in file names on Windows/macOS/ChromeOS.
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  base = base.replace(/^\.+/, '')
  if (!base) base = fallback
  if (base.length > 80) base = base.slice(0, 80).trim()
  return base + FILE_EXTENSION
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type EsriGeometryType = 'esriGeometryPoint' | 'esriGeometryMultipoint' | 'esriGeometryPolyline' | 'esriGeometryPolygon'

/** Map SDK geometry type names ('point', 'polygon' ...) to REST names. */
export function toEsriGeometryType (sdkType: string | undefined | null): EsriGeometryType | null {
  switch (sdkType) {
    case 'point': return 'esriGeometryPoint'
    case 'multipoint': return 'esriGeometryMultipoint'
    case 'polyline': return 'esriGeometryPolyline'
    case 'polygon':
    case 'extent': return 'esriGeometryPolygon'
    default: return null
  }
}

/** Work out the REST geometry type from geometry JSON. */
export function geometryTypeOfJson (g: JsonObject | null | undefined): EsriGeometryType | null {
  if (!g || typeof g !== 'object') return null
  if (typeof g.x === 'number' && typeof g.y === 'number') return 'esriGeometryPoint'
  if (Array.isArray(g.points)) return 'esriGeometryMultipoint'
  if (Array.isArray(g.paths)) return 'esriGeometryPolyline'
  if (Array.isArray(g.rings)) return 'esriGeometryPolygon'
  if (typeof g.xmin === 'number') return 'esriGeometryPolygon'
  return null
}

/** Extent JSON → polygon JSON (feature collections cannot hold extents). */
export function normaliseGeometryJson (g: JsonObject): JsonObject {
  if (g && typeof g.xmin === 'number' && !Array.isArray(g.rings)) {
    const { xmin, ymin, xmax, ymax, spatialReference } = g
    return {
      rings: [[[xmin, ymin], [xmin, ymax], [xmax, ymax], [xmax, ymin], [xmin, ymin]]],
      ...(spatialReference ? { spatialReference } : {})
    }
  }
  return g
}

// ---------------------------------------------------------------------------
// Drawings (GraphicsLayer) → feature collection
// ---------------------------------------------------------------------------

/** A transparent marker used so text graphics are drawn only by their label. */
const INVISIBLE_MARKER = {
  type: 'esriSMS',
  style: 'esriSMSCircle',
  color: [0, 0, 0, 0],
  size: 1,
  outline: { type: 'esriSLS', style: 'esriSLSNull', color: [0, 0, 0, 0], width: 0 }
}

const DRAWING_FIELDS = [
  { name: 'OBJECTID', type: 'esriFieldTypeOID', alias: 'OBJECTID' },
  { name: '_sym', type: 'esriFieldTypeString', alias: 'Symbol', length: 16 },
  { name: '_label', type: 'esriFieldTypeString', alias: 'Text', length: 2000 }
]

/** Stable stringify so identical symbols get the same key regardless of property order. */
export function stableStringify (value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}

function escapeSqlString (s: string): string {
  return s.replace(/'/g, "''")
}

/**
 * Turn the JSON of a GraphicsLayer's graphics (graphic.toJSON()) into one
 * feature-collection operational layer.
 *
 * Each distinct symbol becomes a unique-value class on the hidden "_sym" field,
 * so every drawing keeps its own colour/size. Text graphics are stored as an
 * invisible point plus a label class that draws the text with its own style.
 * Graphics with geometry we cannot store (mesh, missing) are counted in `skipped`.
 */
export function drawingsToFeatureCollection (
  graphicsJson: JsonObject[],
  meta: { id: string, title: string, visible: boolean, opacity: number },
  maxFeatures: number
): { layer: JsonObject | null, skipped: number, truncated: boolean } {
  type Group = { features: JsonObject[], symbols: Map<string, { key: string, symbol: JsonObject, isText: boolean }> }
  const groups = new Map<EsriGeometryType, Group>()
  let skipped = 0
  let count = 0
  let truncated = false
  let symbolCounter = 0

  for (const g of graphicsJson) {
    const geomType = geometryTypeOfJson(g?.geometry)
    if (!geomType) { skipped++; continue }
    if (count >= maxFeatures) { truncated = true; break }

    const rawSymbol: JsonObject | undefined = g.symbol
    const isText = rawSymbol?.type === 'esriTS'
    const text = isText ? String(rawSymbol?.text ?? '') : ''
    const symbolForKey = isText ? { ...rawSymbol, text: undefined } : (rawSymbol ?? null)
    const symbolKeyJson = stableStringify(symbolForKey)

    let group = groups.get(geomType)
    if (!group) { group = { features: [], symbols: new Map() }; groups.set(geomType, group) }

    let entry = group.symbols.get(symbolKeyJson)
    if (!entry) {
      entry = { key: 's' + (symbolCounter++), symbol: symbolForKey ?? defaultSymbolFor(geomType), isText }
      group.symbols.set(symbolKeyJson, entry)
    }

    group.features.push({
      geometry: normaliseGeometryJson(g.geometry),
      attributes: { OBJECTID: group.features.length + 1, _sym: entry.key, _label: text }
    })
    count++
  }

  if (groups.size === 0) return { layer: null, skipped, truncated }

  const subLayers: JsonObject[] = []
  let anyText = false
  let i = 0
  for (const [geometryType, group] of groups) {
    const uniqueValueInfos: JsonObject[] = []
    const labelingInfo: JsonObject[] = []
    for (const entry of group.symbols.values()) {
      if (entry.isText) {
        anyText = true
        uniqueValueInfos.push({ value: entry.key, label: entry.key, symbol: INVISIBLE_MARKER })
        labelingInfo.push({
          labelExpressionInfo: { expression: '$feature._label' },
          where: `_sym = '${escapeSqlString(entry.key)}'`,
          labelPlacement: 'esriServerPointLabelPlacementCenterCenter',
          deconflictionStrategy: 'none',
          symbol: entry.symbol
        })
      } else {
        uniqueValueInfos.push({ value: entry.key, label: entry.key, symbol: entry.symbol })
      }
    }
    subLayers.push({
      layerDefinition: {
        name: `${meta.title} (${i + 1})`,
        type: 'Feature Layer',
        geometryType,
        objectIdField: 'OBJECTID',
        fields: DRAWING_FIELDS,
        drawingInfo: {
          renderer: { type: 'uniqueValue', field1: '_sym', uniqueValueInfos },
          ...(labelingInfo.length ? { labelingInfo } : {})
        }
      },
      featureSet: { geometryType, features: group.features }
    })
    i++
  }

  return {
    layer: {
      id: meta.id,
      title: meta.title,
      layerType: 'ArcGISFeatureLayer',
      visibility: meta.visible,
      opacity: meta.opacity,
      showLabels: anyText,
      featureCollection: { layers: subLayers, showLegend: false }
    },
    skipped,
    truncated
  }
}

function defaultSymbolFor (geometryType: EsriGeometryType): JsonObject {
  switch (geometryType) {
    case 'esriGeometryPolyline':
      return { type: 'esriSLS', style: 'esriSLSSolid', color: [0, 112, 255, 255], width: 2 }
    case 'esriGeometryPolygon':
      return { type: 'esriSFS', style: 'esriSFSSolid', color: [0, 112, 255, 64], outline: { type: 'esriSLS', style: 'esriSLSSolid', color: [0, 112, 255, 255], width: 1.5 } }
    default:
      return { type: 'esriSMS', style: 'esriSMSCircle', color: [0, 112, 255, 255], size: 8, outline: { type: 'esriSLS', style: 'esriSLSSolid', color: [255, 255, 255, 255], width: 1 } }
  }
}

// ---------------------------------------------------------------------------
// Opening: validation and hardening of untrusted files
// ---------------------------------------------------------------------------

export class AmapError extends Error {
  constructor (public code: 'notJson' | 'notWebMap' | 'tooLarge' | 'webScene', message?: string) {
    super(message ?? code)
  }
}

/** Parse text and check it looks like a 2D web map document. */
export function parseWebMapText (text: string): JsonObject {
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new AmapError('notJson')
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new AmapError('notWebMap')
  // Web scenes have a "ground" property and "initialState.environment"; reject them clearly.
  if (json.ground || json.heightModelInfo) throw new AmapError('webScene')
  const hasLayers = Array.isArray(json.operationalLayers)
  const hasBasemap = json.baseMap && typeof json.baseMap === 'object'
  if (!hasLayers && !hasBasemap) throw new AmapError('notWebMap')
  if (!hasLayers) json.operationalLayers = []
  return json
}

const URL_KEYS = ['url', 'styleUrl', 'templateUrl']

/** True for URLs we are willing to load from a file someone else made. */
export function isAllowedUrl (u: unknown): boolean {
  return typeof u === 'string' && /^https:\/\//i.test(u.trim())
}

/**
 * Make an opened file safe to load:
 * - drop layers whose service URL is not https (no http:, blob:, data:, javascript:)
 * - cap the number of features in each feature collection
 * - drop bookmarks/tables/applicationProperties we do not use
 * Returns the cleaned JSON (a copy) and warnings.
 */
export function hardenWebMapJson (input: JsonObject, maxFeatures: number): { json: JsonObject, warnings: SaveWarning[] } {
  const json: JsonObject = JSON.parse(JSON.stringify(input))
  const warnings: SaveWarning[] = []

  const cleanLayers = (layers: any[]): any[] => {
    const out: any[] = []
    for (const layer of Array.isArray(layers) ? layers : []) {
      if (!layer || typeof layer !== 'object') continue
      const name = String(layer.title ?? layer.id ?? 'layer')
      const badUrl = URL_KEYS.some(k => layer[k] !== undefined && !isAllowedUrl(layer[k]))
      if (badUrl) { warnings.push({ layer: name, reason: 'notHttps' }); continue }
      if (Array.isArray(layer.layers)) layer.layers = cleanLayers(layer.layers)
      const fcLayers = layer.featureCollection?.layers
      if (Array.isArray(fcLayers)) {
        let remaining = maxFeatures
        let cut = false
        for (const fc of fcLayers) {
          const feats = fc?.featureSet?.features
          if (Array.isArray(feats)) {
            if (feats.length > remaining) { fc.featureSet.features = feats.slice(0, Math.max(0, remaining)); cut = true }
            remaining -= fc.featureSet.features.length
          }
        }
        if (cut) warnings.push({ layer: name, reason: 'truncated' })
      }
      out.push(layer)
    }
    return out
  }

  json.operationalLayers = cleanLayers(json.operationalLayers)
  if (json.baseMap?.baseMapLayers) {
    json.baseMap.baseMapLayers = (json.baseMap.baseMapLayers as any[]).filter(l =>
      URL_KEYS.every(k => l?.[k] === undefined || isAllowedUrl(l[k]))
    )
  }
  delete json.tables
  delete json.applicationProperties
  delete json.bookmarks
  return { json, warnings }
}

// ---------------------------------------------------------------------------
// Matching layers when a file is opened into a live map
// ---------------------------------------------------------------------------

export function normaliseUrl (u: unknown): string {
  if (typeof u !== 'string') return ''
  return u.trim().replace(/\?.*$/, '').replace(/\/+$/, '').toLowerCase()
}

/** Same layer id and same source (URL or portal item) → treat as the same layer. */
export function isSameLayerSource (
  a: { id?: string, url?: string | null, layerId?: number | null, itemId?: string | null },
  b: { id?: string, url?: string | null, layerId?: number | null, itemId?: string | null }
): boolean {
  if (!a.id || a.id !== b.id) return false
  if (a.itemId && b.itemId) return a.itemId === b.itemId
  const ua = normaliseUrl(a.url)
  const ub = normaliseUrl(b.url)
  if (ua && ub) return ua === ub && (a.layerId ?? null) === (b.layerId ?? null)
  // Neither has a URL or item (client-side data): ids alone are not enough.
  return false
}
