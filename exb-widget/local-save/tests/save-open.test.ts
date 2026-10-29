/**
 * Save → file → open round trip with lightweight fakes of SDK objects.
 * (Real SDK/browser behaviour is checked by loading the widget in Developer Edition.)
 */
import { buildWebMapJson } from '../src/runtime/lib/serialize'
import { applyWebMapJson } from '../src/runtime/lib/apply'
import { parseWebMapText } from '../src/runtime/lib/amap-format'

class FakeCollection<T> {
  items: T[]
  constructor (items: T[] = []) { this.items = items }
  toArray () { return [...this.items] }
  get length () { return this.items.length }
  removeAll () { this.items = [] }
}

const json = (o: any) => ({ toJSON: () => JSON.parse(JSON.stringify(o)), clone () { return this } })

function graphic (geometry: any, attributes: any = {}, symbol?: any) {
  return { toJSON: () => ({ geometry, attributes, ...(symbol ? { symbol } : {}) }) }
}

function makeMap (layers: any[], basemapJson: any) {
  const coll = new FakeCollection(layers)
  const map: any = {
    layers: coll,
    basemap: { id: 'bm', toJSON: () => basemapJson },
    remove: (l: any) => { coll.items = coll.items.filter(x => x !== l) },
    addMany: (ls: any[]) => { coll.items.push(...ls) },
    reorder: (l: any, i: number) => {
      coll.items = coll.items.filter(x => x !== l)
      coll.items.splice(Math.min(i, coll.items.length), 0, l)
    }
  }
  return map
}

const BASEMAP = { title: 'Topographic', baseMapLayers: [{ id: 'b0', layerType: 'VectorTileLayer', styleUrl: 'https://basemaps/topo' }] }

function buildLiveView () {
  const csvLayer: any = {
    id: 'csv-1',
    type: 'feature',
    title: 'Litter survey',
    url: null,
    visible: true,
    opacity: 0.8,
    geometryType: 'point',
    objectIdField: 'ObjectID',
    fields: [json({ name: 'ObjectID', type: 'esriFieldTypeOID' }), json({ name: 'Plastic', type: 'esriFieldTypeInteger' })],
    renderer: json({ type: 'simple', symbol: { type: 'esriSMS', size: 8 } }),
    labelingInfo: [json({ labelExpressionInfo: { expression: '$feature.Plastic' } })],
    labelsVisible: true,
    popupTemplate: json({ title: '{Plastic}' }),
    spatialReference: json({ wkid: 4326 }),
    load: async () => {},
    createQuery: () => ({}),
    queryFeatures: async (q: any) => {
      expect(q.where).toBe('1=1')
      return {
        features: [
          graphic({ x: -117.16, y: 32.71, spatialReference: { wkid: 4326 } }, { ObjectID: 1, Plastic: 4 }),
          graphic({ x: -117.15, y: 32.72, spatialReference: { wkid: 4326 } }, { ObjectID: 2, Plastic: 9 })
        ]
      }
    }
  }
  const serviceLayer: any = {
    id: 'svc-1',
    type: 'feature',
    title: 'Schools',
    url: 'https://services.arcgis.com/x/arcgis/rest/services/Schools/FeatureServer',
    layerId: 0,
    portalItem: { id: 'item123' },
    visible: false,
    opacity: 1,
    definitionExpression: "TYPE = 'Primary'",
    renderer: json({ type: 'simple', symbol: { type: 'esriSMS', size: 6 } })
  }
  const drawLayer: any = {
    id: 'draw',
    type: 'graphics',
    title: 'Draw',
    listMode: 'hide',
    visible: true,
    opacity: 1,
    graphics: new FakeCollection([
      graphic({ x: 1, y: 1 }, {}, { type: 'esriSMS', color: [255, 0, 0, 255] }),
      graphic({ x: 2, y: 2 }, {}, { type: 'esriTS', text: 'Beach' })
    ])
  }
  const helper: any = { id: 'helper', type: 'feature', listMode: 'hide', url: 'https://x/FeatureServer/0' }
  const stream: any = { id: 'stream', type: 'stream', title: 'Live buses', url: 'https://x/StreamServer' }
  const group: any = {
    id: 'grp',
    type: 'group',
    title: 'Context',
    visible: true,
    opacity: 1,
    layers: new FakeCollection([{ id: 'tile', type: 'tile', title: 'Hillshade', url: 'https://x/MapServer', visible: true, opacity: 0.5 }])
  }
  const blobGeojson: any = { id: 'gj', type: 'geojson', title: 'Uploaded KML', url: 'blob:https://app/1', visible: true, opacity: 1, geometryType: 'polygon', fields: [] as any[], queryFeatures: async () => ({ features: [] as any[] }) }
  const blobKml: any = { id: 'kml', type: 'kml', title: 'My KML', url: 'blob:https://app/2' }

  const map = makeMap([serviceLayer, csvLayer, group, blobGeojson, blobKml, stream, helper, drawLayer], BASEMAP)
  const view: any = {
    type: '2d',
    map,
    viewpoint: json({ targetGeometry: { x: 0, y: 0, spatialReference: { wkid: 3857 } }, scale: 50000 }),
    spatialReference: json({ wkid: 3857 }),
    goTo: jest.fn(async () => {})
  }
  return { view, map, csvLayer, serviceLayer, drawLayer, helper }
}

