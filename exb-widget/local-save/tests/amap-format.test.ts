import {
  safeFileName, geometryTypeOfJson, normaliseGeometryJson, drawingsToFeatureCollection,
  parseWebMapText, hardenWebMapJson, isSameLayerSource, AmapError, stableStringify
} from '../src/runtime/lib/amap-format'

describe('safeFileName', () => {
  it('adds .amap and strips bad characters', () => {
    expect(safeFileName('My map: v2?')).toBe('My map v2.amap')
    expect(safeFileName('trip.amap')).toBe('trip.amap')
    expect(safeFileName('old.json')).toBe('old.amap')
    expect(safeFileName('   ')).toBe('my-map.amap')
    expect(safeFileName(null, 'lesson')).toBe('lesson.amap')
    expect(safeFileName('...hidden')).toBe('hidden.amap')
    expect(safeFileName('a'.repeat(200)).length).toBe(85)
  })
})

describe('geometry helpers', () => {
  it('detects geometry types from JSON', () => {
    expect(geometryTypeOfJson({ x: 1, y: 2 })).toBe('esriGeometryPoint')
    expect(geometryTypeOfJson({ points: [] })).toBe('esriGeometryMultipoint')
    expect(geometryTypeOfJson({ paths: [] })).toBe('esriGeometryPolyline')
    expect(geometryTypeOfJson({ rings: [] })).toBe('esriGeometryPolygon')
    expect(geometryTypeOfJson({ xmin: 0, ymin: 0, xmax: 1, ymax: 1 })).toBe('esriGeometryPolygon')
    expect(geometryTypeOfJson(null)).toBeNull()
    expect(geometryTypeOfJson({ vertexSpace: {} })).toBeNull()
  })
  it('turns an extent into a closed polygon', () => {
    const p = normaliseGeometryJson({ xmin: 0, ymin: 0, xmax: 2, ymax: 1, spatialReference: { wkid: 3857 } })
    expect(p.rings[0]).toHaveLength(5)
    expect(p.rings[0][0]).toEqual(p.rings[0][4])
    expect(p.spatialReference).toEqual({ wkid: 3857 })
  })
})

describe('drawingsToFeatureCollection', () => {
  const red = { type: 'esriSMS', style: 'esriSMSCircle', color: [255, 0, 0, 255], size: 10 }
  const blue = { type: 'esriSMS', style: 'esriSMSCircle', color: [0, 0, 255, 255], size: 10 }
  const fill = { type: 'esriSFS', style: 'esriSFSSolid', color: [0, 255, 0, 100] }
  const text = (t: string) => ({ type: 'esriTS', text: t, color: [0, 0, 0, 255], font: { size: 12 } })
  const meta = { id: 'draw-1', title: 'Drawings', visible: true, opacity: 1 }

  it('groups by geometry type and keeps each symbol', () => {
    const graphics = [
      { geometry: { x: 1, y: 1 }, symbol: red },
      { geometry: { x: 2, y: 2 }, symbol: { ...red } }, // same symbol, different object
      { geometry: { x: 3, y: 3 }, symbol: blue },
      { geometry: { x: 4, y: 4 }, symbol: text('River') },
      { geometry: { x: 5, y: 5 }, symbol: text('Hill') }, // same style, different text
      { geometry: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 }, symbol: fill },
      { geometry: null, symbol: red }
    ]
    const { layer, skipped, truncated } = drawingsToFeatureCollection(graphics, meta, 100)
    expect(skipped).toBe(1)
    expect(truncated).toBe(false)
    expect(layer!.showLabels).toBe(true)
    const subs = layer!.featureCollection.layers
    expect(subs.map((s: any) => s.layerDefinition.geometryType)).toEqual(['esriGeometryPoint', 'esriGeometryPolygon'])

    const points = subs[0]
    expect(points.featureSet.features).toHaveLength(5)
    const infos = points.layerDefinition.drawingInfo.renderer.uniqueValueInfos
    expect(infos).toHaveLength(3) // red, blue, one text style
    const labels = points.layerDefinition.drawingInfo.labelingInfo
    expect(labels).toHaveLength(1)
    expect(labels[0].symbol.text).toBeUndefined()
    const texts = points.featureSet.features.map((f: any) => f.attributes._label).filter(Boolean)
    expect(texts).toEqual(['River', 'Hill'])
    expect(new Set(points.featureSet.features.map((f: any) => f.attributes.OBJECTID)).size).toBe(5)

    expect(subs[1].featureSet.features[0].geometry.rings).toBeDefined()
  })

  it('returns null when nothing can be stored and truncates at the cap', () => {
    expect(drawingsToFeatureCollection([{ geometry: null }], meta, 10).layer).toBeNull()
    const many = Array.from({ length: 20 }, (_, i) => ({ geometry: { x: i, y: i }, symbol: red }))
    const r = drawingsToFeatureCollection(many, meta, 5)
    expect(r.truncated).toBe(true)
    expect(r.layer!.featureCollection.layers[0].featureSet.features).toHaveLength(5)
  })

  it('gives graphics without a symbol a default one', () => {
    const r = drawingsToFeatureCollection([{ geometry: { paths: [[[0, 0], [1, 1]]] } }], meta, 10)
    expect(r.layer!.featureCollection.layers[0].layerDefinition.drawingInfo.renderer.uniqueValueInfos[0].symbol.type).toBe('esriSLS')
  })
})

