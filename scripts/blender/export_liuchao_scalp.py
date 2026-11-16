"""Export the repaired face surface from 琉潮-修复版.blend into Liuchao's Web asset.

Run with Blender -b --disable-autoexec --python-exit-code 1 --python this-file.
An optional directory after -- stages the output for inspection.
"""

import hashlib
import json
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from restore_liuchao_scalp import EDITABLE, ROOT, SCALP


RUNTIME = ROOT / 'dist/assets/enhanced/liuchao'
EVIDENCE = ROOT / 'work/liuchao-import-2026-11-11/build-evidence.json'
TEXTURE = 'textures/scalp.webp'
FACE_OBJECT = '官方面部 · 游戏适配'
CELL = 32
ATLAS_SIZE = 1024


def atomic_write(path, data):
    with NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
    try:
        temporary.chmod(0o644)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def sample_srgb(pixels, uv):
    """Bilinear repeat sampling in linear space, matching the scalp shader."""
    height, width = pixels.shape[:2]
    position = uv * (width, height) - .5
    raw_x, raw_y = np.floor(position).astype(np.int32).T
    tx, ty = (position - np.floor(position)).T[:, :, None]
    a = pixels[raw_y % height, raw_x % width]
    b = pixels[raw_y % height, (raw_x + 1) % width]
    c = pixels[(raw_y + 1) % height, raw_x % width]
    d = pixels[(raw_y + 1) % height, (raw_x + 1) % width]

    def linear(rgb):
        return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)

    return ((1 - tx) * linear(a) + tx * linear(b)) * (1 - ty) + ((1 - tx) * linear(c) + tx * linear(d)) * ty


