"""Build the Vesna mint swimsuit variant from the repaired Liuchao Web mesh.

Run python3 scripts/blender/build_liuchao_mint.py --textures (NumPy/Pillow),
then Blender -b --factory-startup --disable-autoexec --python-exit-code 1
--python scripts/blender/build_liuchao_mint.py -- [--preview].
Pass --web-only to rebuild the game assets without saving the editable scene.
"""
import hashlib
import json
import sys
from pathlib import Path
from shutil import copyfile

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DONOR = ROOT / 'assets/source/vesna-mint-swimwear'
BASE = ROOT / 'dist/assets/enhanced/liuchao'
PARTS = ROOT / 'work/liuchao-import-2026-11-11/build-evidence.json'
WORK = ROOT / 'work/liuchao-mint-swimwear'
OUT = ROOT / 'dist/assets/enhanced/liuchao-mint'
ID = 'liuchao-mint'
LABEL = '琉潮-换装二'
ARRAYS = {'positions': 3, 'normals': 3, 'uvs': 2, 'skinIndices': 4, 'skinWeights': 4}

# Index start/count from the BodyD draw calls, including optional parts shown
# in the source preview. Texture FX uses the red mask for the lace openings.
GARMENTS = [
    ('荷叶袖', 0, 40152, 'upper_arm', True),
    ('泳装上衣', 40152, 18711, 'torso', False),
    ('上衣荷叶边', 58863, 52248, 'torso', True),
    ('腿环', 128259, 360, 'thigh', False),
    ('颈饰', 128619, 1953, 'torso', False),
    ('泳装下装', 130572, 11160, 'bottom', False),
    ('薄荷凉鞋', 141732, 15360, 'shoe', False),
    ('薄荷短裙', 157092, 31104, 'skirt', True),
    ('腕饰', 188196, 7962, 'forearm', True),
]


def prepare_textures():
    from PIL import Image

    with Image.open(DONOR / 'VesnaBodyDDiffuse.dds') as image:
        # The diffuse alpha stores shader data, not clothing opacity.
        diffuse = image.convert('RGB')
    with Image.open(DONOR / 'mask.dds') as image:
        alpha = image.getchannel('R').point(lambda value: 0 if value > 185 else 255)
    textures = OUT / 'textures'
    textures.mkdir(parents=True, exist_ok=True)
    diffuse.resize((2048, 2048), Image.Resampling.LANCZOS).save(
        textures / 'vesna-mint.webp', quality=94, method=6)
    lace = diffuse.copy()
    lace.putalpha(alpha)
    lace.resize((2048, 2048), Image.Resampling.LANCZOS).save(
        textures / 'vesna-lace.webp', quality=94, method=6)
    prepare_white_bottom()


def prepare_white_bottom():
    from PIL import Image

    textures = OUT / 'textures'
    with Image.open(textures / 'vesna-mint.webp') as image:
        rgb = np.asarray(image.convert('RGB'), dtype=np.float32) / 255
    linear = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    luminance = linear @ [.2126, .7152, .0722]
    # Match the editable white fabric. Preserve the atlas shading and UVs.
    white = .76 + .22 * luminance
    white_srgb = 1.055 * white ** (1 / 2.4) - .055
    pixels = np.repeat((white_srgb * 255).round().astype(np.uint8)[:, :, None], 3, axis=2)
    Image.fromarray(pixels).save(textures / 'vesna-white-bottom.webp', quality=94, method=6)


def retain_body(base, *, with_lining=False, keep_original_jewelry=True):
    base_parts = json.loads(PARTS.read_text())['objects']
    skin = {**base, **{field: [] for field in ARRAYS}, 'faces': []}
    parts = []
    skin_slot = next(i for i, item in enumerate(base['materials']) if item['name'] == '暖肤色 · 柔光')
    vertex_start = face_start = 0
    for part in base_parts:
        vertex_end = vertex_start + part['runtimeVertices']
        face_end = face_start + part['triangles']
        keep = part['name'].startswith((
            '官方面部', '左手', '右手', '身体', '官方短发', '低束马尾', '鬓边',
            '马尾 ·', '发饰 ·', '耳饰 ·', '后脑 ·'))
        if not keep_original_jewelry and part['name'].startswith(('发饰 ·', '耳饰 ·')):
            keep = False
        cup_lining = with_lining and part['name'].startswith(('上衣 · 右杯片', '上衣 · 左杯片', '上衣 · 背带'))
        if keep or cup_lining:
            offset = len(skin['positions']) // 3 - vertex_start
            for field, width in ARRAYS.items():
                skin[field].extend(base[field][vertex_start * width:vertex_end * width])
            for face in base['faces'][face_start:face_end]:
                material = face['material']
                if not with_lining and part['name'].startswith('身体') and base['materials'][material]['name'] == '珍珠白 · 泳装织物':
                    material = skin_slot
                skin['faces'].append({'material': material,
                                      'indices': [i + offset for i in face['indices']]})
            parts.append(dict(part))
        vertex_start, face_start = vertex_end, face_end
    assert (vertex_start, face_start) == (base['vertexCount'], base['triangleCount'])
    return skin, parts


