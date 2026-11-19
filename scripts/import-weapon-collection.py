#!/usr/bin/env python3
"""Convert the supplied weapon collection into browser assets without running the client."""
import argparse
from hashlib import sha256
from io import BytesIO
import json
from math import ceil, sqrt
from pathlib import Path
import re
import struct
import subprocess

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
PREFIX = 'collection-'
# Read through the same native decoders used by the game. Repair common faults
# in this pack (vt instead of t, and two missing final braces) at import time.
READ_MODELS = r"""
import {readFileSync, readdirSync} from 'node:fs';
import {join, parse} from 'node:path';
import {readGmb, readGmc} from './dist/gmc-loader.js';
import {WEAPON_COLLECTION_APPEARANCES} from './dist/weapon-collection-catalog.js';

const source = process.argv[1];
const decoders = ['utf-8', 'gb18030', 'big5'].map(encoding => new TextDecoder(encoding, {fatal: true}));
function decode(bytes) {
  for (const decoder of decoders) {
    try {return decoder.decode(bytes);} catch {}
  }
  throw new Error('Unrecognized text encoding');
}
const models = {};
for (const appearance of Object.values(WEAPON_COLLECTION_APPEARANCES).flat()) {
  const folder = appearance.festive ? '圣诞武器模型！' : 'cmodel';
  const names = new Map(readdirSync(join(source, folder)).map(name => [name.toLowerCase(), name]));
  for (const id of appearance.modelIds) {
    const stem = id.replace(/^collection-(festive-)?/, '');
    const file = names.get(stem + '.gmc') ?? names.get(stem + '.gmb');
    if (!file) throw new Error('Missing source model: ' + id);
    const bytes = readFileSync(join(source, folder, file));
    let model;
    if (bytes.subarray(0,10).toString() === 'GMDL V1.00') {
      model = readGmb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } else {
      const body = decode(bytes)
        .replace(/^(\s*Object[ \t]+\S+[^\S\r\n]*\r?\n)\s*\}/gmi, '$1{')
        .replace(/\bvt\b/g, 't')
        .replace(/\b(?:nan|-?1\.\#(?:IND|QNAN))\b/gi, '0');
      model = readGmc(body + '\n}');
    }
    const description = names.get(parse(file).name.toLowerCase() + '.des') ?? names.get(stem + '.des');
    if (description) model.description = decode(readFileSync(join(source, folder, description)));
    model.source = folder + '/' + file;
    models[id] = model;
  }
}
process.stdout.write(JSON.stringify(models));
"""


def index_files(*folders):
    return {file.name.lower(): file for folder in folders for file in sorted(folder.rglob('*')) if file.is_file()}


def decode_text(path):
    data = path.read_bytes()
    for encoding in ('utf-8-sig', 'gb18030', 'big5'):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError(f'Unrecognized encoding for {path.name}')


def texture_name(name):
    return name.strip().replace(chr(92), '/').split('/')[-1].lower()


def image_for(path, mode):
    with Image.open(path) as source:
        image = source.convert('RGBA')
    if mode == 'additive':
        red, green, blue, alpha = image.split()
        brightest = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        mask = brightest.point([min(255, max(0, (v - 4) * 5)) for v in range(256)])
        image.putalpha(ImageChops.multiply(alpha, mask))
    elif mode == 'key' and image.getchannel('A').getextrema() == (255, 255):
        image.putdata([
            (r, g, b, 0 if max(r,g,b) < 14 or (r > 235 and b > 235 and g < 32) else a)
            for r, g, b, a in image.getdata()
        ])
    return image


def encode_webp(image):
    data = BytesIO()
    image.save(data, format='WEBP', quality=94, method=5)
    return data.getvalue()


