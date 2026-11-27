"""Fit the supplied blue-and-white Yuzuha swimsuit to repaired Liuchao.

Run: python3 scripts/blender/build_liuchao_yuzuha.py --textures
Then: Blender -b --factory-startup --disable-autoexec --python-exit-code 1
      --python scripts/blender/build_liuchao_yuzuha.py -- --preview
"""
import hashlib
import json
import sys
from pathlib import Path
from shutil import copyfile

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_liuchao_mint import BASE, ROOT, author_blend, retain_body
from build_liuchao_wedding import fused_normals

SOURCE = ROOT / 'assets/source/yuzuha-swimwear'
WORK = ROOT / 'work/liuchao-yuzuha-swimwear'
OUT = ROOT / 'dist/assets/enhanced/liuchao-yuzuha'
LABEL = '琉潮-换装四'
ID = 'liuchao-yuzuha'
ATLAS = SOURCE / 'Texture/5144c409_1_1fabf669_Hash_DiffuseMap.dds'
SHARED_ATLAS = SOURCE / 'Texture/7a504287_1_c9115930_Hash_DiffuseMap.dds'
# The right half of both supplied atlases includes the swimsuit, bare skin
# and accessories. Left atlas halves contain donor hair and old costume parts.
HEIGHTS = [.56, .65, .75, .80, .86, .92, 1.01, 1.095, 1.17, 1.223, 1.282, 1.34]
FITTED_HEIGHTS = [15.1,17.3,19.8,21.05,22.65,24.5,26.1,27.9,29.6,31.4,32.7,34.5]