def bake_scalp(face, polygons, material):
    # Three pads separate each triangle from its neighbours. Extend edge
    # colours through the unused part of each tile for bilinear filtering.
    mesh = face.data
    nodes = material.node_tree.nodes
    source = next(n.image for n in nodes if n.type == 'TEX_IMAGE')
    tint = np.asarray(next(n for n in nodes if n.type == 'MIX_RGB').inputs[2].default_value[:3])
    blend = next(n for n in nodes if n.type == 'ATTRIBUTE').attribute_name
    assert source.packed_file and len(polygons) <= (ATLAS_SIZE // CELL) ** 2
    raw = np.empty(len(source.pixels), dtype=np.float32)
    source.pixels.foreach_get(raw)
    pixels = raw.reshape(source.size[1], source.size[0], 4)[:, :, :3]
    uv = mesh.uv_layers.active.uv
    tone = mesh.attributes[blend].data

    corners = np.array([[3.5, 3.5], [27.5, 3.5], [3.5, 27.5]])
    py, px = np.meshgrid(np.arange(CELL) + .5, np.arange(CELL) + .5, indexing='ij')
    b, c = (px - 3.5) / 24, (py - 3.5) / 24
    barycentric = np.maximum(0, np.column_stack([(1 - b - c).ravel(), b.ravel(), c.ravel()]))
    barycentric /= barycentric.sum(axis=1, keepdims=True)
    canvas = np.ones((ATLAS_SIZE, ATLAS_SIZE, 4), dtype=np.float32)
    canvas[:, :, :3] = (.72, .44, .325)
    texture_uv = []
    for i, polygon in enumerate(polygons):
        source_uv = np.array([uv[loop].vector[:] for loop in polygon.loop_indices])
        amount = barycentric @ [tone[v].value for v in polygon.vertices]
        colour = (1 - amount[:, None]) * sample_srgb(pixels, barycentric @ source_uv) + amount[:, None] * tint
        x = (i % (ATLAS_SIZE // CELL)) * CELL
        y = (i // (ATLAS_SIZE // CELL)) * CELL
        canvas[y:y + CELL, x:x + CELL, :3] = colour.reshape(CELL, CELL, 3)
        texture_uv.append(((corners + (x, y)) / ATLAS_SIZE).tolist())
    # Blender converts linear pixels from a float image to sRGB on save.
    output = bpy.data.images.new('Liuchao baked scalp', width=ATLAS_SIZE, height=ATLAS_SIZE,
                                 alpha=False, float_buffer=True)
    output.pixels.foreach_set(canvas.ravel())
    return output, texture_uv


def remove_previous_patch(skin, parts):
    if not parts or parts[-1]['name'] != SCALP:
        assert all(material['name'] != SCALP for material in skin['materials'])
        return
    previous = parts.pop()
    assert skin['materials'][-1]['name'] == SCALP
    for name, width in [('positions', 3), ('normals', 3), ('uvs', 2), ('skinIndices', 4), ('skinWeights', 4)]:
        del skin[name][-previous['runtimeVertices'] * width:]
    del skin['faces'][-previous['triangles']:]
    skin['materials'].pop()


def export(output_dir, evidence_path):
    skin = json.loads((RUNTIME / 'mesh.json').read_text())
    manifest = json.loads((RUNTIME / 'manifest.json').read_text())
    evidence = json.loads(EVIDENCE.read_text())
    parts = evidence['objects']
    remove_previous_patch(skin, parts)
    assert len(skin['positions']) == 3 * sum(part['runtimeVertices'] for part in parts)
    assert len(skin['faces']) == sum(part['triangles'] for part in parts)
    source_hash = hashlib.sha256(EDITABLE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(EDITABLE), use_scripts=False)
    face = bpy.context.scene.objects[FACE_OBJECT]
    mesh = face.data
    slot, = [i for i, material in enumerate(mesh.materials) if material.name == SCALP]
    polygons = [polygon for polygon in mesh.polygons if polygon.material_index == slot]
    assert polygons and all(polygon.loop_total == 3 for polygon in polygons)
    used_vertices = {v for polygon in polygons for v in polygon.vertices}
    original = parts[0]['runtimeVertices']
    assert parts[0]['name'].startswith('官方面部')
    current_face = np.asarray(skin['positions'][:3 * original]).reshape(original, 3)
    original_face = np.asarray([v.co[:] for v in mesh.vertices[:original]])
    assert np.max(np.abs(current_face - original_face)) < 1e-5, 'Editable face and Web face do not share the same rest coordinates'
    joined = sorted(v for v in used_vertices if v < original)
    assert len(joined) == 48

    scalp_material = mesh.materials[slot]
    shader = next(n for n in scalp_material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    atlas, atlas_uv = bake_scalp(face, polygons, scalp_material)
    new_slot = len(skin['materials'])
    skin['materials'].append(dict(name=SCALP, sourceName=SCALP, texture=TEXTURE, color=0xffffff, twoSide=True,
                                  opacity=1, transparent=False, alphaTest=0, depthWrite=True, skinSurface=True,
                                  roughness=round(shader.inputs['Roughness'].default_value, 4), metalness=0,
                                  textureAnisotropy=4))
    slots = {bone['name']: i for i, bone in enumerate(skin['bodyRig']['bones'])}
    start = len(skin['positions']) // 3
    for polygon, uvs in zip(polygons, atlas_uv):
        indices = []
        for v, loop, uv in zip(polygon.vertices, polygon.loop_indices, uvs):
            # Web vertices hold one UV and one normal, so the atlas corners
            # duplicate rim positions and copy their exact original weights.
            indices.append(len(skin['positions']) // 3)
            if v < original:
                p = skin['positions'][3*v : 3*v+3]
                joints = skin['skinIndices'][4*v : 4*v+4]
                weights = skin['skinWeights'][4*v : 4*v+4]
            else:
                vertex = mesh.vertices[v]
                p = [round(x, 6) for x in vertex.co]
                influences = [(slots[face.vertex_groups[g.group].name], g.weight) for g in vertex.groups]
                assert 0 < len(influences) <= 4 and abs(sum(w for _, w in influences) - 1) < 1e-5
                joints = [i for i, _ in influences] + [0] * (4 - len(influences))
                weights = [w for _, w in influences] + [0] * (4 - len(influences))
            skin['positions'].extend(p)
            skin['normals'].extend(round(n, 6) for n in mesh.corner_normals[loop].vector)
            skin['uvs'].extend(round(x, 8) for x in uv)
            skin['skinIndices'].extend(joints)
            skin['skinWeights'].extend(weights)
        skin['faces'].append(dict(material=new_slot, indices=indices))

    skin['vertexCount'] = len(skin['positions']) // 3
    skin['triangleCount'] = len(skin['faces'])
    parts.append(dict(name=SCALP, sourceVertices=len(used_vertices), runtimeVertices=skin['vertexCount'] - start,
                      triangles=len(polygons)))
    manifest['stats'].update(vertices=skin['vertexCount'], triangles=skin['triangleCount'],
                             materials=len(skin['materials']),
                             textures=len({m['texture'] for m in skin['materials'] if m['texture'] != 'null'}))
    manifest['completeness']['scalpGeometry'] = True
    record = dict(file=EDITABLE.name, bytes=EDITABLE.stat().st_size, sha256=source_hash)
    manifest['sourceFiles'] = [f for f in manifest['sourceFiles'] if f['file'] != EDITABLE.name] + [record]
    manifest['provenance']['scalpSource'] = str(EDITABLE.relative_to(ROOT))
    mesh_bytes = json.dumps(skin, ensure_ascii=False, separators=(',', ':')).encode()
    evidence.update(runtimeBytes=len(mesh_bytes), scalp=dict(source=record, seamVertices=len(joined),
                                                             triangles=len(polygons), texture=TEXTURE))
    evidence['textures']['Liuchao baked scalp'] = TEXTURE
    (output_dir / 'textures').mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=output_dir / 'textures', suffix='.webp') as temporary:
        atlas.filepath_raw = temporary.name
        atlas.file_format = 'WEBP'
        atlas.save(quality=94)
        atomic_write(output_dir / TEXTURE, Path(temporary.name).read_bytes())
    atomic_write(output_dir / 'mesh.json', mesh_bytes)
    atomic_write(output_dir / 'manifest.json', (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode())
    atomic_write(evidence_path, (json.dumps(evidence, indent=2, ensure_ascii=False) + '\n').encode())
    print(f'Exported {len(polygons)} scalp triangles and {len(joined)} matching rim vertices.', flush=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    destination = Path(args[0]).resolve() if args else RUNTIME
    export(destination, destination / 'build-evidence.json' if args else EVIDENCE)
