"""Atlas local save on real files, Chromebook-like browser.

Runs the real lab app in headed Chromium as an ordinary (non-root) user, so file
permissions apply. The native file dialogs and Chrome's "Save changes?" prompt are
driven with xdotool. Chromebook-like: 1366x768 window, ChromeOS user agent, CPU
slowed 4x, network limited to school-wifi speeds.

Phase "base": save one map to ~/work/base.amap (used to build the fixtures).
Phase "run": the scenarios. Results go to stdout and $OUT/results.json (default /tmp/cbtest).
"""
import json, os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

PHASE = sys.argv[1]
URL = os.environ.get("ATLAS_URL", "http://localhost:8765/atlas-sketch/?config=mapmaker")
OUT = os.environ.get("OUT", "/tmp/cbtest"); SHOTS = OUT + "/shots"; os.makedirs(SHOTS, exist_ok=True)
HOME = os.path.expanduser("~")
UA = "Mozilla/5.0 (X11; CrOS x86_64 16328.65.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--window-size=1366,768", "--window-position=0,0"]
TOASTS = """window.__toasts = []; setInterval(() => { const t = document.getElementById('toast'), x = t && t.textContent.trim();
  if (x && window.__toasts[window.__toasts.length - 1] !== x) window.__toasts.push(x); }, 100);"""

def sh(*a): return subprocess.run(list(a), capture_output=True, text=True).stdout.strip()
def shot(n): os.system(f"import -window root {SHOTS}/{n}.png")
def windows(): return [w for w in sh("xdotool", "search", "--onlyvisible", "--name", ".+").split()]
def chrome_win(): return next((w for w in windows() if "Chrome" in sh("xdotool", "getwindowname", w)), None)
def dialog(wait=6.0):
    end = time.time() + wait
    while time.time() < end:
        ws = [w for w in windows() if "Chrome" not in sh("xdotool", "getwindowname", w)]
        if ws: return ws[-1], sh("xdotool", "getwindowname", ws[-1])
        time.sleep(0.3)
    return None, None

def pick(path, kind, tag):
    """Answer a native open/save dialog with a full path. Returns the dialog title, or None if none appeared.
    GTK's name box offers a completion for an existing file: Return accepts it, then alt+s / alt+o confirms."""
    w, title = dialog()
    if not w: return None
    if kind == "save": os.system(f"xdotool windowfocus --sync {w} key ctrl+a")
    os.system(f"xdotool windowfocus --sync {w} type --delay 12 '{path}'"); time.sleep(0.6)
    if kind == "save": os.system(f"xdotool windowfocus --sync {w} key --clearmodifiers Return"); time.sleep(1.2)
    if dialog(0.5)[0]:
        os.system(f"xdotool windowfocus --sync {w} key --clearmodifiers {'alt+s' if kind == 'save' else 'alt+o'} 2>/dev/null"); time.sleep(1.2)
    if dialog(0.5)[0]: shot(tag + "-dialog-still-open")
    return title

def cancel_dialog():
    w, _ = dialog(4)
    if w: os.system(f"xdotool windowfocus --sync {w} key --clearmodifiers Escape 2>/dev/null"); time.sleep(1)
    return bool(w)

def prompt_visible():
    """Chrome's own permission prompt hangs from the address bar, top centre, with a solid blue button."""
    from PIL import Image
    os.system(f"import -window root {OUT}/_probe.png")
    im = Image.open(OUT + "/_probe.png").convert("RGB")
    blue = 0
    for x in range(380, 1000, 3):
        for y in range(85, 260, 3):
            r, g, bl = im.getpixel((x, y))
            if r < 40 and 70 <= g <= 120 and bl > 180: blue += 1
    return blue > 60

def accept_prompt(pg, tag, wait=5.0):
    """Press "Save changes" / "Allow" on Chrome's own prompt if it appears. Returns whether it did."""
    end = time.time() + wait
    while time.time() < end:
        if prompt_visible():
            shot(tag + "-prompt"); cw = chrome_win()
            os.system(f"xdotool windowfocus --sync {cw} key --clearmodifiers Tab Return"); time.sleep(2)
            return True
        time.sleep(0.4)
    return False

