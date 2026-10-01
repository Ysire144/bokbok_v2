#!/usr/bin/env python3
"""twee 와 index.html 이 같은 내용인지, 스크립트 문법이 맞는지 확인: python3 check_sync.py <repo_dir>"""
import re, html, sys, os, subprocess, tempfile
repo = sys.argv[1] if len(sys.argv) > 1 else '.'
h = open(os.path.join(repo, 'index.html'), encoding='utf8').read()
t = open(os.path.join(repo, 'bokbok27_3.twee'), encoding='utf8').read()
js = re.search(r'id="twine-user-script"[^>]*>(.*?)</script><tw-tag', h, re.S).group(1)
css = re.search(r'id="twine-user-stylesheet"[^>]*>(.*?)</style>', h, re.S).group(1)
ts = t.split(':: StoryScript [script]\n', 1)[1].split('\n\n:: StoryStylesheet', 1)[0]
tc = t.split(':: StoryStylesheet [stylesheet]\n', 1)[1]
ok = True
def rep(name, good):
    global ok
    print(('OK   ' if good else 'FAIL ') + name)
    ok = ok and good
rep('스크립트 일치', js.strip() == ts.strip())
rep('스타일시트 일치', css.strip() == tc.strip())
hp = {}
for m in re.finditer(r'<tw-passagedata pid="\d+" name="([^"]*)" tags="([^"]*)"[^>]*>(.*?)</tw-passagedata>', h, re.S):
    hp[html.unescape(m.group(1))] = html.unescape(m.group(3)).strip()
tp = {}
for p in re.split(r'^:: ', t, flags=re.M)[1:]:
    head, _, body = p.partition('\n')
    name = re.match(r'(.*?)(?: \[[^\]]*\])?(?: \{.*\})?$', head.strip()).group(1)
    tp[name] = body.strip()
bad = [k for k in tp if k not in ('StoryTitle', 'StoryData', 'StoryScript', 'StoryStylesheet') and hp.get(k) != tp[k]]
rep('패시지 %d개 일치' % len(hp), not bad and set(hp) == set(k for k in tp if k not in ('StoryTitle', 'StoryData', 'StoryScript', 'StoryStylesheet')))
if bad: print('  다른 패시지:', bad[:5])
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf8') as f:
    f.write(js); name = f.name
r = subprocess.run(['node', '--check', name], capture_output=True, text=True)
rep('스크립트 문법 (node --check)', r.returncode == 0)
if r.returncode: print(r.stderr[:800])
os.unlink(name)
sys.exit(0 if ok else 1)
