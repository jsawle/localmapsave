/**
 * Version numbers shown in the widget footer and written into every .amap file.
 *
 * - WIDGET_VERSION: bump on every release (keep in sync with manifest.json "version").
 * - FORMAT_VERSION: version of the .amap writer/reader rules (what we put in the
 *   web map JSON and how we read it back). Bump whenever serialisation or
 *   open/merge behaviour changes.
 */
export const WIDGET_VERSION = '1.0.0'
export const FORMAT_VERSION = '1.0'

/** Web map specification version written to the file. */
export const WEBMAP_SPEC_VERSION = '2.31'

export const AUTHORING_APP = 'ExB Local Save widget'
export const FILE_EXTENSION = '.amap'