def build_atlas(sequence, files, mode):
    paths = [files[texture_name(line)] for line in decode_text(sequence).splitlines() if line.strip()]
    unique = list(dict.fromkeys(paths))
    indices = {path: i for i, path in enumerate(unique)}
    sample = image_for(paths[0], mode)
    sample.thumbnail((256, 256))
    width, height = sample.size
    columns = min(len(unique), max(1, ceil(sqrt(len(unique) * height / width))))
    atlas = Image.new('RGBA', (width * columns, height * ceil(len(unique) / columns)))
    for path, index in indices.items():
        frame = image_for(path, mode).resize((width, height), Image.Resampling.LANCZOS)
        atlas.paste(frame, (index % columns * width, index // columns * height))
    return atlas, {'width': width, 'height': height, 'columns': columns, 'frames': [indices[p] for p in paths]}


def write_texture(reference, catalog, mode, scroll, output, cache, textures):
    path = catalog[reference]
    key = (path, mode, scroll)
    if key in cache:
        return cache[key]
    descriptor = {}
    if path.suffix.lower() == '.ifl':
        image, descriptor['atlas'] = build_atlas(path, catalog, mode)
    else:
        image = image_for(path, mode)
    if scroll:
        descriptor['scrollV'] = scroll
    data = encode_webp(image)
    digest = sha256(data).hexdigest()[:16]
    filename = digest + '.webp'
    (output / 'textures' / filename).write_bytes(data)
    descriptor['url'] = 'textures/' + filename
    # The same image can be used for a stationary surface and a scrolling effect.
    identity = digest + ('-scroll' if scroll else '')
    cache[key] = identity
    textures[identity] = descriptor
    return identity


def gmb_string(value):
    data = value.encode('utf-8')
    return struct.pack('<i', len(data)) + data


def encode_mesh(model, shaders):
    objects = model['objects']
    data = bytearray(b'GMDL V1.00')
    data += struct.pack('<i', len(shaders))
    for shader in shaders:
        data += gmb_string(shader['reference'])
    data += struct.pack('<i', len(shaders))
    for index, shader in enumerate(shaders):
        data += struct.pack('<i', index)
        data += gmb_string('ALPHACHANNEL' if shader['mode'] == 'key' else 'NORMAL')
        data += struct.pack('<B', 1)
        data += gmb_string(shader['blend'])
        data += struct.pack('<f', shader['opacity'])
    data += struct.pack('<4i', len(objects), 0, sum(len(o['vertices']) for o in objects), sum(len(o['faces']) for o in objects))
    for obj in objects:
        data += gmb_string(obj['name'])
        data += struct.pack('<2i', len(obj['vertices']), len(obj['faces']))
        for vertex in obj['vertices']:
            color = (vertex['color'] + [1]*4)[:4]
            rgba = [round(min(1, max(0, n)) * 255) for n in color]
            data += struct.pack('<6f4B2f', *vertex['position'], *vertex['normal'], *rgba, *vertex['uv'])
        for face in obj['faces']:
            normal = face['normal'] if len(face['normal']) == 3 else [0, 0, 0]
            data += struct.pack('<4i3f', face['shader'], *face['indices'], *normal)
    return data


def prepare_model(model):
    description = model.get('description', '')
    hidden = {name.lower() for name, block in re.findall(r'Object\s+(\S+)\s*\{([\s\S]*?)\n\}', description) if re.search(r'visible\s*=\s*0', block, re.I)}
    objects = []
    for obj in model['objects']:
        faces = [face for face in obj['faces'] if face['shader'] >= 0]
        if faces and obj['name'].lower() not in hidden:
            objects.append({**obj, 'faces': faces})
    if not objects:
        raise ValueError(f'{model["source"]} has no visible geometry')
    # Some exports label their sole shader "2" but assign all faces to slot zero.
    # Only resolve that mismatch when choosing the material is unambiguous.
    defined = [shader for shader in model['shaders'] if shader]
    used = sorted({face['shader'] for obj in objects for face in obj['faces']})
    shaders = []
    mapping = {}
    for index in used:
        entry = model['shaders'][index] if index < len(model['shaders']) else None
        if not entry and len(defined) == 1:
            entry = defined[0]
        if not entry:
            raise ValueError(f'{model["source"]} has missing shader {index}')
        mapping[index] = len(shaders)
        shaders.append(entry)
    for obj in objects:
        for face in obj['faces']:
            face['shader'] = mapping[face['shader']]
    model['objects'] = objects
    return shaders


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/assets/weapon-skins/collection')
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if source == output or source in output.parents:
        parser.error('output must be outside the supplied source directory')

    models = json.loads(subprocess.run(
        ['node', '--input-type=module', '-e', READ_MODELS, str(source)], cwd=ROOT, check=True, capture_output=True
    ).stdout)
    loose = index_files(source / 'ctexture', source / 'TexturePatch')
    festive = {**loose, **index_files(source / '圣诞武器皮肤！')}
    (output / 'models').mkdir(parents=True, exist_ok=True)
    (output / 'textures').mkdir(parents=True, exist_ok=True)
    manifest = {'models': {}, 'textures': {}}
    cache = {}
    for model_id, model in models.items():
        winter = model_id.startswith(PREFIX + 'festive-')
        catalog = festive if winter else loose
        shaders = []
        textures = set()
        additives = set()
        for shader in prepare_model(model):
            reference = texture_name(model['textures'][shader['texture']]) if shader['texture'] >= 0 else ''
            additive = shader['blend'].upper().startswith('ENABLE 1 1')
            mode = 'additive' if additive else 'key' if shader['mode'] in ('COLORKEY', 'ALPHACHANNEL') else 'color'
            # This variant includes a DES texture scroll speed but names different
            # objects in the GMC. Apply the scroll to its second additive layer.
            scroll = -.5 if model_id == 'collection-festive-w6_4' and additive and reference == 'liao.jpg' else 0
            if reference:
                texture_id = write_texture(reference, catalog, mode, scroll, output, cache, manifest['textures'])
                textures.add(texture_id)
                if additive:
                    additives.add(texture_id)
            else:
                texture_id = ''
            shaders.append({**shader, 'reference': texture_id, 'mode': mode})
        filename = f'models/{model_id}.gmb'
        (output / filename).write_bytes(encode_mesh(model, shaders))
        entry = {'url': filename, 'source': model['source'], 'textures': sorted(textures)}
        if additives:
            entry['additive'] = sorted(additives)
        if model_id.startswith('collection-w9_'):
            points = re.findall(r'Object\s+(d_wpn\w+)\s*\{\s*Position:\s*([^\r\n]+)', model['description'], re.I)
            entry['gripAttachments'] = {name.lower(): {'position': list(map(float, xyz.split()))} for name, xyz in points}
        manifest['models'][model_id] = entry
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(models)} weapon parts, {len(manifest["textures"])} textures')


if __name__ == '__main__':
    main()
