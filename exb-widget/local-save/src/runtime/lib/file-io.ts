/**
 * Local file open/save.
 *
 * Chromium browsers (Chrome, Edge, managed Chromebooks) get the File System
 * Access API, so Save can overwrite the same file. Elsewhere (Safari, Firefox,
 * cross-origin iframes) Save downloads a file and Open uses a file input.
 * No data is sent anywhere: the file goes from the browser to the device.
 */
import { FILE_EXTENSION } from './version'

export type FileHandle = any // FileSystemFileHandle (not in TS lib.dom yet)

export interface OpenedFile {
  name: string
  size: number
  text: () => Promise<string>
  handle: FileHandle | null
}

export interface SavedFile {
  name: string
  handle: FileHandle | null
  method: 'picker' | 'download'
}

const PICKER_TYPES = [{
  description: 'Map file',
  accept: { 'application/json': [FILE_EXTENSION, '.json'] }
}]

function hasPicker (kind: 'showOpenFilePicker' | 'showSaveFilePicker'): boolean {
  return typeof window !== 'undefined' && typeof (window as any)[kind] === 'function'
}

function isAbort (e: any): boolean {
  return e?.name === 'AbortError'
}

/** Returns null if the user cancelled. */
export async function openLocalFile (): Promise<OpenedFile | null> {
  if (hasPicker('showOpenFilePicker')) {
    try {
      const [handle] = await (window as any).showOpenFilePicker({ types: PICKER_TYPES, multiple: false })
      const file: File = await handle.getFile()
      return { name: file.name, size: file.size, text: () => file.text(), handle }
    } catch (e) {
      if (isAbort(e)) return null
      // SecurityError (e.g. cross-origin iframe): fall through to the input.
    }
  }
  return await new Promise<OpenedFile | null>(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `${FILE_EXTENSION},.json,application/json`
    input.style.display = 'none'
    let settled = false
    const done = (v: OpenedFile | null) => { if (!settled) { settled = true; input.remove(); resolve(v) } }
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      done(file ? { name: file.name, size: file.size, text: () => file.text(), handle: null } : null)
    })
    input.addEventListener('cancel', () => done(null))
    document.body.appendChild(input)
    input.click()
  })
}

async function writeToHandle (handle: FileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(new Blob([text], { type: 'application/json' }))
  await writable.close()
}

function download (text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/**
 * Step 1 of saving: decide where the file goes. Call this straight from the
 * click handler (before any slow work) because browsers only show the save
 * dialog while the click is still "fresh".
 * - handle given → reuse it (overwrite the same file)
 * - no handle → ask where to save (picker) or plan a download
 * Returns null if the user cancelled.
 */
export async function chooseSaveTarget (suggestedName: string, handle: FileHandle | null): Promise<SavedFile | null> {
  if (handle) {
    // Files opened with the picker are read-only until the user allows writing;
    // ask now, while the click is fresh.
    let permission = 'granted'
    try {
      if (typeof handle.queryPermission === 'function') permission = await handle.queryPermission({ mode: 'readwrite' })
      if (permission !== 'granted' && typeof handle.requestPermission === 'function') permission = await handle.requestPermission({ mode: 'readwrite' })
    } catch {
      permission = 'denied'
    }
    if (permission === 'granted') return { name: handle.name ?? suggestedName, handle, method: 'picker' }
    // Not allowed (e.g. read-only file): behave like Save As.
  }
  if (hasPicker('showSaveFilePicker')) {
    try {
      const newHandle = await (window as any).showSaveFilePicker({ suggestedName, types: PICKER_TYPES })
      return { name: newHandle.name ?? suggestedName, handle: newHandle, method: 'picker' }
    } catch (e) {
      if (isAbort(e)) return null
      // SecurityError (iframe, no user gesture): download instead.
    }
  }
  return { name: suggestedName, handle: null, method: 'download' }
}

/**
 * Step 2 of saving: write the text. If writing to a handle fails (permission
 * refused, file moved) the file is downloaded instead so work is never lost.
 */
export async function writeSaveTarget (target: SavedFile, text: string): Promise<SavedFile> {
  if (target.handle) {
    try {
      await writeToHandle(target.handle, text)
      return target
    } catch {
      // fall through to download
    }
  }
  download(text, target.name)
  return { name: target.name, handle: null, method: 'download' }
}
