/**
 * Build web map JSON (.amap) from a live 2D map view, using only public
 * ArcGIS Maps SDK JSON methods (renderer/label/popup/field/graphic/viewpoint/
 * basemap .toJSON()). WebMap has no public toJSON(), so operational layers are
 * written here, following the web map specification.
 *
 * SDK objects are duck-typed so this works across SDK 4.x and 5.x.
 */
import { drawingsToFeatureCollection, toEsriGeometryType, isAllowedUrl, type JsonObject, type SaveWarning } from './amap-format'
import { AUTHORING_APP, WEBMAP_SPEC_VERSION, WIDGET_VERSION } from './version'

export interface SerializeOptions {
  includeDrawings: boolean
  maxFeaturesPerLayer: number
}

export interface SerializeResult {
  json: JsonObject
  warnings: SaveWarning[]
  layerCount: number
}

const LOCAL_URL = /^(blob:|data:)/i

function titleOf (layer: any): string {
  return String(layer?.title || layer?.id || 'layer')
}

function safeToJSON (obj: any): JsonObject | undefined {
  try {
    return obj && typeof obj.toJSON === 'function' ? obj.toJSON() : undefined
  } catch {
    return undefined
  }
}

function commonProps (layer: any): JsonObject {
  const out: JsonObject = {
    id: layer.id,
    title: layer.title ?? '',
    visibility: layer.visible !== false,
    opacity: typeof layer.opacity === 'number' ? layer.opacity : 1
  }
  if (layer.portalItem?.id) out.itemId = layer.portalItem.id
  if (typeof layer.minScale === 'number' && layer.minScale > 0) out.minScale = layer.minScale
  if (typeof layer.maxScale === 'number' && layer.maxScale > 0) out.maxScale = layer.maxScale
  if (layer.listMode && layer.listMode !== 'show') out.listMode = layer.listMode
  return out
}

function drawingInfoOf (layer: any): JsonObject | undefined {
  const renderer = safeToJSON(layer.renderer)
  const labelingInfo = Array.isArray(layer.labelingInfo)
    ? layer.labelingInfo.map((l: any) => safeToJSON(l)).filter(Boolean)
    : (layer.labelingInfo?.toArray?.() ?? []).map((l: any) => safeToJSON(l)).filter(Boolean)
  if (!renderer && !labelingInfo.length) return undefined
  return {
    ...(renderer ? { renderer } : {}),
    ...(labelingInfo.length ? { labelingInfo } : {})
  }
}

function featureServiceUrl (layer: any): string {
  const url: string = layer.url
  if (typeof layer.layerId === 'number' && !/\/\d+\/?$/.test(url)) return url.replace(/\/+$/, '') + '/' + layer.layerId
  return url
}

/** Client-side data (uploaded CSV/shapefile/GeoJSON, sketches reopened) → feature collection. */
async function toFeatureCollection (layer: any, maxFeatures: number, warnings: SaveWarning[]): Promise<JsonObject | null> {
  if (typeof layer.queryFeatures !== 'function') {
    warnings.push({ layer: titleOf(layer), reason: 'localFileSource' })
    return null
  }
  if (typeof layer.load === 'function') await layer.load()
  const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
  query.where = '1=1'
  query.outFields = ['*']
  query.returnGeometry = true
  query.num = maxFeatures + 1
  const result = await layer.queryFeatures(query)
  let features: any[] = result?.features ?? []
  if (features.length > maxFeatures) {
    features = features.slice(0, maxFeatures)
    warnings.push({ layer: titleOf(layer), reason: 'truncated' })
  }
  const geometryType = toEsriGeometryType(layer.geometryType)
  if (!geometryType) {
    warnings.push({ layer: titleOf(layer), reason: 'noGeometry' })
    return null
  }
  const objectIdField: string = layer.objectIdField || 'OBJECTID'
  const fields: JsonObject[] = (layer.fields ?? []).map((f: any) => safeToJSON(f)).filter(Boolean)
  if (!fields.some(f => f.name === objectIdField)) {
    fields.unshift({ name: objectIdField, type: 'esriFieldTypeOID', alias: objectIdField })
  }
  const popupInfo = layer.popupTemplate ? safeToJSON(layer.popupTemplate) : undefined
  const sr = safeToJSON(layer.spatialReference)
  const drawingInfo = drawingInfoOf(layer)

  const featureJson = features.map(g => {
    const j = safeToJSON(g) ?? {}
    return { geometry: j.geometry, attributes: j.attributes ?? {} }
  })

  return {
    ...commonProps(layer),
    layerType: 'ArcGISFeatureLayer',
    showLabels: layer.labelsVisible === true,
    ...(layer.popupEnabled === false ? { disablePopup: true } : {}),
    featureCollection: {
      showLegend: layer.legendEnabled !== false,
      layers: [{
        layerDefinition: {
          name: titleOf(layer),
          type: 'Feature Layer',
          geometryType,
          objectIdField,
          fields,
          ...(sr ? { spatialReference: sr } : {}),
          ...(layer.definitionExpression ? { definitionExpression: layer.definitionExpression } : {}),
          ...(drawingInfo ? { drawingInfo } : {})
        },
        featureSet: { geometryType, features: featureJson },
        ...(popupInfo ? { popupInfo } : {})
      }]
    }
  }
}

