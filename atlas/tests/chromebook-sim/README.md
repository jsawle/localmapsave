# Simulated Chromebook test: local save on real files

Runs the real app in Chrome against real files, as an ordinary user, so file permissions apply. Earlier tests used simulated files, which can't show what Chrome does when the operating system refuses a write.

- **Chromebook-like:** 1366×768 screen, ChromeOS user agent, CPU slowed 2× (set `CPU=4` for a slower machine), network limited to 10 Mbps with 60 ms latency.
- **Real dialogs:** Chrome's own save and open boxes, and its "Save changes to …?" prompt, are answered with `xdotool`. Nothing in the app is replaced or stubbed.
- **Real permissions:** a student user, a classmate and a teacher, with a read-only class folder and two hand-in folders.

```
sudo atlas/tests/chromebook-sim/run.sh            # the lab app (atlas-sketch)
sudo atlas/tests/chromebook-sim/run.sh atlas      # the main app
```

Needs Linux, root, Python Playwright with Chromium, `xvfb-run`, `xdotool` and ImageMagick. Results print as they run and go to `/tmp/cbtest/results.json`, with screenshots in `/tmp/cbtest/shots/`.

## What it doesn't cover

- **ChromeOS itself.** ChromeOS runs the same Chrome file-saving code, but its save box is the Files app, not the Linux one used here.
- **Google Drive and OneDrive.** These are cloud folders with their own rules (view-only sharing, syncing later). There's nothing to simulate them with, so a test on a real Chromebook with school accounts is still needed.
- **School-managed policies** that may block saving to some places.

## Results (1 November 2026, atlas-sketch 1.15.0-sketch.9)

| Scenario | Result |
|---|---|
| S1 Own map in own folder: Save | Chrome asks once ("Save changes to mine.amap?"), then saves in place |
| S1b Save again | Saves in place, no question |
| S2 Reload, reopen from My map files, Save | Chrome asks once to open it again; Save then goes straight back to the file |
| S3 Read-only file in a folder the student can write to | Refused: "That file can't be changed…" and a save box; file unchanged |
| S4 Teacher's map in a read-only class folder | Refused, as S3; file unchanged |
| S5 Locked map: Save | "This map is locked…"; saved as "class - my copy"; locked map unchanged |
| S6 Save as, picking the teacher's read-only map | Chrome refuses; the app says nothing was saved; file unchanged |
| S7 Save a locked copy over a classmate's hand-in (shared folder) | Chrome refuses (the file is the classmate's); message; file unchanged |
| S8 The same in a folder with the sticky bit | As S7 |
| S9 The same, but the classmate's file is open to everyone | Replaced, and now owned by the student. Known limit: the folder's permissions allow it |

What this found:

- **Chrome checks the file, not only the folder.** A read-only file is refused even in a folder the student can write to (S3). It had been expected that it might be replaced, because Chrome saves by swapping a new file into place.
- **A refused save box was silent (fixed in 1.15.0-sketch.9).** When Chrome can't write the file picked in the save box, it reports it as `AbortError`, the same as Cancel ("Failed to create or truncate file" instead of "The user aborted a request."). The app took it as Cancel and said nothing, so a student could think their hand-in was saved. It now says nothing was saved and to choose another name or folder.
- **Hand-in folders depend on their permissions.** Where each student's file is theirs alone (S7, S8), nobody can save over it. Where everyone may change everyone's files (S9), a student who picks the same name replaces a classmate's hand-in.
- On this Linux save box, Chrome didn't ask "Replace?" before saving over an existing file. Whether ChromeOS's box asks hasn't been checked.
