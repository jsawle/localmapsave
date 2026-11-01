#!/bin/bash
# Simulated Chromebook test of Atlas local save on real files. Needs Linux, root, Python Playwright
# with Chromium, xvfb-run, xdotool and ImageMagick (import). Serves the repo on port 8765.
# Usage: sudo atlas/tests/chromebook-sim/run.sh [atlas-sketch|atlas]
set -e
APP=${1:-atlas-sketch}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../.." && pwd)
OUT=${OUT:-/tmp/cbtest}; export OUT; mkdir -p "$OUT"; chmod 777 "$OUT"
for u in student student2 teacher; do id $u >/dev/null 2>&1 || useradd -m $u; done
# Chrome as the student must trust the same certificates as root (a proxy, say)
[ -d /root/.pki/nssdb ] && mkdir -p /home/student/.pki && cp -r /root/.pki/nssdb /home/student/.pki/ && chown -R student:student /home/student/.pki
curl -s -o /dev/null http://localhost:8765/ || (cd "$REPO" && nohup python3 -m http.server 8765 >/dev/null 2>&1 &) ; sleep 1
cp "$HERE/realdisk.py" "$OUT/"; chmod 755 "$OUT/realdisk.py"
su student -c "mkdir -p ~/work"
RUN() { su student -c "cd $OUT && OUT=$OUT ATLAS_URL='http://localhost:8765/$APP/?config=mapmaker' CPU=${CPU:-2} timeout 1500 xvfb-run -a -s '-screen 0 1366x768x24' python3 realdisk.py $1"; }
RUN base
B=/home/student/work/base.amap
lock() { python3 -c "import json,sys;d=json.load(open('$B'));d['atlasLocked']=True;json.dump(d,open(sys.argv[1],'w'))" "$1"; }
rm -f "/home/student/work/class - my copy.amap"
install -o student -g student -m 644 $B /home/student/work/mine.amap
rm -f /home/student/work/readonly.amap; install -o student -g student -m 444 $B /home/student/work/readonly.amap
mkdir -p /srv/class /srv/handin /srv/handin-sticky; rm -f /srv/class/* /srv/handin/* /srv/handin-sticky/*
cp $B /srv/class/class.amap; lock /srv/class/class_locked.amap
chown -R teacher:teacher /srv/class; chmod 755 /srv/class; chmod 644 /srv/class/*.amap
for d in /srv/handin /srv/handin-sticky; do lock $d/Coast_survey_locked.amap; chown student2:student2 $d/Coast_survey_locked.amap; chmod 644 $d/Coast_survey_locked.amap; done
lock /srv/handin/Open_to_all_locked.amap; chown student2:student2 /srv/handin/Open_to_all_locked.amap; chmod 666 /srv/handin/Open_to_all_locked.amap
chmod 777 /srv/handin; chmod 1777 /srv/handin-sticky
RUN run 2>&1 | grep -v -E "agent-proxy|connect_rejected|Allowed domains|For details|^- |X Error|Major opcode|Serial number"