describe('buildWebMapJson', () => {
  it('writes a valid web map with every supported layer kind', async () => {
    const { view } = buildLiveView()
    const { json: doc, warnings, layerCount } = await buildWebMapJson(view, { includeDrawings: true, maxFeaturesPerLayer: 1000 })

    const ids = doc.operationalLayers.map((l: any) => l.id)
    expect(ids).toEqual(['svc-1', 'csv-1', 'grp', 'gj', 'draw-drawings'])
    expect(layerCount).toBe(5)

    const svc = doc.operationalLayers[0]
    expect(svc.url).toBe('https://services.arcgis.com/x/arcgis/rest/services/Schools/FeatureServer/0')
    expect(svc.itemId).toBe('item123')
    expect(svc.visibility).toBe(false)
    expect(svc.layerDefinition.definitionExpression).toBe("TYPE = 'Primary'")

    const csv = doc.operationalLayers[1]
    const sub = csv.featureCollection.layers[0]
    expect(sub.featureSet.features).toHaveLength(2)
    expect(sub.layerDefinition.drawingInfo.labelingInfo).toHaveLength(1)
    expect(sub.popupInfo.title).toBe('{Plastic}')
    expect(csv.opacity).toBe(0.8)
    expect(csv.showLabels).toBe(true)

    expect(doc.operationalLayers[2].layers[0].layerType).toBe('ArcGISTiledMapServiceLayer')
    expect(doc.operationalLayers[4].featureCollection.layers[0].featureSet.features).toHaveLength(2)

    expect(warnings).toEqual(expect.arrayContaining([
      { layer: 'My KML', reason: 'localFileSource' },
      { layer: 'Live buses', reason: 'unsupportedType' }
    ]))
    expect(doc.baseMap).toEqual(BASEMAP)
    expect(doc.initialState.viewpoint.scale).toBe(50000)
    expect(doc.version).toMatch(/^2\./)

    // The text we write must pass our own open-time checks.
    expect(() => parseWebMapText(JSON.stringify(doc))).not.toThrow()
  })

  it('leaves drawings out when the setting is off, and caps features', async () => {
    const { view } = buildLiveView()
    const { json: doc, warnings } = await buildWebMapJson(view, { includeDrawings: false, maxFeaturesPerLayer: 1 })
    expect(doc.operationalLayers.map((l: any) => l.id)).not.toContain('draw-drawings')
    expect(doc.operationalLayers.find((l: any) => l.id === 'csv-1').featureCollection.layers[0].featureSet.features).toHaveLength(1)
    expect(warnings).toContainEqual({ layer: 'Litter survey', reason: 'truncated' })
  })
})

