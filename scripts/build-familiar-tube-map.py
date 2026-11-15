"""Build a static, Tube-only derivative of Sameboat's hand-positioned SVG.

The derived artwork remains CC BY-SA 4.0. No third-party script or animation
is carried into the application. The live TfL snapshot defines station scope.
"""
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
NS = 'http://www.w3.org/2000/svg'
XL = 'http://www.w3.org/1999/xlink'
ET.register_namespace('', NS)
ET.register_namespace('xlink', XL)
tag = lambda name: '{' + NS + '}' + name
source = (ROOT / 'vendor/tube-map-source.svg').read_bytes()
tree = ET.fromstring(source)
ids = {e.get('id'): e for e in tree.iter() if e.get('id')}
stations = json.loads(subprocess.check_output(['node', '-e',
    "const n=require('./network-map.js');console.log(JSON.stringify([...n.schematicLayout(require('./tube-network.js').datasets).stations.values()]))"], cwd=ROOT))

def key(value):
    return re.sub('[^a-z0-9]', '', value.lower().replace('&', 'and').replace('underground station', '').replace(' st.', ' st'))

by_name = {key(s['name']): s for s in stations}
aliases = {
    'heathrowterminal4': 'heathrowairportterminal4',
    'heathrowterminal5': 'heathrowairportterminal5',
    'edgwareroadcircle': 'edgwareroadcircleline',
    'hammersmithdistrictpiccadilly': 'hammersmith',
    'hammersmithcircle': 'hammersmith',
    'hammersmithandcity': 'hammersmith',
    'kingscrossstpancras': 'kingscrossstpancras',
    'heathrow23': 'heathrowterminals2and3',
    'heathrow4': 'heathrowairportterminal4',
    'heathrow5': 'heathrowairportterminal5',
}

def match(value):
    k = key(value)
    direct = by_name.get(aliases.get(k, k))
    if direct: return direct
    cleaned = re.sub(r'_(?:bakerloo|central|district|hnc|circle|piccadilly|metropolitan|jubilee|northern|victoria|base|mid|top|nr|surface|deep)$', '', value, flags=re.I)
    return match(cleaned) if cleaned != value else None

def mul(a, b):
    return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]

def matrix(raw):
    result = [1, 0, 0, 1, 0, 0]
    for name, args in re.findall(r'(\w+)\(([^)]+)\)', raw or ''):
        n = [float(v) for v in re.findall(r'-?\d*\.?\d+(?:[eE][-+]?\d+)?', args)]
        if name == 'translate': m = [1, 0, 0, 1, n[0], n[1] if len(n)>1 else 0]
        elif name == 'scale': m = [n[0], 0, 0, n[1] if len(n)>1 else n[0], 0, 0]
        elif name == 'matrix': m = n
        elif name == 'rotate':
            a = math.radians(n[0]); m = [math.cos(a), math.sin(a), -math.sin(a), math.cos(a), 0, 0]
            if len(n) == 3: m = mul(mul([1,0,0,1,n[1],n[2]], m), [1,0,0,1,-n[1],-n[2]])
        else: raise ValueError('Unsupported SVG transform: ' + name)
        result = mul(result, m)
    return result

parents = {child: parent for parent in tree.iter() for child in parent}
def ancestors_transform(node):
    chain = []; parent = parents.get(node)
    while parent is not None:
        chain.append(parent); parent = parents.get(parent)
    result = [1,0,0,1,0,0]
    for parent in reversed(chain): result = mul(result, matrix(parent.get('transform')))
    return result