function urlLayer (layer: any, layerType: string, extra: JsonObject = {}): JsonObject {
  return { ...commonProps(layer), layerType, url: layer.url, ...extra }
}

async function serializeLayer (layer: any, opts: SerializeOptions, warnings: SaveWarning[]): Promise<JsonObject | null> {
  const type: string = layer?.type
  const url: string | undefined = typeof layer?.url === 'string' ? layer.url : undefined
  const isLocal = !url || LOCAL_URL.test(url)

  try {
    switch (type) {
      case 'graphics': {
        if (!opts.includeDrawings) return null
        const graphics: any[] = layer.graphics?.toArray?.() ?? []
        if (!graphics.length) return null
        const graphicsJson = graphics.map(g => safeToJSON(g)).filter(Boolean) as JsonObject[]
        const { layer: fc, skipped, truncated } = drawingsToFeatureCollection(graphicsJson, {
          // Distinct id so the reopened drawings never clash with the Draw widget's own layer.
          id: `${layer.id}-drawings`, title: layer.title || 'Drawings', visible: layer.visible !== false, opacity: layer.opacity ?? 1
        }, opts.maxFeaturesPerLayer)
        if (skipped) warnings.push({ layer: titleOf(layer), reason: 'noGeometry' })
        if (truncated) warnings.push({ layer: titleOf(layer), reason: 'truncated' })
        return fc
      }
      case 'feature': {
        if (isLocal) return await toFeatureCollection(layer, opts.maxFeaturesPerLayer, warnings)
        const drawingInfo = drawingInfoOf(layer)
        const popupInfo = layer.popupTemplate ? safeToJSON(layer.popupTemplate) : undefined
        return {
          ...commonProps(layer),
          layerType: 'ArcGISFeatureLayer',
          url: featureServiceUrl(layer),
          showLabels: layer.labelsVisible === true,
          ...(layer.popupEnabled === false ? { disablePopup: true } : {}),
          ...(popupInfo ? { popupInfo } : {}),
          layerDefinition: {
            ...(layer.definitionExpression ? { definitionExpression: layer.definitionExpression } : {}),
            ...(drawingInfo ? { drawingInfo } : {})
          }
        }
      }
      case 'csv':
      case 'geojson': {
        if (isLocal) return await toFeatureCollection(layer, opts.maxFeaturesPerLayer, warnings)
        const drawingInfo = drawingInfoOf(layer)
        const popupInfo = layer.popupTemplate ? safeToJSON(layer.popupTemplate) : undefined
        const extra: JsonObject = {
          layerDefinition: drawingInfo ? { drawingInfo } : {},
          ...(popupInfo ? { popupInfo } : {}),
          showLabels: layer.labelsVisible === true
        }
        if (type === 'csv') {
          extra.locationInfo = {
            locationType: 'coordinates',
            latitudeFieldName: layer.latitudeField,
            longitudeFieldName: layer.longitudeField
          }
          if (layer.delimiter) extra.columnDelimiter = layer.delimiter
          return urlLayer(layer, 'CSV', extra)
        }
        return urlLayer(layer, 'GeoJSON', extra)
      }
      case 'kml':
        if (isLocal) { warnings.push({ layer: titleOf(layer), reason: 'localFileSource' }); return null }
        return urlLayer(layer, 'KML')
      case 'map-image':
        return urlLayer(layer, 'ArcGISMapServiceLayer')
      case 'tile':
        return urlLayer(layer, 'ArcGISTiledMapServiceLayer')
      case 'imagery':
        return urlLayer(layer, 'ArcGISImageServiceLayer')
      case 'imagery-tile':
        return urlLayer(layer, 'ArcGISTiledImageServiceLayer')
      case 'vector-tile': {
        const styleUrl = layer.url || layer.portalItem?.url
        if (!styleUrl && !layer.portalItem?.id) break
        return { ...commonProps(layer), layerType: 'VectorTileLayer', ...(styleUrl ? { styleUrl } : {}) }
      }
      case 'web-tile':
        if (!layer.urlTemplate) break
        return { ...commonProps(layer), layerType: 'WebTiledLayer', templateUrl: layer.urlTemplate }
      case 'wms': {
        const visibleLayers = (layer.allSublayers?.toArray?.() ?? [])
          .filter((s: any) => s.visible && s.name).map((s: any) => s.name)
        return urlLayer(layer, 'WMS', visibleLayers.length ? { visibleLayers } : {})
      }
      case 'group': {
        const children: JsonObject[] = []
        for (const child of layer.layers?.toArray?.() ?? []) {
          const c = await serializeLayer(child, opts, warnings)
          if (c) children.push(c)
        }
        return {
          ...commonProps(layer),
          layerType: 'GroupLayer',
          visibilityMode: layer.visibilityMode ?? 'independent',
          layers: children
        }
      }
      default:
        // Any other layer that came from a portal item can still be restored by item id.
        if (layer?.portalItem?.id) return { ...commonProps(layer) }
    }
  } catch {
    warnings.push({ layer: titleOf(layer), reason: 'failed' })
    return null
  }
  warnings.push({ layer: titleOf(layer), reason: 'unsupportedType' })
  return null
}