def stat(path):
    try:
        s = os.stat(path); txt = open(path, encoding="utf-8", errors="replace").read()
        locked = None
        try: locked = json.loads(txt).get("atlasLocked") is True
        except Exception: pass
        return {"exists": True, "size": s.st_size, "mtime": s.st_mtime_ns, "ino": s.st_ino, "uid": s.st_uid, "mode": oct(s.st_mode & 0o777), "locked": locked}
    except FileNotFoundError: return {"exists": False}
    except PermissionError: return {"exists": True, "unreadable": True}

def launch(p):
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix="cb-"), headless=False, args=ARGS, user_agent=UA,
                                               viewport={"width": 1366, "height": 680})
    ctx.add_init_script(TOASTS)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    cdp = ctx.new_cdp_session(pg)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": float(os.environ.get("CPU", "2"))})
    cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 60, "downloadThroughput": 1_250_000, "uploadThroughput": 625_000})
    pg.goto(URL); ready(pg)
    return ctx, pg

def ready(pg):
    pg.wait_for_selector("#tool-save", state="visible", timeout=60000)
    pg.wait_for_function("() => !!document.querySelector('arcgis-map, .esri-view, canvas')", timeout=90000)
    pg.wait_for_timeout(6000)

def toasts(pg): return pg.evaluate("window.__toasts.splice(0)")
def open_panel(pg):
    if not pg.is_visible("#savePanel"): pg.click("#tool-save"); pg.wait_for_timeout(600)
def press(pg, tile): close_modals(pg); open_panel(pg); pg.click(tile, no_wait_after=True)
def close_modals(pg):
    for _ in range(4):
        if not pg.is_visible("#openModal"): return
        try: pg.click("#openModal [data-modal-close]", timeout=3000)
        except Exception: pg.keyboard.press("Escape")
        pg.wait_for_timeout(500)
def open_file(pg, path, tag):
    close_modals(pg); pg.click("#tool-open"); pg.wait_for_timeout(700); pg.click("#tabDevice"); pg.wait_for_timeout(600)
    pg.click("#browseDevice", no_wait_after=True)
    t = pick(path, "open", tag)
    for _ in range(40):   # wait until the map has opened (its file name becomes the title)
        if not dialog(0.2)[0] and not pg.is_visible("#openModal"): break
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(1500); shot(tag + "-opened"); close_modals(pg)
    return t

RESULTS = []
import atexit; atexit.register(lambda: json.dump(RESULTS, open(OUT + '/results.json', 'w'), indent=1))
def record(name, expect, **got):
    RESULTS.append({"scenario": name, "expected": expect, **got})
    print(f"\n== {name}\n   expected: {expect}")
    for k, v in got.items(): print(f"   {k}: {v}")

