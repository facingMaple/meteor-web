"""Fit the white Odette wedding outfit to the repaired Liuchao model.

First run this script with Python and --textures (NumPy/Pillow), then run:
Blender -b --factory-startup --disable-autoexec --python-exit-code 1
--python scripts/blender/build_liuchao_wedding.py -- --preview
"""
import hashlib
import json
import sys
from pathlib import Path
from shutil import copyfile

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_liuchao_mint import BASE, ROOT, author_blend, model_coordinates, retain_body

DONOR = ROOT / 'assets/source/odette-wedding'
WORK = ROOT / 'work/liuchao-odette-wedding'
OUT = ROOT / 'dist/assets/enhanced/liuchao-wedding'
ID = 'liuchao-wedding'
LABEL = '琉潮-换装三'
# Default white outfit draw calls from the source INI. Stocking triangles
# occupy a separate UV island inside the otherwise shared BodyB draw.
PARTS = [
    ('婚纱 · 主体', 'D', 0, 18204, 'torso'),
    ('右侧裙饰', 'D', 44937, 21942, 'skirt'),
    ('长裙摆', 'D', 66879, 15102, 'train'),
    ('前侧裙饰', 'D', 81981, 7755, 'skirt'),
    ('左侧裙饰', 'D', 89736, 27708, 'skirt'),
    ('腿饰', 'D', 117444, 29622, 'leg'),
    ('长手套', 'D', 147066, 14556, 'arm'),
    ('手臂花饰', 'D', 161622, 8541, 'arm'),
    ('头冠', 'D', 170163, 27315, 'head'),
    ('头纱', 'D', 197478, 13062, 'veil'),
    ('左鞋', 'D', 210540, 9528, 'shoe-left'),
    ('右鞋', 'D', 220068, 33006, 'shoe-right'),
    ('天鹅胸饰', 'D', 253074, 498, 'torso'),
    ('胸前饰带', 'B', 266505, 5712, 'torso'),
    ('腹前花饰', 'B', 272217, 2760, 'torso'),
    ('侧边发饰', 'B', 260793, 5712, 'head'),
    ('长袜', 'B', 110109, 76266, 'stocking'),
    ('耳饰', 'A', 0, 336, 'head'),
    ('胸针', 'A', 17775, 132, 'torso'),
    ('背饰', 'A', 17907, 1692, 'skirt'),
]
TEXTURES = {'A': 'OdetteBangHairADiffuse', 'B': 'OdetteBodyBDiffuse', 'D': 'OdetteBodyDDiffuse'}
SOURCE_HEIGHTS = [-.058, 0, .08, .15, .45, .61, .74, .825, .89, .96, 1.02, 1.085, 1.145, 1.22, 1.28, 1.33, 1.55]
TARGET_HEIGHTS = [0, .60, 2.54, 4.40, 12.8, 16.9, 19.2, 21.2, 22.35, 24.45, 26.2, 28.55, 30.0, 31.9, 33.0, 34.4, 39.7]


def prepare_textures():
    from PIL import Image
    (OUT / 'textures').mkdir(parents=True, exist_ok=True)
    for atlas, name in TEXTURES.items():
        with Image.open(DONOR / (name + '.dds')) as image:
            # DDS alpha is shader data. The lace borders here are actual mesh geometry.
            result = image.convert('RGB').resize((2048, 2048), Image.Resampling.LANCZOS)
            result.save(OUT / 'textures' / f'odette-{atlas.lower()}.webp', quality=94, method=6)


def fused_normals(points, triangles, fallback):
    a, b, c = points[triangles].transpose(1, 0, 2)
    face_normals = np.cross(b - a, c - a)
    _, weld = np.unique(np.round(points, 5), axis=0, return_inverse=True)
    sums = np.zeros((weld.max() + 1, 3))
    for indices in triangles.T:
        np.add.at(sums, weld[indices], face_normals)
    smooth = sums[weld]
    length = np.linalg.norm(smooth, axis=1)
    normals = smooth / np.maximum(length[:, None], 1e-9)
    normals[length < 1e-9] = fallback[length < 1e-9]
    return normals