out = ET.Element(tag('svg'), {'viewBox': tree.get('viewBox'), 'id':'journey-authored-map', 'role': 'group', 'aria-label': 'London Underground diagram'})
ET.SubElement(out, tag('title')).text = 'London Underground - hand-positioned diagram'
ET.SubElement(out, tag('desc')).text = 'Tube-only adaptation of Sameboat, CC BY-SA 4.0. Simplified by Journey; not an official TfL map. Live routes and service status are separate.'
style = copy.deepcopy(next(e for e in tree if e.tag == tag('style')))
style.text = re.sub(r'[^{}]+\{[^{}]*\}', lambda m: m[0] if not any(x in m[0] for x in ['hover', 'active', 'cursor', 'blink']) else '', style.text)
style.text = re.sub(r'([^{}]+)\{', lambda m: ','.join('#journey-authored-map ' + s.strip() for s in m[1].split(','))+'{', style.text)
out.append(style)
for d in tree:
    if d.tag == tag('defs'): out.append(copy.deepcopy(d))
river = ids.get('rv')
if river is not None: out.append(copy.deepcopy(river))
routes = ET.SubElement(out, tag('g'), {'id': 'diagram-routes'})
names = {'bakerloo':'Bakerloo', 'central':'Central', 'circle':'Circle', 'district':'District', 'hammersmith-city':'Hammersmith_and_City', 'jubilee':'Jubilee', 'metropolitan':'Metropolitan', 'northern':'Northern', 'piccadilly':'Piccadilly', 'victoria':'Victoria', 'waterloo-city':'Waterloo_and_City'}
colours = {d['definition'][0]:d['definition'][1] for d in json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./tube-network.js').datasets))"],cwd=ROOT))}
for line, name in names.items():
    for path_id in [name + '_line_route'] + (['District_Olympia_branch'] if line == 'district' else []):
        original = ids[path_id]
        # Each absolute moveto becomes a separate, continuous route branch.
        for i, d in enumerate(re.split(r'(?=M)', original.get('d').strip())):
            if not d.strip(): continue
            ET.SubElement(routes, tag('path'), {'id': f'line-{line}-{i}-{path_id}', 'data-line':line, 'd':d.strip(), 'fill':'none', 'stroke':colours[line], 'stroke-width':'5', 'stroke-linecap':'round', 'stroke-linejoin':'round'})

markers = ET.SubElement(out, tag('g'), {'id': 'diagram-stations'})
positions = {}
for node in ids['station_nodes'].iter():
    if node.tag != tag('use'): continue
    node_id = node.get('id') or parents.get(node).get('id', '')
    if any(s in node_id.lower() for s in ['overground', 'elizabeth', '_dlr', '_osi']) or node.get('{'+XL+'}href') in ['#nr', '#intnrbase', '#intbase']: continue
    station = match(node_id)
    if not station: continue
    inherited = ancestors_transform(node)
    own = matrix(node.get('transform'))
    m = mul(inherited, own)
    x, y = float(node.get('x', 0)), float(node.get('y', 0))
    point = [round(m[0]*x+m[2]*y+m[4],3), round(m[1]*x+m[3]*y+m[5],3)]
    positions.setdefault(station['id'], []).append(point)
    group = ET.SubElement(markers, tag('g'), {'data-station':station['id'], 'data-x':str(point[0]), 'data-y':str(point[1]), 'role':'button', 'tabindex':'-1', 'aria-label':station['name']})
    wrapper = ET.SubElement(group, tag('g'), {'transform':'matrix(' + ' '.join(map(str,inherited)) + ')'})
    marker = copy.deepcopy(node); marker.attrib.pop('id', None); wrapper.append(marker)
    if marker.get('{'+XL+'}href') in ['#intnrtop', '#inttop']: marker.set('{'+XL+'}href', '#int')

# Source artwork draws Bank/Monument as a compound glyph rather than named uses.
for name, point in [('Bank',[1474.5,558]), ('Monument',[1494.75,585])]:
    station = by_name[key(name)]; positions[station['id']] = [point]
    group = ET.SubElement(markers, tag('g'), {'data-station':station['id'], 'data-x':str(point[0]), 'data-y':str(point[1]), 'role':'button', 'tabindex':'-1', 'aria-label':name})
    ET.SubElement(group, tag('circle'), {'cx':str(point[0]),'cy':str(point[1]),'r':'4.5','fill':'white','stroke':'black','stroke-width':'2'})

labels = ET.SubElement(out, tag('g'), {'id':'diagram-labels', 'class':'st'})
label_candidates = {}
def visible_text(node):
    return (node.text or '') + ''.join((visible_text(c) if c.tag != tag('title') else '') + (c.tail or '') for c in node)

for node in ids['stname'].iter():
    if node.tag != tag('text'): continue
    m = mul(ancestors_transform(node), matrix(node.get('transform')))
    x, y = float(node.get('x',0)), float(node.get('y',0))
    point = [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]]
    label_name = visible_text(node).strip()
    station = match(label_name)
    if not station and key(label_name) == 'edgwareroad':
        station = min([s for s in stations if s['name'].startswith('Edgware Road (')], key=lambda s: min(math.hypot(point[0]-p[0],point[1]-p[1]) for p in positions[s['id']]))
    if not station: continue
    distance = min(math.hypot(point[0]-p[0],point[1]-p[1]) for p in positions[station['id']])
    label_candidates.setdefault(station['id'],[]).append((distance,point,node,station))