with sync_playwright() as p:
    if PHASE == "base":
        ctx, pg = launch(p)
        press(pg, "#saveTile"); t = pick(f"{HOME}/work/base.amap", "save", "base")
        pg.wait_for_timeout(3000)
        print("dialog:", t, "toasts:", toasts(pg), "file:", stat(f"{HOME}/work/base.amap")); ctx.close(); sys.exit()

    ctx, pg = launch(p)
    for tag in ("S6","S7","S8"): pass

    # S1 own map in own folder: open, Save -> Chrome asks once, then writes in place
    f = f"{HOME}/work/mine.amap"; before = stat(f)
    open_file(pg, f, "s1"); toasts(pg)
    press(pg, "#saveTile"); asked = accept_prompt(pg, "s1"); pg.wait_for_timeout(2500)
    d, _ = dialog(1)
    record("S1 own map, own folder: Save", "Chrome asks to allow editing once; saved in place, no save box",
           asked=asked, save_box=bool(d), toasts=toasts(pg), before=before, after=stat(f))
    if d: cancel_dialog()

    # S1b Save again: no prompt now
    before = stat(f); press(pg, "#saveTile"); asked = accept_prompt(pg, "s1b", 3); pg.wait_for_timeout(2000); shot("s1b")
    record("S1b Save again", "no prompt, no save box, file updated", asked=asked, toasts=toasts(pg), before=before, after=stat(f))

    # S2 next lesson: reload, reopen from the saved-maps list, Save
    pg.reload(); ready(pg); toasts(pg)
    pg.click("#tool-open"); pg.wait_for_timeout(700); pg.click("#tabDevice"); pg.wait_for_timeout(1500)
    shot("s2-list")
    first = pg.locator("#savedList .cat-act:not(.quiet)").first
    listed = first.count() > 0
    if listed:
        first.click(no_wait_after=True); asked_read = accept_prompt(pg, "s2-read"); pg.wait_for_timeout(4000)
        close_modals(pg); before = stat(f)
        press(pg, "#saveTile"); asked_write = accept_prompt(pg, "s2-write"); pg.wait_for_timeout(2500)
    d, _ = dialog(1)
    record("S2 reload, reopen from My map files, Save", "asked to allow, then saved in place",
           listed=listed, asked_to_open=asked_read if listed else None, asked_to_save=asked_write if listed else None, save_box=bool(d), toasts=toasts(pg), before=before if listed else None, after=stat(f))
    if d: cancel_dialog()

    # S3 read-only file (chmod 444) in a folder the student can write to
    f = f"{HOME}/work/readonly.amap"; before = stat(f)
    open_file(pg, f, "s3"); toasts(pg)
    press(pg, "#saveTile"); asked = accept_prompt(pg, "s3"); pg.wait_for_timeout(2500)
    d, title = dialog(1.5); shot("s3-after")
    record("S3 read-only file, writable folder: Save", "refused: 'can't be changed' + save box; file unchanged",
           asked=asked, save_box=title, toasts=toasts(pg), before=before, after=stat(f))
    if d: cancel_dialog()

    # S4 teacher's map in a folder students can only read
    f = "/srv/class/class.amap"; before = stat(f)
    open_file(pg, f, "s4"); toasts(pg)
    press(pg, "#saveTile"); asked = accept_prompt(pg, "s4"); pg.wait_for_timeout(2500)
    d, title = dialog(1.5); shot("s4-after")
    record("S4 teacher's map, read-only folder: Save", "refused: 'can't be changed' + save box; file unchanged",
           asked=asked, save_box=title, toasts=toasts(pg), before=before, after=stat(f))
    if d: cancel_dialog()

    # S5 locked map in the teacher's folder: Save makes the student's own copy
    f = "/srv/class/class_locked.amap"; before = stat(f)
    open_file(pg, f, "s5"); toasts(pg)
    close_modals(pg); press(pg, "#saveTile"); t = pick(f"{HOME}/work/class - my copy.amap", "save", "s5"); pg.wait_for_timeout(3000)
    record("S5 locked map: Save", "save box (suggests '- my copy'); new unlocked file; locked map unchanged",
           save_box=t, toasts=toasts(pg), before=before, after=stat(f), copy=stat(f"{HOME}/work/class - my copy.amap"))

    # S6 Save as onto the teacher's read-only map
    f = "/srv/class/class.amap"; before = stat(f)
    close_modals(pg); press(pg, "#saveAsTile"); t = pick(f, "save", "s6"); pg.wait_for_timeout(3000)
    d, title = dialog(1.5); shot("s6-after")
    record("S6 Save as onto the teacher's read-only map", "message: nothing saved, choose another name or folder; teacher's file unchanged",
           save_box=t, second_box=title, toasts=toasts(pg), before=before, after=stat(f))
    if d: cancel_dialog()

    # S7 hand-in folder anyone can write to: Save a locked copy over a classmate's hand-in (same suggested name)
    for tag, folder in (("S7", "/srv/handin"), ("S8", "/srv/handin-sticky")):
        f = f"{folder}/Coast_survey_locked.amap"; before = stat(f)
        close_modals(pg); press(pg, "#lockTile"); t = pick(f, "save", tag.lower()); pg.wait_for_timeout(3000)
        d, title = dialog(1.5); shot(tag.lower() + "-after")
        record(f"{tag} Save a locked copy onto a classmate's hand-in ({'sticky folder' if 'sticky' in folder else 'shared folder'})",
               "message: nothing saved; classmate's file unchanged", save_box=t, second_box=title, toasts=toasts(pg), before=before, after=stat(f))
        if d: cancel_dialog()

    # S9 a classmate's hand-in that everyone may change (e.g. a folder that gives all students Modify)
    f = "/srv/handin/Open_to_all_locked.amap"; before = stat(f)
    close_modals(pg); press(pg, "#lockTile"); t = pick(f, "save", "s9"); pg.wait_for_timeout(3000)
    record("S9 Save a locked copy onto a classmate's hand-in that anyone may change",
           "known limit: replaced (the folder's permissions allow it)", save_box=t, toasts=toasts(pg), before=before, after=stat(f))

    ctx.close()
