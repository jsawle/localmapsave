import type { ImmutableObject } from 'jimu-core'

export interface Config {
  /** Save drawings (graphics layers, e.g. from the Draw widget) into the file. */
  includeDrawings: boolean
  /** Ask the browser to warn before leaving the page with unsaved changes. */
  warnBeforeLeaving: boolean
  /**
   * Signed-in users whose ArcGIS user type cannot create content
   * (no portal:user:createItem privilege) can open files but not save them.
   * Anonymous users are not affected.
   */
  respectUserPrivileges: boolean
  /** Maximum features saved (and opened) per layer. */
  maxFeaturesPerLayer: number
  /** Files larger than this are not opened. */
  maxFileSizeMB: number
  /** Suggested name for a new file (".amap" is added). */
  defaultFileName: string
}

export type IMConfig = ImmutableObject<Config>

export const DEFAULT_CONFIG: Config = {
  includeDrawings: true,
  warnBeforeLeaving: true,
  respectUserPrivileges: true,
  maxFeaturesPerLayer: 5000,
  maxFileSizeMB: 10,
  defaultFileName: 'my-map'
}

/** Read config with defaults so older/partial saved config keeps working. */
export function readConfig (config: Partial<Config> | null | undefined): Config {
  const c = config ?? {}
  const num = (v: unknown, d: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d
  return {
    includeDrawings: typeof c.includeDrawings === 'boolean' ? c.includeDrawings : DEFAULT_CONFIG.includeDrawings,
    warnBeforeLeaving: typeof c.warnBeforeLeaving === 'boolean' ? c.warnBeforeLeaving : DEFAULT_CONFIG.warnBeforeLeaving,
    respectUserPrivileges: typeof c.respectUserPrivileges === 'boolean' ? c.respectUserPrivileges : DEFAULT_CONFIG.respectUserPrivileges,
    maxFeaturesPerLayer: num(c.maxFeaturesPerLayer, DEFAULT_CONFIG.maxFeaturesPerLayer, 1, 50000),
    maxFileSizeMB: num(c.maxFileSizeMB, DEFAULT_CONFIG.maxFileSizeMB, 1, 100),
    defaultFileName: typeof c.defaultFileName === 'string' && c.defaultFileName.trim() ? c.defaultFileName : DEFAULT_CONFIG.defaultFileName
  }
}