def read_mesh(code, vertex_count, index_count):
    buffer = SOURCE / 'Buffer'
    raw = np.fromfile(buffer / f'{code}-Position.buf', '<f4').reshape(vertex_count, 10)
    tex = np.fromfile(buffer / f'{code}-Texcoord.buf', '<f2').reshape(vertex_count, 10)
    faces = np.fromfile(buffer / f'{code}-Component1.buf', '<u4').reshape(index_count // 3, 3)
    points, normals = raw[:, :3], raw[:, 3:6]
    uv = tex[:, 2:4].astype(float)
    assert faces.max() < len(points) and np.isfinite(points).all() and np.isfinite(uv).all()
    return points, normals, uv, faces


def uv_islands(points, uv, faces):
    # Preserve UV seams while welding coincident vertices inside each island.
    _, welded = np.unique(np.round(np.column_stack((points, uv)), 5), axis=0, return_inverse=True)
    roots = list(range(int(welded.max()) + 1))

    def find(i):
        while roots[i] != i:
            roots[i] = roots[roots[i]]
            i = roots[i]
        return i

    for a,b,c in welded[faces]:
        root = find(a)
        roots[find(b)] = root
        roots[find(c)] = root
    groups = {}
    for i, vertex in enumerate(welded[faces[:, 0]]):
        groups.setdefault(find(vertex), []).append(i)
    return [np.asarray(group) for group in sorted(groups.values(), key=len, reverse=True)]


def prepare_textures():
    from PIL import Image

    WORK.mkdir(parents=True, exist_ok=True)
    textures = OUT / 'textures'
    textures.mkdir(parents=True, exist_ok=True)
    selections = {}
    for code, vertex_count, index_count, source, name in [
        ('5144c409',11177,39447,ATLAS,'swimsuit'),
        ('73757570',10004,36561,SHARED_ATLAS,'accessories'),
    ]:
        points, _, uv, faces = read_mesh(code, vertex_count, index_count)
        with Image.open(source) as image:
            diffuse = image.convert('RGB')
        pixels = np.asarray(diffuse)
        selections[code] = {'skin': [], 'parts': {}}
        for island in uv_islands(points, uv, faces):
            triangles = faces[island]
            uv_center = uv[triangles].mean(axis=1)
            if np.median(uv_center[:, 0]) < .5:
                continue
            sample = np.mod(uv_center, 1)
            rgb = pixels[(sample[:,1]*pixels.shape[0]).astype(int),
                         (sample[:,0]*pixels.shape[1]).astype(int)].astype(float)
            red, green, blue = np.median(rgb, axis=0)
            if red > 228 and green > 160 and red > green + 7 and green > blue + 5:
                selections[code]['skin'].extend(island.tolist())
                continue
            vertices = points[triangles].reshape(-1, 3)
            x, _, height = vertices.mean(axis=0)
            if code == '73757570':
                if vertices[:,2].max() < .157:
                    region = 'shoe-left' if x > 0 else 'shoe-right'
                elif .56 < height < .76:
                    region = 'thigh-left' if x > 0 else 'thigh-right'
                else:
                    continue
            elif abs(x) > .142 and (height > 1.02 or abs(x) > .27):
                region = 'sleeves'
            elif height < .94:
                region = 'skirt'
            else:
                region = 'bodice'
            selections[code]['parts'].setdefault(region, []).extend(island.tolist())
        # Crop the unused atlas half and remap U in the mesh export.
        diffuse = diffuse.crop((diffuse.width // 2, 0, diffuse.width, diffuse.height))
        diffuse.save(textures / f'yuzuha-{name}.webp', quality=94, method=6)
    (WORK / 'clothing-faces.json').write_text(json.dumps(selections, separators=(',', ':')))


def build():
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc

    base_bytes = (BASE / 'mesh.json').read_bytes()
    base = json.loads(base_bytes)
    skin, parts = retain_body(base, with_bottom_lining=True)
    skin['materials'] = base['materials'][:]
    start = sum(part['runtimeVertices'] for part in parts[:3])
    body = parts[3]
    assert body['name'].startswith('身体')
    end = start + body['runtimeVertices']
    dst_points = np.asarray(skin['positions']).reshape(-1, 3)[start:end]
    dst_faces = np.asarray([face['indices'] for face in skin['faces'] if all(
        start <= i < end for i in face['indices'])]) - start
    dst_joints = np.asarray(skin['skinIndices']).reshape(-1,4)[start:end]
    dst_weights = np.asarray(skin['skinWeights']).reshape(-1,4)[start:end]
    dst_vertices = [Vector(point) for point in dst_points]
    anchors = [Vector(bone['position']) for bone in base['bodyRig']['bones']]

    main = read_mesh('5144c409',11177,39447)
    extra = read_mesh('73757570',10004,36561)
    selections = json.loads((WORK / 'clothing-faces.json').read_text())
    body_src = main[3][selections['5144c409']['skin']]
    hand_shin = extra[3][selections['73757570']['skin']]
    assert len(body_src) > 2000 and len(hand_shin) > 2000

    def tree(points, faces):
        return BVHTree.FromPolygons(points, faces.tolist(), all_triangles=True)

    target_surface = tree(dst_vertices, dst_faces)
    source_surface = tree(main[0].tolist(), body_src)
    source_legs = {
        side: tree(extra[0].tolist(), hand_shin[np.all(extra[0][hand_shin, 0]*side > 0, axis=1)])
        for side in (-1,1)
    }
    target_arms = {}
    for side, slots in [(1, [14,15,16,17]), (-1, [22,23,24,25])]:
        arm_weights = np.sum(dst_weights*np.isin(dst_joints,slots),axis=1)
        arm_faces = dst_faces[np.all(arm_weights[dst_faces]>.32, axis=1)]
        target_arms[side] = tree(dst_vertices,arm_faces)
    target_legs = {
        side: tree(dst_vertices, dst_faces[np.all(dst_points[dst_faces, 0] * side > -.015, axis=1)])
        for side in (-1,1)
    }

    def radial(surface, center, unit, extent):
        hit, _, _, _ = surface.ray_cast(center + unit*extent, -unit, extent)
        return (hit-center).dot(unit) if hit is not None else None

    def fit_torso(point, skirt):
        x,y,z = point
        height = float(np.interp(z, HEIGHTS, FITTED_HEIGHTS))
        source_y = float(np.interp(z, [.75,.9,1.03,1.17,1.30], [-.02,-.014,-.033,-.025,-.001]))
        target_y = float(np.interp(height,[20,26,30,33,34.5],[-.49,-.48,-.56,-.52,-.66]))
        src_center = Vector((0,source_y,z))
        dst_center = Vector((0,target_y,height))
        delta = point - src_center
        direction = delta.normalized()
        simple = delta.length*24
        if delta.length < 1e-7:
            return dst_center
        old = radial(source_surface,src_center,direction,.16 if z>1 else .21)
        new = radial(target_surface,dst_center,direction,3.5 if 28<height<31.4 else 5.35)
        if old is None or new is None or old<.022 or new<.08:
            return dst_center + direction*(simple+.16)
        gap = float(np.interp(z,[.75,.83,.89,.94],[.36,.22,.13,.10])) if skirt else .12
        radius = new+max(gap,(delta.length-old)*23+gap)
        return dst_center + direction*float(np.clip(radius, simple*.74, simple*1.44+.18))

    def fit_sleeve(point,side):
        # The donors' forearms are lower and further forward in bind pose.
        a = Vector((side*.114,.044,1.233))
        b = Vector((side*.238,.044,1.104))
        c = Vector((side*.363,.016,.956))
        upper, lower, hand = (15,16,17) if side == 1 else (23,24,25)
        along = (point-a).dot(c-a)/(c-a).length_squared
        if along < .49:
            src_start,src_end,dst_start,dst_end = a,b,anchors[upper],anchors[lower]
        else:
            src_start,src_end,dst_start,dst_end = b,c,anchors[lower],anchors[hand]
        src_axis = src_end-src_start
        dst_axis = dst_end-dst_start
        t = (point-src_start).dot(src_axis)/src_axis.length_squared
        residual = point-src_start-src_axis*t
        rotation = src_axis.normalized().rotation_difference(dst_axis.normalized())
        dst_center = dst_start + dst_axis*t
        src_center = src_start + src_axis*t
        aim = rotation @ residual.normalized()
        expected = residual.length*23
        if residual.length > 1e-7:
            old = radial(source_surface,src_center,residual.normalized(),.100)
            new = radial(target_arms[side],dst_center,aim,1.95)
            if new is not None and new > .04:
                offset = max(0,expected-new) if old is None else max(0,(residual.length-old)*22)
                expected = new + offset + .19
        position = dst_center + aim*expected
        forearm = float(np.interp(along,[.30,.66],[0,1]))
        wrist = float(np.interp(along,[.92,1.11],[0,.55]))
        return position, [(upper,1-forearm),(lower,forearm*(1-wrist)),(hand,forearm*wrist)]

    def fit_shoe(point,side):
        x,y,z = point
        height = float(np.interp(z,[-.065,-.007,.027,.064,.14],[0,.35,.84,2.35,4.55]))
        q = Vector((side*max(.26,.96+(side*x-.117)*25), y*24.5-.21, height))
        nearest, normal, _, distance = target_legs[side].find_nearest(q)
        if nearest is not None and height>.42 and distance<1.2 and (q-nearest).dot(normal)<.085:
            q = nearest + normal*.12
        foot,toe = (5,6) if side == 1 else (9,10)
        front = float(np.interp(q.y,[-2.75,-1.26],[.88,0]))
        return q, [(foot,1-front),(toe,front)]

    def fit_thigh(point,side):
        x,y,z = point
        height = 16.85 + (z-.65)*24
        center = Vector((side*.097,-.019,z))
        target = Vector((side*1.89,-.46,height))
        direction = (point-center).normalized()
        old = radial(source_legs[side],center,direction,.15)
        new = radial(target_legs[side],target,direction,2.6)
        radius = (point-center).length
        if old is not None and new is not None and old>0 and new>0:
            radius = new + max(.21,(radius-old)*21+.17)
        else:
            radius *= 25
        return target + direction*radius, [(3 if side == 1 else 7,1.)]

    def bodice_weights(point):
        nearest, _, face, _ = target_surface.find_nearest(point)
        ids = dst_faces[face]
        factors = poly_3d_calc([dst_vertices[i] for i in ids], nearest)
        influences = {}
        for vertex, factor in zip(ids, factors):
            for bone, value in zip(dst_joints[vertex],dst_weights[vertex]):
                if bone in (1,2,11,12,14,15,22,23) and value > 0:
                    influences[int(bone)] = influences.get(int(bone),0)+max(0,factor)*value
        return sorted(influences.items(),key=lambda item:-item[1])[:4] or [(11,1.)]

    def fit(point, region):
        if region == 'sleeves':
            return fit_sleeve(point, 1 if point.x>0 else -1)
        side = 1 if region.endswith('left') else -1
        if region.startswith('shoe'):
            return fit_shoe(point,side)
        if region.startswith('thigh'):
            return fit_thigh(point,side)
        q = fit_torso(point,region=='skirt')
        if region == 'skirt':
            # Lower folds follow the thigh on their own side while the belt
            # follows the pelvis. Use one smooth gradient across the centre.
            thigh = float(np.interp(point.z,[.75,.81,.9,.94],[.88,.56,.12,0]))
            left = float(np.interp(point.x,[-.047,.047],[0,1]))
            return q, [(1,1-thigh),(3,thigh*left),(7,thigh*(1-left))]
        return q,bodice_weights(q)

    labels = {'bodice':'泳装上衣与领饰','sleeves':'荷叶袖与袖扣','skirt':'裙摆与腰饰',
              'shoe-left':'左厚底凉鞋','shoe-right':'右厚底凉鞋',
              'thigh-left':'左腿饰','thigh-right':'右腿饰'}
    evidence = []
    for code, data, texture in [('5144c409',main,'swimsuit'),('73757570',extra,'accessories')]:
        material = len(skin['materials'])
        skin['materials'].append(dict(name=f'浮波柚叶泳装 · {texture}',texture=f'textures/yuzuha-{texture}.webp',
            color=0xffffff,twoSide=True,transparent=False,opacity=1,depthWrite=True,
            roughness=.64,metalness=.02,textureAnisotropy=8))
        points,normals,uv,faces = data
        for region, selection in selections[code]['parts'].items():
            ids, indices = np.unique(faces[selection],return_inverse=True)
            triangles = indices.reshape(-1,3)
            p = points[ids]
            a,b,c = p[triangles].transpose(1,0,2)
            if np.median(np.sum(np.cross(b-a,c-a)*normals[ids][triangles].mean(1),axis=1)) < 0:
                triangles = triangles[:,[0,2,1]]
            fitted = [fit(Vector(point),region) for point in p]
            new_points = np.asarray([q for q,_ in fitted])
            new_normals = fused_normals(new_points,triangles,normals[ids])
            new_uv = uv[ids]*[2,-1]+[-1,1]
            offset = len(skin['positions'])//3
            for name, array in [('positions',new_points),('normals',new_normals),('uvs',new_uv)]:
                skin[name].extend(array.round(6).ravel().tolist())
            for _, weights in fitted:
                active = [(bone,value) for bone,value in weights if value > 1e-8]
                total = sum(value for _,value in active)
                skin['skinIndices'].extend([bone for bone,_ in active]+[0]*(4-len(active)))
                skin['skinWeights'].extend([round(value/total,7) for _,value in active]+[0]*(4-len(active)))
            skin['faces'].extend(dict(material=material,indices=triangle) for triangle in (triangles+offset).tolist())
            parts.append(dict(name=labels[region],runtimeVertices=len(ids),triangles=len(triangles)))
            evidence.append(dict(buffer=code,part=labels[region],triangles=len(triangles)))

    used = sorted({face['material'] for face in skin['faces']})
    remap = {old:new for new,old in enumerate(used)}
    skin['materials'] = [skin['materials'][i] for i in used]
    for face in skin['faces']:
        face['material'] = remap[face['material']]
    textures = {material['texture'] for material in skin['materials'] if material['texture'] != 'null'}
    for texture in textures:
        if (BASE / texture).is_file():
            copyfile(BASE / texture,OUT / texture)
        assert (OUT / texture).is_file()
    skin.update(vertexCount=len(skin['positions'])//3,triangleCount=len(skin['faces']))
    mesh_bytes = json.dumps(skin,ensure_ascii=False,separators=(',',':')).encode()
    (OUT / 'mesh.json').write_bytes(mesh_bytes)
    manifest = json.loads((BASE / 'manifest.json').read_text())
    manifest.update(appearance=ID,label=LABEL,sourceFiles=[
        dict(file=p.relative_to(SOURCE).as_posix(),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
             bytes=p.stat().st_size) for p in sorted(SOURCE.rglob('*')) if p.is_file()])
    manifest['stats'].update(vertices=skin['vertexCount'],triangles=skin['triangleCount'],
                             materials=len(used),textures=len(textures))
    manifest['provenance'].update(outfitArchive='assets/source/yuzuha-swimwear',
        baseAppearance='liuchao',baseMeshSha256=hashlib.sha256(base_bytes).hexdigest())
    (OUT / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (WORK / 'build-evidence.json').write_text(json.dumps(dict(parts=parts,sourceDraws=evidence,
        meshSha256=hashlib.sha256(mesh_bytes).hexdigest()),ensure_ascii=False,indent=2)+'\n')
    print('LIUCHAO_YUZUHA_READY',manifest['stats'],flush=True)
    author_blend(bpy,skin,parts,label=LABEL,asset=OUT,work=WORK)


if __name__ == '__main__':
    if '--textures' in sys.argv:
        prepare_textures()
    else:
        build()