describe('parseWebMapText', () => {
  it('accepts a web map', () => {
    expect(parseWebMapText('{"operationalLayers":[],"baseMap":{"baseMapLayers":[]}}').operationalLayers).toEqual([])
    expect(parseWebMapText('{"baseMap":{"baseMapLayers":[]}}').operationalLayers).toEqual([])
  })
  it('rejects other files with a reason', () => {
    const code = (t: string) => { try { parseWebMapText(t); return 'ok' } catch (e) { return (e as AmapError).code } }
    expect(code('not json')).toBe('notJson')
    expect(code('[1,2]')).toBe('notWebMap')
    expect(code('{"hello":1}')).toBe('notWebMap')
    expect(code('{"operationalLayers":[],"ground":{}}')).toBe('webScene')
  })
})

describe('hardenWebMapJson', () => {
  it('drops non-https layers, caps features and removes unused parts', () => {
    const features = Array.from({ length: 12 }, (_, i) => ({ geometry: { x: i, y: i }, attributes: {} }))
    const input = {
      operationalLayers: [
        { id: 'a', title: 'Safe', url: 'https://example.com/FeatureServer/0' },
        { id: 'b', title: 'Plain http', url: 'http://example.com/FeatureServer/0' },
        { id: 'c', title: 'Blob', url: 'blob:https://x/123' },
        { id: 'd', title: 'Script', styleUrl: 'javascript:alert(1)' },
        {
          id: 'g',
          title: 'Group',
          layerType: 'GroupLayer',
          layers: [{ id: 'g1', title: 'Inner http', url: 'http://x' }, { id: 'g2', title: 'Inner ok', url: 'https://x' }]
        },
        { id: 'fc', title: 'Collection', featureCollection: { layers: [{ featureSet: { features } }, { featureSet: { features } }] } }
      ],
      baseMap: { baseMapLayers: [{ url: 'https://ok' }, { url: 'http://bad' }] },
      bookmarks: [{}],
      applicationProperties: {}
    }
    const { json, warnings } = hardenWebMapJson(input, 15)
    expect(json.operationalLayers.map((l: any) => l.id)).toEqual(['a', 'g', 'fc'])
    expect(json.operationalLayers[1].layers.map((l: any) => l.id)).toEqual(['g2'])
    const fc = json.operationalLayers[2].featureCollection.layers
    expect(fc[0].featureSet.features).toHaveLength(12)
    expect(fc[1].featureSet.features).toHaveLength(3)
    expect(json.baseMap.baseMapLayers).toHaveLength(1)
    expect(json.bookmarks).toBeUndefined()
    expect(json.applicationProperties).toBeUndefined()
    expect(warnings.filter(w => w.reason === 'notHttps')).toHaveLength(4)
    expect(warnings.some(w => w.reason === 'truncated' && w.layer === 'Collection')).toBe(true)
    // input not mutated
    expect(input.operationalLayers).toHaveLength(6)
  })
})

describe('isSameLayerSource', () => {
  it('matches on id plus url or item', () => {
    const a = { id: 'x', url: 'https://s/FeatureServer', layerId: 0 }
    expect(isSameLayerSource(a, { id: 'x', url: 'https://S/FeatureServer/', layerId: 0 })).toBe(true)
    expect(isSameLayerSource(a, { id: 'x', url: 'https://s/FeatureServer', layerId: 1 })).toBe(false)
    expect(isSameLayerSource(a, { id: 'y', url: 'https://s/FeatureServer', layerId: 0 })).toBe(false)
    expect(isSameLayerSource({ id: 'x', itemId: 'abc' }, { id: 'x', itemId: 'abc', url: 'https://other' })).toBe(true)
    expect(isSameLayerSource({ id: 'x' }, { id: 'x' })).toBe(false)
  })
})

describe('stableStringify', () => {
  it('ignores key order and undefined values', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe(stableStringify({ a: [1, { d: 2 }], b: 1 }))
  })
})