for candidates in label_candidates.values():
    best = min(candidates, key=lambda c:c[0])
    # A shared station can have separate Elizabeth/rail labels in the source.
    # Retain the closest Tube label and its coincident halo, not every duplicate.
    for _, point, node, station in candidates:
        if math.hypot(point[0]-best[1][0],point[1]-best[1][1]) > 1: continue
        wrap = ET.SubElement(labels, tag('g'), {'data-label':station['id'], 'transform':'matrix(' + ' '.join(map(str,ancestors_transform(node))) + ')'})
        label = copy.deepcopy(node); label.attrib.pop('id', None)
        if any('b' in p.get('class','').split() for p in [parents.get(node), parents.get(parents.get(node))] if p is not None): label.set('font-weight','bold')
        wrap.append(label)

missing = [s['name'] for s in stations if s['id'] not in positions]
if missing:
    raise ValueError('Stations missing from authored diagram: ' + ', '.join(missing))
metadata = ET.SubElement(out, tag('metadata'), {'id':'journey-layout'})
metadata.text = json.dumps({'positions':positions,'sourceSha256':hashlib.sha256(source).hexdigest(),'source':'https://commons.wikimedia.org/wiki/File:London_Underground_Overground_DLR_Crossrail_map.svg','author':'Sameboat','license':'CC-BY-SA-4.0','licenseUrl':'https://creativecommons.org/licenses/by-sa/4.0/','changes':'Tube-only adaptation, simplified graphics and interactive station metadata by Journey.'}, separators=(',',':'))

# Defensive allowlist: remove all animation, event handlers and external links.
allowed = {'svg','style','defs','g','path','use','circle','rect','polygon','ellipse','title','desc','text','tspan','metadata'}
for parent in list(out.iter()):
    for child in list(parent):
        if child.tag.split('}')[-1] not in allowed or (child.tag == tag('title') and parent is not out):
            if child.tail:
                index = list(parent).index(child)
                if index: parent[index-1].tail = (parent[index-1].tail or '') + child.tail
                else: parent.text = (parent.text or '') + child.tail
            parent.remove(child)
    for attr in list(parent.attrib):
        value = parent.get(attr)
        if attr.lower().startswith('on') or (attr.endswith('href') and not value.startswith('#')): del parent.attrib[attr]
result = ET.tostring(out, encoding='unicode').replace(' xmlns:xlink="'+XL+'" xmlns:xlink="'+XL+'"',' xmlns:xlink="'+XL+'"')
ET.fromstring(result)
(ROOT / 'familiar-tube.svg').write_text(result, encoding='utf-8')
print(json.dumps({'stations':len(positions),'bytes':len(result.encode()),'sourceSha256':hashlib.sha256(source).hexdigest()}))