describe('applyWebMapJson', () => {
  function fakeCtors () {
    const created: any[] = []
    const WebMap = {
      fromJSON: (doc: any) => {
        const layers = new FakeCollection(doc.operationalLayers.map((l: any) => {
          const m = /^(.*FeatureServer)\/(\d+)$/.exec(l.url ?? '')
          const layer: any = {
            id: l.id,
            title: l.title,
            type: l.layerType === 'GroupLayer' ? 'group' : 'feature',
            url: m ? m[1] : (l.url ?? null),
            layerId: m ? Number(m[2]) : undefined,
            portalItem: l.itemId ? { id: l.itemId } : undefined,
            visible: l.visibility,
            opacity: l.opacity,
            renderer: l.layerDefinition?.drawingInfo?.renderer ? json(l.layerDefinition.drawingInfo.renderer) : undefined,
            definitionExpression: l.layerDefinition?.definitionExpression,
            destroy: jest.fn()
          }
          created.push(layer)
          return layer
        }))
        return { layers, load: async () => {}, destroy: jest.fn() }
      }
    }
    return {
      created,
      ctors: {
        WebMap,
        Basemap: { fromJSON: (b: any) => ({ id: 'new-basemap', toJSON: () => b }) },
        Viewpoint: { fromJSON: (v: any) => ({ vp: v }) }
      }
    }
  }

  it('merges a saved file back into a live map without breaking it', async () => {
    const saved = buildLiveView()
    const { json: doc } = await buildWebMapJson(saved.view, { includeDrawings: true, maxFeaturesPerLayer: 1000 })
    doc.operationalLayers[0].visibility = true // user had turned Schools on in the saved file
    doc.baseMap = { title: 'Imagery', baseMapLayers: [{ id: 'img', layerType: 'ArcGISTiledMapServiceLayer', url: 'https://img/MapServer' }] }

    // A fresh session: the app's web map has Schools + an extra layer, plus the Draw layer and a helper.
    const schools: any = { ...saved.serviceLayer, visible: false }
    const extra: any = { id: 'extra', type: 'feature', title: 'Not in file', url: 'https://x/FeatureServer', layerId: 3 }
    const draw: any = { ...saved.drawLayer, graphics: new FakeCollection([{}, {}, {}]) }
    const helper: any = saved.helper
    const map = makeMap([schools, extra, helper, draw], BASEMAP)
    const view: any = { type: '2d', map, goTo: jest.fn(async () => {}) }

    const { ctors } = fakeCtors()
    const result = await applyWebMapJson(JSON.parse(JSON.stringify(doc)), view, ctors, { maxFeaturesPerLayer: 1000, clearDrawings: true })

    const ids = map.layers.toArray().map((l: any) => l.id)
    expect(ids).toEqual(['svc-1', 'csv-1', 'grp', 'gj', 'draw-drawings', 'helper', 'draw'])
    expect(new Set(ids).size).toBe(ids.length) // no duplicate layer ids
    expect(map.layers.toArray()[0]).toBe(schools) // same live object kept
    expect(schools.visible).toBe(true) // state copied from file
    expect(ids).not.toContain('extra') // removed: not in file
    expect(ids).toContain('helper') // helper layers are never removed
    expect(draw.graphics.length).toBe(0) // Draw widget layer cleared, not removed
    expect(map.layers.toArray()).toContain(draw)
    expect(map.basemap.id).toBe('new-basemap')
    expect(view.goTo).toHaveBeenCalledTimes(1)
    expect(result.layerCount).toBe(5)
  })

  it('renames a file layer whose id clashes with a layer that stays in the map', async () => {
    const doc = { operationalLayers: [{ id: 'helper', title: 'Survey', featureCollection: { layers: [] as any[] } }], baseMap: BASEMAP }
    const helper: any = { id: 'helper', type: 'feature', listMode: 'hide' }
    const map = makeMap([helper], BASEMAP)
    const view: any = { type: '2d', map, goTo: jest.fn(async () => {}) }
    await applyWebMapJson(doc, view, fakeCtors().ctors, { maxFeaturesPerLayer: 1000, clearDrawings: true })
    expect(map.layers.toArray().map((l: any) => l.id)).toEqual(['helper-2', 'helper'])
  })

  it('does not replace the basemap when it is unchanged', async () => {
    const saved = buildLiveView()
    const { json: doc } = await buildWebMapJson(saved.view, { includeDrawings: false, maxFeaturesPerLayer: 1000 })
    const map = makeMap([], BASEMAP)
    const view: any = { type: '2d', map, goTo: jest.fn(async () => {}) }
    await applyWebMapJson(doc, view, fakeCtors().ctors, { maxFeaturesPerLayer: 1000, clearDrawings: true })
    expect(map.basemap.id).toBe('bm')
  })
})