def build():
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc

    base_bytes = (BASE / 'mesh.json').read_bytes()
    base = json.loads(base_bytes)
    skin, parts = retain_body(base, with_lining=True, keep_original_jewelry=False)
    skin['materials'] = [
        dict(material, name='婚纱 · 珍珠白内衬', color=0xe5e7f1, roughness=.73)
        if material['name'] == '珍珠白 · 泳装织物' else material
        for material in base['materials']
    ]
    body_start = sum(part['runtimeVertices'] for part in parts[:3])
    body = parts[3]
    assert body['name'].startswith('身体')
    end = body_start + body['runtimeVertices']
    target = np.asarray(skin['positions']).reshape(-1, 3)[body_start:end]
    target_faces = np.asarray([f['indices'] for f in skin['faces'] if all(
        body_start <= i < end for i in f['indices'])]) - body_start
    weights = np.asarray(skin['skinWeights']).reshape(-1, 4)[body_start:end]
    joints = np.asarray(skin['skinIndices']).reshape(-1, 4)[body_start:end]

    raw = np.fromfile(DONOR / 'OdetteBodyPosition.buf', '<f4').reshape(-1, 10)
    points = model_coordinates(raw[:, :3])
    normals = model_coordinates(raw[:, 3:6])
    uvs = np.fromfile(DONOR / 'OdetteBodyTexcoord.buf', '<f4').reshape(-1, 7)[:, 1:3].copy()
    assert len(raw) == len(uvs) == 127489 and np.isfinite(points).all() and np.isfinite(uvs).all()
    buffers = {atlas: np.fromfile(DONOR / f'OdetteBody{atlas}.ib', '<u4') for atlas in TEXTURES}
    assert all(indices.max() < len(points) for indices in buffers.values())
    donor_body = buffers['B'][35973:110109].reshape(-1, 3)
    donor_arms = buffers['B'][:20100].reshape(-1, 3)

    def bvh(vertices, faces):
        return BVHTree.FromPolygons(vertices.tolist(), faces.tolist(), all_triangles=True)

    dst = bvh(target, target_faces)
    src = bvh(points, donor_body)
    arms = bvh(points, donor_arms)
    legs = {}
    leg_faces = {}
    for side in (-1, 1):
        src_legs = donor_body[np.all(points[donor_body, 0]*side > -.001, axis=1)]
        dst_legs = target_faces[np.all(target[target_faces, 0]*side > -.02, axis=1)]
        legs[side] = (bvh(points, src_legs), bvh(target, dst_legs))
        leg_faces[side] = dst_legs
    anchors = [Vector(bone['position']) for bone in base['bodyRig']['bones']]

    def radial(tree, center, direction, extent):
        point, _, _, _ = tree.ray_cast(center + direction * extent, -direction, extent)
        return (point - center).dot(direction) if point is not None else None

    def fit_torso(p, region):
        x, y, z = p
        height = float(np.interp(z, SOURCE_HEIGHTS, TARGET_HEIGHTS))
        source_y = float(np.interp(z, [.79, .92, 1.01, 1.13, 1.25, 1.31], [-.04, -.045, -.068, -.052, -.025, -.025]))
        target_y = float(np.interp(height, [6, 20, 26, 32, 34], [-.2, -.49, -.42, -.49, -.66]))
        if region == 'train':
            # The hanging train follows the pelvis with a small thigh blend.
            # Fit its tie at the waist; retain the folds and the sweep behind the legs.
            return Vector((x * 27, y * 25 + .13, height))
        center = Vector((0, source_y, z))
        end = Vector((0, target_y, height))
        direction = p - center
        radius = direction.length
        if radius < 1e-6:
            return end
        direction.normalize()
        old = radial(src, center, direction, .28 if y < .22 else .46)
        new = radial(dst, end, direction, 3.68 if 27 < height < 31.5 else 5.3)
        if old is None or new is None or old < .02 or new < .04:
            return end + direction * (radius * 24 + .14)
        offset = max(.13, (radius - old) * 22 + .15)
        if region == 'skirt':
            offset += float(np.interp(z, [.70, .94, 1.07], [.43, .24, .08]))
        return end + direction * (new + offset)

    def fit_leg(p, side, region):
        height = float(np.interp(p.z, SOURCE_HEIGHTS, TARGET_HEIGHTS))
        # Cross sections follow the heeled foot, shin, knee and thigh separately.
        sz = [-.06, -.015, .05, .15, .34, .46, .62, .78]
        src_center = Vector((side * np.interp(p.z, sz, [.041,.040,.038,.039,.049,.058,.073,.074]),
                             np.interp(p.z, sz, [-.084,-.065,-.011,.006,.009,-.013,-.038,-.045]), p.z))
        dz = [0, .6, 2.8, 4.5, 9, 13, 17, 20]
        dst_center = Vector((side * np.interp(height, dz, [.94,.92,.83,.83,1.34,1.53,1.94,2.07]),
                             np.interp(height, dz, [-1.10,-1.19,.21,.22,.33,-.56,-.54,-.54]), height))
        delta = p - src_center
        direction = delta.normalized()
        s_tree, d_tree = legs[side]
        old = radial(s_tree, src_center, direction, .18)
        new = radial(d_tree, dst_center, direction, 3.0)
        if old is None or new is None or new < .07:
            return dst_center + delta * 24
        gap = .14 if region == 'stocking' else .115
        return dst_center + direction * (new + max(gap, (delta.length - old) * 21 + gap))

    def fit_shoe(p, side):
        # Keep sole/profile smooth at ground height where a horizontal ray
        # would jump between the toe box and the heel.
        z = float(np.interp(p.z, [-.06, -.028, 0, .063, .155], [.02,.32,.95,2.62,4.7]))
        x = side * max(.20, .95 + (p.x * side - .039) * 23)
        y = p.y * 27 - .10
        q = Vector((x, y, z))
        nearest, normal, _, distance = legs[side][1].find_nearest(q)
        if nearest is not None and distance < .8 and .38 < z and (q - nearest).dot(normal) < .12:
            q = nearest + normal * .13
        return q

    def fit_arm(p, side):
        shoulder = Vector((side*.106, .012, 1.205))
        elbow = Vector((side*.247, .004, 1.014))
        wrist = Vector((side*.365, .003, .826))
        slot = (15,16,17) if side == 1 else (23,24,25)
        s, e, w = [anchors[index] for index in slot]
        axis = (wrist-shoulder)
        fraction = (p-shoulder).dot(axis)/axis.length_squared
        if fraction < .53:
            a,b,c,d = shoulder,elbow,s,e
        else:
            a,b,c,d = elbow,wrist,e,w
        u, v = b-a, d-c
        t = (p-a).dot(u)/u.length_squared
        center, dest = a + u*t, c + v*t
        delta = p-center
        if delta.length < 1e-6:
            return dest, fraction
        normal = delta.normalized()
        aim = u.normalized().rotation_difference(v.normalized()) @ normal
        old = radial(arms, center, normal, .105)
        new = radial(dst, dest, aim, 1.8)
        if old is None or new is None or new < .06:
            return dest+aim*(delta.length*23+.09), fraction
        return dest+aim*(new+max(.12,(delta.length-old)*22+.11)), fraction

    def from_skin(q, allowed, fallback, side=None):
        surface, faces = (dst, target_faces) if side is None else (legs[side][1], leg_faces[side])
        nearest, _, face, _ = surface.find_nearest(q)
        ids = faces[face]
        factors = poly_3d_calc([Vector(target[i]) for i in ids], nearest)
        groups = {}
        for i, factor in zip(ids, factors):
            for j, weight in zip(joints[i], weights[i]):
                if j in allowed and weight > 0:
                    groups[int(j)] = groups.get(int(j),0) + max(0, factor)*weight
        good = sorted(((j,w) for j,w in groups.items() if w > 1e-7), key=lambda item:-item[1])[:4]
        return good or [(fallback,1.)]

    def fit_and_bind(p, region):
        x,y,z = p
        side = 1 if x >= 0 else -1
        if region in {'head', 'veil'}:
            h = 34.45 + (z-1.323)*24.4
            q = Vector((x*23.5,y*22.5-.60,h))
            if region == 'veil':
                weight = float(np.interp(z,[1.06,1.3,1.45],[.38,.76,1]))
                return q, [(13,weight),(11,1-weight)]
            return q, [(13,1.)]
        if region == 'arm':
            q, t = fit_arm(p, side)
            mid = float(np.interp(t,[.36,.64],[0,1]))
            hand = float(np.interp(t,[.84,1.12],[0,.8]))
            a,b,c = (15,16,17) if side == 1 else (23,24,25)
            return q, [(a,1-mid),(b,mid*(1-hand)),(c,mid*hand)]
        if region.startswith('shoe-'):
            side = 1 if region == 'shoe-left' else -1
            q = fit_shoe(p,side)
            a,b = (5,6) if side == 1 else (9,10)
            t = float(np.interp(q.y,[-2.8,-1.35],[.86,0]))
            return q, [(a,1-t),(b,t)]
        if region in {'leg','stocking'}:
            # The source uses one stocking on the left leg. Its inner toe
            # crosses X=0 in bind pose, but still belongs to the left foot.
            if region == 'stocking':
                side = 1
            q = fit_leg(p,side,region)
            a,b,c,d = (3,4,5,6) if side == 1 else (7,8,9,10)
            if q.z < 6:
                allowed, fallback = {b,c,d}, c
            elif q.z < 12:
                allowed, fallback = {a,b,c}, b
            else:
                allowed, fallback = {1,a,b}, a
            return q, from_skin(q, allowed, fallback, side)
        q = fit_torso(p,region)
        if region in {'train','skirt'}:
            t = float(np.interp(z,[.70,.92,1.035],[.64,.28,0]))
            left = float(np.interp(x,[-.045,.045],[0,1]))
            return q, [(1,1-t),(3,t*left),(7,t*(1-left))]
        fitted = from_skin(q,{1,2,11,12,14,22},11)
        # The bodice has long central extensions. Give those a continuous
        # pelvis anchor so they do not switch abruptly to the bust near the thighs.
        chest = float(np.interp(z,[.91,1.025],[0,1]))
        if chest == 1:
            return q, fitted
        total = sum(w for _,w in fitted)
        groups = {j: chest*w/total for j,w in fitted}
        groups[1] = groups.get(1,0) + 1-chest
        return q, sorted(groups.items(),key=lambda item:-item[1])[:4]

    evidence = []
    cloth_material = {}
    for atlas in TEXTURES:
        cloth_material[atlas] = len(skin['materials'])
        skin['materials'].append(dict(name=f'Odette 婚纱 · {atlas}', texture=f'textures/odette-{atlas.lower()}.webp',
            color=0xffffff, twoSide=True, transparent=False, opacity=1, depthWrite=True,
            roughness=.63, metalness=.03, textureAnisotropy=8))

    for name, atlas, start, count, region in PARTS:
        original = buffers[atlas][start:start+count].reshape(-1,3)
        assert len(original) == count//3
        if region == 'stocking':
            original = original[np.all(uvs[original,1] > .50,axis=1)]
        ids, indices = np.unique(original, return_inverse=True)
        triangles = indices.reshape(-1,3)
        p = points[ids]
        a,b,c = p[triangles].transpose(1,0,2)
        if np.median(np.sum(np.cross(b-a,c-a)*normals[ids][triangles].mean(1),axis=1)) < 0:
            triangles = triangles[:,[0,2,1]]
        fitted = [fit_and_bind(Vector(v),region) for v in p]
        new_points = np.asarray([q for q,_ in fitted])
        output_normals = fused_normals(new_points,triangles,normals[ids])
        uv = uvs[ids].astype(float)
        uv[:,1] = 1-uv[:,1]
        offset = len(skin['positions'])//3
        for field, values in [('positions',new_points),('uvs',uv),('normals',output_normals)]:
            skin[field].extend(values.round(6).ravel().tolist())
        for _, influences in fitted:
            total = sum(w for _,w in influences)
            skin['skinIndices'].extend([j for j,_ in influences] + [0]*(4-len(influences)))
            skin['skinWeights'].extend([round(w/total,7) for _,w in influences] + [0]*(4-len(influences)))
        skin['faces'].extend(dict(material=cloth_material[atlas],indices=tri)
                             for tri in (triangles+offset).tolist())
        parts.append(dict(name=name,runtimeVertices=len(ids),triangles=len(triangles)))
        evidence.append(dict(part=name,atlas=atlas,firstIndex=start,indexCount=count,exportedTriangles=len(triangles)))

    used = sorted({face['material'] for face in skin['faces']})
    remap = {old: new for new, old in enumerate(used)}
    skin['materials'] = [skin['materials'][i] for i in used]
    for face in skin['faces']:
        face['material'] = remap[face['material']]
    textures = {item['texture'] for item in skin['materials'] if item['texture'] != 'null'}
    for texture in textures:
        if (BASE/texture).is_file():
            copyfile(BASE/texture, OUT/texture)
        assert (OUT/texture).is_file(), 'Run --textures first'
    skin.update(vertexCount=len(skin['positions'])//3,triangleCount=len(skin['faces']))
    mesh_bytes = json.dumps(skin,ensure_ascii=False,separators=(',',':')).encode()
    (OUT/'mesh.json').write_bytes(mesh_bytes)
    manifest = json.loads((BASE/'manifest.json').read_text())
    source_files = [dict(file=p.name,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size)
                    for p in sorted(DONOR.iterdir()) if p.is_file()]
    manifest.update(appearance=ID,label=LABEL,sourceFiles=source_files)
    manifest['stats'].update(vertices=skin['vertexCount'],triangles=skin['triangleCount'],
                             materials=len(used),textures=len(textures))
    manifest['provenance'].update(outfitArchive='assets/source/odette-wedding',outfitArtist='ArmpitBelly',
        baseAppearance='liuchao',baseMeshSha256=hashlib.sha256(base_bytes).hexdigest())
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (WORK/'build-evidence.json').write_text(json.dumps(dict(parts=parts,sourceDraws=evidence,
        meshSha256=hashlib.sha256(mesh_bytes).hexdigest()),ensure_ascii=False,indent=2)+'\n')
    print('LIUCHAO_WEDDING_READY', manifest['stats'], flush=True)
    author_blend(bpy,skin,parts,label=LABEL,asset=OUT,work=WORK)


if __name__ == '__main__':
    if '--textures' in sys.argv:
        prepare_textures()
    else:
        build()
