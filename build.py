#!/usr/bin/env python3
"""Stamp a version: content hashes on every JS/CSS URL (import map) + version.json for the update check.
Run before each deploy:  python3 build.py"""
import hashlib, json, os, re, time
root = os.path.dirname(os.path.abspath(__file__))
files = sorted(f for f in os.listdir(os.path.join(root, 'js')) if f.endswith('.js'))
h = lambda p: hashlib.sha1(open(os.path.join(root, p), 'rb').read()).hexdigest()[:10]
imports = {f'./js/{f}': f'./js/{f}?v={h("js/" + f)}' for f in files}
css_v = h('css/app.css')
version = hashlib.sha1(json.dumps(imports, sort_keys=True).encode() + css_v.encode()).hexdigest()[:10]
idx = os.path.join(root, 'index.html'); s = open(idx).read()
s = re.sub(r'\s*<script type="importmap">.*?</script>', '', s, flags=re.S)
s = re.sub(r'\s*<script>window.APP_VERSION=.*?</script>', '', s)
s = re.sub(r'css/app\.css(\?v=[0-9a-f]+)?', f'css/app.css?v={css_v}', s)
s = s.replace('<script type="module" src="js/app.js"></script>', '')
s = re.sub(r'\s*<script type="module" src="js/app\.js\?v=[0-9a-f]+"></script>', '', s)
tag = f'<script>window.APP_VERSION="{version}"</script>\n<script type="importmap">{json.dumps({"imports": imports})}</script>\n<script type="module" src="js/app.js?v={h("js/app.js")}"></script>'
s = s.replace('</body>', tag + '\n</body>')
open(idx, 'w').write(s)
json.dump({'version': version, 'built': time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}, open(os.path.join(root, 'version.json'), 'w'))
print('version', version)