def model_coordinates(values):
    # Source is X-right, Y-up and Z-forward. The game is Z-up, -Y-forward.
    return values[:, [0, 2, 1]] * [1, -1, 1]


def build(*, web_only=False):
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc

    base_bytes = (BASE / 'mesh.json').read_bytes()
    base = json.loads(base_bytes)
    skin, parts = retain_body(base)
    skin['materials'] = base['materials'][:]
    body_start = sum(part['runtimeVertices'] for part in parts[:3])
    body_part = parts[3]
    assert body_part['name'].startswith('身体')
    body_end = body_start + body_part['runtimeVertices']
    body_points = np.asarray(skin['positions']).reshape(-1, 3)[body_start:body_end]
    body_faces = np.asarray([f['indices'] for f in skin['faces'] if all(
        body_start <= i < body_end for i in f['indices'])]) - body_start
    body_joints = np.asarray(skin['skinIndices']).reshape(-1, 4)[body_start:body_end]
    body_weights = np.asarray(skin['skinWeights']).reshape(-1, 4)[body_start:body_end]

    donor = np.fromfile(DONOR / 'VesnaBodyPosition.buf', '<f4').reshape(-1, 10)
    donor_points = model_coordinates(donor[:, :3])
    donor_normals = model_coordinates(donor[:, 3:6])
    donor_uv = np.fromfile(DONOR / 'VesnaBodyTexcoord.buf', '<f4').reshape(-1, 7)[:, 1:3].copy()
    donor_uv[:, 1] = 1 - donor_uv[:, 1]
    donor_faces = np.fromfile(DONOR / 'VesnaBodyB.ib', '<u4')[6804:201834].reshape(-1, 3)
    outfit_indices = np.fromfile(DONOR / 'VesnaBodyD.ib', '<u4')
    assert len(donor) == len(donor_uv) == 87070 and len(outfit_indices) == 196158
    assert max(donor_faces.max(), outfit_indices.max()) < len(donor)
    assert np.isfinite(donor_points).all() and np.isfinite(donor_uv).all()

    base_surface = BVHTree.FromPolygons(body_points.tolist(), body_faces.tolist(), all_triangles=True)
    donor_surface = BVHTree.FromPolygons(donor_points.tolist(), donor_faces.tolist(), all_triangles=True)
    half_legs = {
        side: (BVHTree.FromPolygons(donor_points.tolist(), donor_faces[
            np.all(donor_points[donor_faces, 0] * side >= 0, axis=1)].tolist(), all_triangles=True),
               BVHTree.FromPolygons(body_points.tolist(), body_faces[
            np.all(body_points[body_faces, 0] * side >= 0, axis=1)].tolist(), all_triangles=True))
        for side in (-1, 1)
    }
    anchors = [Vector(bone['position']) for bone in base['bodyRig']['bones']]

    def radial_hit(tree, center, direction, distance):
        hit, _, _, _ = tree.ray_cast(center + direction * distance, -direction, distance)
        return (hit - center).dot(direction) if hit is not None else None

    def fit_torso(p, region):
        x, y, z = p
        height = np.interp(z, [.65, .81, .863, .925, 1.015, 1.078, 1.145, 1.225, 1.275, 1.315],
                           [15.7, 20.1, 21.95, 24.2, 26.4, 28.4, 30, 32.1, 33.15, 34.3])
        cy = np.interp(z, [.81, 1.02, 1.16, 1.26, 1.31], [-.035, -.069, -.052, -.018, -.005])
        ty = np.interp(height, [20, 26, 30, 32.4, 34.4], [-.49, -.43, -.52, -.50, -.68])
        src_x = dst_x = 0
        if region == 'bottom' and z < .86:
            # Fit the crotch continuously across the centre line. A radial ray
            # in this region can jump from the inner edge to the opposite leg.
            gap = float(np.interp(z, [.805, .822, .86], [1, .8, 0]))
            center_y = ty + (y - cy) * (26 if y < cy else 27)
            affine = Vector((x * 28.5, center_y, height - .85 * gap))
            if gap > .01:
                return affine.lerp(fit_torso(p, 'skirt'), 1 - gap)
        source_center = Vector((src_x, cy, z))
        target_center = Vector((dst_x, ty, height))
        delta = Vector((x - src_x, y - cy, 0))
        radius = delta.length
        if radius < .00001:
            return target_center
        direction = delta.normalized()
        # Limit the ray to the torso at elevations where the outstretched arm
        # would otherwise become the first hit.
        donor_extent = .145 if z > 1.01 else .23
        target_extent = 3.55 if 27 < height < 31.5 else 5.5
        old = radial_hit(donor_surface, source_center, direction, donor_extent)
        new = radial_hit(base_surface, target_center, direction, target_extent)
        if old is None or new is None or new < .06:
            return target_center + delta * 24
        clearance = {'torso': .105, 'bottom': .105, 'skirt': .13, 'thigh': .085}[region]
        detail = max(radius - old, -.012) * 21
        if region == 'skirt':
            clearance += float(np.interp(z, [.80, .88, .95], [.34, .12, 0]))
        return target_center + direction * (new + max(clearance, detail + .07))

    def fit_arm(p, region):
        side = 1 if p.x >= 0 else -1
        if region == 'upper_arm':
            start, end = Vector((side * .115, -.001, 1.206)), Vector((side * .245, .006, 1.013))
            dst_start, dst_end = [anchors[i] for i in ((15, 16) if side == 1 else (23, 24))]
        else:
            start, end = Vector((side * .245, .006, 1.013)), Vector((side * .350, .004, .856))
            dst_start, dst_end = [anchors[i] for i in ((16, 17) if side == 1 else (24, 25))]
        axis, dst_axis = end - start, dst_end - dst_start
        along = (p - start).dot(axis) / axis.length_squared
        along = max(.06, min(1.09, along))
        center, dst_center = start + axis * along, dst_start + dst_axis * along
        delta = p - center
        if delta.length < 1e-6:
            return dst_center
        direction = delta.normalized()
        rotated = axis.normalized().rotation_difference(dst_axis.normalized()) @ direction
        old = radial_hit(donor_surface, center, direction, .085)
        new = radial_hit(base_surface, dst_center, rotated, 1.7)
        if old is not None and new is not None and old > 0 and new > 0:
            distance = new + max(.115, (delta.length - old) * 21 + .065)
        else:
            distance = delta.length * 22 + .13
        return dst_center + rotated * distance

    def fit_shoe(p):
        side = 1 if p.x >= 0 else -1
        # Keep the footbed below the skin and match the longer toe box locally.
        z = float(np.interp(p.z, [-.022, .0, .03, .075, .15, .18], [0, .28, 1.03, 2.65, 4.2, 4.85]))
        x = side * max(.24, (.93 + (abs(p.x) - .046) * 24))
        y = (p.y + .057) * 24.5 - 1.35
        nearest, normal, _, distance = half_legs[side][1].find_nearest(Vector((x, y, z)))
        point = Vector((x, y, z))
        # Move straps lying on the inside of the foot back outside their skin.
        if nearest is not None and .55 < z < 4.7 and distance < 1.15 and (point - nearest).dot(normal) < .07:
            point = nearest + normal * .11
        return point

    def fit_thigh(p):
        side = 1 if p.x >= 0 else -1
        height = 17.52 + (p.z - .715) * 26
        start = Vector((side * .072, -.049, p.z))
        end = Vector((side * 1.90, -.49, height))
        delta = p - start
        direction = Vector((delta.x, delta.y, 0)).normalized()
        source, target = half_legs[side]
        old = radial_hit(source, start, direction, .15)
        new = radial_hit(target, end, direction, 2.85)
        if old is None or new is None:
            return end + Vector((delta.x, delta.y, 0)) * 26
        return end + direction * (new + .12 + max(0, delta.length - old) * 20)

    def weighted(point, region, source_x):
        side = 1 if source_x >= 0 else -1
        if region == 'skirt':
            # A continuous blend around the hem avoids exchanging left and
            # right weights when the closest triangle falls in the crotch.
            hem = float(np.interp(point.z, [20.1, 22.0, 23.5], [.94, .53, .06]))
            left = float(np.interp(point.x, [-1.35, 1.35], [0, 1]))
            return [(1, 1 - hem), (3, hem * left), (7, hem * (1 - left))]
        if region in {'upper_arm', 'forearm', 'thigh'}:
            index = {'upper_arm': (15, 23), 'forearm': (16, 24),
                     'thigh': (3, 7)}[region][side == -1]
            return [(index, 1.)]
        if region == 'shoe':
            foot, toe = (5, 6) if side == 1 else (9, 10)
            toe_blend = float(np.interp(point.y, [-2.85, -1.45], [.94, 0]))
            return [(foot, 1 - toe_blend), (toe, toe_blend)]
        nearest, _, triangle_index, _ = base_surface.find_nearest(point)
        triangle = body_faces[triangle_index]
        vertices = [Vector(body_points[i]) for i in triangle]
        factors = poly_3d_calc(vertices, nearest)
        joints = {}
        for vertex, factor in zip(triangle, factors):
            for index, weight in zip(body_joints[vertex], body_weights[vertex]):
                joints[int(index)] = joints.get(int(index), 0) + max(0, factor) * weight
        allowed = {0, 1, 2, 3, 7} if region in {'bottom', 'skirt'} else {1, 2, 11, 12, 14, 22}
        picked = sorted(((i, w) for i, w in joints.items() if i in allowed and w > 1e-7),
                        key=lambda item: -item[1])[:4]
        if not picked:
            picked = [(1 if region in {'bottom', 'skirt'} else 11, 1.)]
        total = sum(w for _, w in picked)
        return [(i, w / total) for i, w in picked]

    outfit_materials = {}
    for lace, name, texture in [
        (False, '薇斯纳 · 薄荷泳装', 'vesna-mint.webp'),
        (True, '薇斯纳 · 镂空布料', 'vesna-lace.webp'),
    ]:
        outfit_materials[lace] = len(skin['materials'])
        skin['materials'].append(dict(
            name=name, texture='textures/' + texture, color=0xffffff, twoSide=True,
            opacity=1, transparent=False, alphaTest=.47 if lace else 0,
            depthWrite=True, roughness=.67, metalness=.03, textureAnisotropy=8))
    white_bottom = len(skin['materials'])
    skin['materials'].append(dict(
        name='琉潮 · 白色泳装布料', texture='textures/vesna-white-bottom.webp',
        color=0xffffff, twoSide=True, opacity=1, transparent=False, alphaTest=0,
        depthWrite=True, roughness=.71, metalness=0, textureAnisotropy=8))

    stats = []
    for name, start, count, region, lace in GARMENTS:
        original = outfit_indices[start:start + count].reshape(-1, 3)
        ids, remapped = np.unique(original, return_inverse=True)
        triangles = remapped.reshape(-1, 3)
        source_normals = donor_normals[ids]
        points = donor_points[ids]
        a, b, c = points[triangles].transpose(1, 0, 2)
        if np.median(np.sum(np.cross(b - a, c - a) * source_normals[triangles].mean(1), axis=1)) < 0:
            triangles = triangles[:, [0, 2, 1]]

        if region in {'upper_arm', 'forearm'}:
            fitted = [fit_arm(Vector(p), region) for p in points]
        elif region == 'shoe':
            fitted = [fit_shoe(Vector(p)) for p in points]
        elif region == 'thigh':
            fitted = [fit_thigh(Vector(p)) for p in points]
        else:
            fitted = [fit_torso(Vector(p), region) for p in points]
        new_points = np.asarray(fitted, dtype=float)
        a, b, c = new_points[triangles].transpose(1, 0, 2)
        face_normals = np.cross(b - a, c - a)
        # Average triangle normals across coincident UV seams.
        _, points_map = np.unique(np.round(new_points, 5), axis=0, return_inverse=True)
        sums = np.zeros((points_map.max() + 1, 3))
        for indices in triangles.T:
            np.add.at(sums, points_map[indices], face_normals)
        smooth = sums[points_map]
        magnitude = np.linalg.norm(smooth, axis=1)
        normals = smooth / np.maximum(magnitude[:, None], 1e-9)
        normals[magnitude < 1e-9] = source_normals[magnitude < 1e-9]

        vertex_start = len(skin['positions']) // 3
        material = white_bottom if region == 'bottom' else outfit_materials[lace]
        skin['positions'].extend(new_points.round(6).ravel().tolist())
        skin['normals'].extend(normals.round(6).ravel().tolist())
        skin['uvs'].extend(donor_uv[ids].astype(float).round(7).ravel().tolist())
        for point, source_point in zip(fitted, points):
            weights = weighted(point, region, source_point[0])
            skin['skinIndices'].extend([i for i, _ in weights] + [0] * (4 - len(weights)))
            skin['skinWeights'].extend([round(w, 7) for _, w in weights] + [0] * (4 - len(weights)))
        for face in (triangles + vertex_start).tolist():
            skin['faces'].append(dict(material=material, indices=face))
        parts.append(dict(name=name, runtimeVertices=len(ids), triangles=len(triangles)))
        stats.append(dict(name=name, firstIndex=start, indexCount=count, sourceVertices=len(ids)))

    used = sorted({face['material'] for face in skin['faces']})
    new_index = {old: new for new, old in enumerate(used)}
    skin['materials'] = [skin['materials'][i] for i in used]
    for face in skin['faces']:
        face['material'] = new_index[face['material']]
    textures = {item['texture'] for item in skin['materials'] if item['texture'] != 'null'}
    for tex in textures:
        if (BASE / tex).is_file():
            copyfile(BASE / tex, OUT / tex)
        assert (OUT / tex).is_file(), 'Run --textures first'
    skin.update(vertexCount=len(skin['positions']) // 3, triangleCount=len(skin['faces']))
    mesh_bytes = json.dumps(skin, ensure_ascii=False, separators=(',', ':')).encode()
    (OUT / 'mesh.json').write_bytes(mesh_bytes)
    source_files = [dict(file=p.name, bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest())
                    for p in sorted(DONOR.iterdir()) if p.is_file()]
    manifest = json.loads((BASE / 'manifest.json').read_text())
    manifest.update(appearance=ID, label=LABEL, sourceFiles=source_files)
    manifest['stats'].update(vertices=skin['vertexCount'], triangles=skin['triangleCount'],
                             materials=len(used), textures=len(textures))
    manifest['provenance'].update(
        outfitArchive='assets/source/vesna-mint-swimwear', baseAppearance='liuchao',
        baseMeshSha256=hashlib.sha256(base_bytes).hexdigest(),
        outfit='Vesna XXMI mint swimsuit fitted to Liuchao, with white bottom fabric and the cape ties removed.')
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    evidence = dict(parts=parts, sourceDraws=stats, baseMeshSha256=manifest['provenance']['baseMeshSha256'],
                    meshSha256=hashlib.sha256(mesh_bytes).hexdigest())
    (WORK / 'build-evidence.json').write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n')
    print('LIUCHAO_MINT_READY', manifest['stats'], flush=True)
    if not web_only:
        author_blend(bpy, skin, parts)


def author_blend(bpy, skin, parts, *, label=LABEL, asset=OUT, work=WORK):
    # Use the editable repaired Liuchao workflow and keep the Web scalp as a
    # separately editable object with its baked material and original weights.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import save_liuchao_blend as author
    from proportional_authoring import build_source_armature, bake_source_samples

    author.ASSET = asset
    author.SCALP = None
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.name = label
    scene['game_mesh_sha256'] = hashlib.sha256((asset / 'mesh.json').read_bytes()).hexdigest()
    collection = bpy.data.collections.new(label + ' · 网格')
    scene.collection.children.link(collection)
    objects = author.create_parts(skin, parts, collection)
    body = next(obj for obj in objects if obj.name.startswith('身体 · '))
    rig = skin['bodyRig']
    armature, rest, _ = build_source_armature(body, rig, [], label=label)
    for obj in objects:
        if obj is not body:
            obj.parent = armature
            obj.modifiers.new('游戏动作骨架', 'ARMATURE').object = armature
    bake_source_samples(armature, rig, rest)
    author.set_relaxed_stance(armature, rig, rest)
    armature.show_in_front = False
    author.set_up_preview(scene, armature)
    front = bpy.data.objects['正面 · 全身']
    back = scene.camera
    scene.camera = front
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1 / rig['sourceUniformScale']
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/source/liuchao' / (label + '.blend')), compress=True)
    if '--preview' in sys.argv:
        scene.render.resolution_percentage = 66
        for name, camera in [('front', front), ('back', back)]:
            scene.camera = camera
            scene.render.filepath = str(work / (name + '.png'))
            bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    if '--textures' in sys.argv:
        prepare_textures()
    else:
        build(web_only='--web-only' in sys.argv)