/** Should this top-level layer be written to the file? */
function shouldSave (layer: any, opts: SerializeOptions): boolean {
  if (!layer) return false
  if (layer.type === 'graphics') return opts.includeDrawings
  // Hidden helper layers added by other widgets are not part of the user's map.
  if (layer.listMode === 'hide') return false
  return true
}

/**
 * Build the .amap document from a 2D view.
 * `view` must be a loaded 2D MapView; `map` defaults to view.map.
 */
export async function buildWebMapJson (view: any, opts: SerializeOptions): Promise<SerializeResult> {
  const map = view.map
  const warnings: SaveWarning[] = []
  const operationalLayers: JsonObject[] = []

  for (const layer of map.layers?.toArray?.() ?? []) {
    if (!shouldSave(layer, opts)) continue
    const json = await serializeLayer(layer, opts, warnings)
    if (!json) continue
    if (json.url !== undefined && !isAllowedUrl(json.url)) {
      warnings.push({ layer: titleOf(layer), reason: 'notHttps' })
      continue
    }
    operationalLayers.push(json)
  }

  const baseMap = safeToJSON(map.basemap)
  const viewpoint = safeToJSON(view.viewpoint)
  const spatialReference = safeToJSON(view.spatialReference)

  const json: JsonObject = {
    operationalLayers,
    ...(baseMap ? { baseMap } : {}),
    ...(spatialReference ? { spatialReference } : {}),
    ...(viewpoint ? { initialState: { viewpoint } } : {}),
    authoringApp: AUTHORING_APP,
    authoringAppVersion: WIDGET_VERSION,
    version: WEBMAP_SPEC_VERSION
  }
  return { json, warnings, layerCount: operationalLayers.length }
}
