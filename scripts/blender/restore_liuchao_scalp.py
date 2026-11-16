"""Restore Liuchao's missing skull from the hidden mesh in the original .blend."""

from collections import Counter, defaultdict
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets/source/liuchao/琉潮.blend'
EDITABLE = ROOT / 'assets/source/liuchao/琉潮-修复版.blend'
DONOR = '官方原始网格 · 隐藏备份'
SCALP = '后脑 · 原始头皮'


def edge_key(a, b):
    return tuple(sorted((a, b)))


def donor_regions(triangles, vertex_keys):
    """Find skin components across UV splits, keeping the source corner IDs."""
    edges = defaultdict(list)
    triangle_edges = {}
    for i, triangle in enumerate(triangles):
        keys = [vertex_keys[v] for v in triangle.vertices]
        triangle_edges[i] = [edge_key(a, b) for a, b in zip(keys, keys[1:] + keys[:1])]
        for edge in triangle_edges[i]:
            edges[edge].append(i)
    pending = set(triangle_edges)
    while pending:
        stack = [pending.pop()]
        region = []
        boundary = set()
        while stack:
            i = stack.pop()
            region.append(i)
            for edge in triangle_edges[i]:
                if len(edges[edge]) == 1:
                    boundary.update(edge)
                for neighbor in edges[edge]:
                    if neighbor in pending:
                        pending.remove(neighbor)
                        stack.append(neighbor)
        yield sorted(region), boundary


def smoothstep(low, high, value):
    t = min(1, max(0, (value - low) / (high - low)))
    return t * t * (3 - 2 * t)


def round_scalp(vertices, faces, first_new_vertex):
    """Replace the stock hair recess with a round crown, preserving its rim."""
    recess = {i for i, face in enumerate(faces) if min(vertices[v].z for v in face) > 36.28}
    oriented = [(a, b) for i in sorted(recess)
                for a, b in zip(faces[i], faces[i][1:] + faces[i][:1])]
    counts = Counter(edge_key(a, b) for a, b in oriented)
    next_vertex = {a: b for a, b in oriented if counts[edge_key(a, b)] == 1}
    rim = [min(next_vertex)]
    while next_vertex[rim[-1]] != rim[0]:
        following = next_vertex[rim[-1]]
        assert following not in rim, 'Unexpected branching crown rim'
        rim.append(following)
    assert len(rim) == len(next_vertex) == 30

    # Ease the donor's lower rim into Liuchao's existing neck.
    for point in vertices[first_new_vertex:]:
        point.y -= .28 * (1 - smoothstep(34.2, 34.7, point.z)) * smoothstep(-.7, .14, point.y)
    for i in rim:
        if i >= first_new_vertex:
            point = vertices[i]
            centre_span = 1 - smoothstep(0, 1.9, abs(point.x))
            point.y += .13 + 1.26 * centre_span
            point.z += .25 + .32 * centre_span

    # The ellipsoid fits inside the short hair. Its pole is tilted back so
    # the new rings follow the rim in order, including at the two temples.
    center = Vector((0, -.94, 35.96))
    radii = Vector((2.03, 2.25, 2.75))
    polar_point = Vector((0, .62, 38.33))
    pole = Vector((polar_point[i] - center[i]) / radii[i] for i in range(3))
    directions = [Vector((vertices[v][i] - center[i]) / radii[i] for i in range(3)) for v in rim]
    assert all(a.cross(b).dot(pole) > 0 for a, b in zip(directions, directions[1:] + directions[:1]))
    kept = [i for i in range(len(faces)) if i not in recess]
    new_faces = [faces[i] for i in kept]
    first_rounded_vertex = len(vertices)
    vertices.append(polar_point)
    inner = None
    for step in range(1, 9):
        if step == 8:
            outer = rim
        else:
            t = step / 8
            outer = list(range(len(vertices), len(vertices) + len(rim)))
            for direction in directions:
                normal = pole.lerp(direction, t).normalized()
                distance = pole.length * (1 - t*t) + direction.length * t*t
                vertices.append(Vector(center[i] + radii[i] * normal[i] * distance for i in range(3)))
        for i, b in enumerate(outer):
            j = (i + 1) % len(rim)
            if inner is None:
                new_faces.append((first_rounded_vertex, b, outer[j]))
            else:
                new_faces.extend([(inner[i], b, outer[j]), (inner[i], outer[j], inner[j])])
        inner = outer
    rim_points = [vertices[i] for i in rim]
    tone_blend = [
        1.0 if i >= first_rounded_vertex else
        1.0 - smoothstep(0, .8, min((point - anchor).length for anchor in rim_points))
        for i, point in enumerate(vertices)
    ]
    return kept, new_faces, tone_blend


def restore_scalp(face, rig):
    old = face.data
    if old.materials.get(SCALP):
        return
    assert old.shape_keys is None and old.uv_layers.active, 'Expected the editable game face mesh'
    before = set(bpy.data.user_map())
    with bpy.data.libraries.load(str(SOURCE), link=False) as (available, selected):
        assert DONOR in available.objects, 'Original Liuchao head backup is missing'
        selected.objects = [DONOR]
    donor, = selected.objects
    loaded = set(bpy.data.user_map()) - before
    source = donor.data
    scalp_spec = source.materials['肌']
    image = scalp_spec.node_tree.nodes['mmd_base_tex'].image
    assert image.packed_file, 'Original scalp atlas must be packed'
    source.calc_loop_triangles()

    scale = rig['sourceUniformScale']
    floor = rig['sourceFloor']
    to_mesh = face.matrix_world.inverted()
    positions = []
    for vertex in source.vertices:
        point = donor.matrix_world @ vertex.co
        point.z -= floor
        positions.append(to_mesh @ (point * scale))
    triangles = [tri for tri in source.loop_triangles if source.materials[tri.material_index] == scalp_spec]
    keys = [tuple(round(value, 4) for value in point) for point in positions]

    face_polygons = [poly for poly in old.polygons if old.materials[poly.material_index].name == '颜.001']
    edge_counts = Counter(tuple(sorted(edge)) for poly in face_polygons for edge in poly.edge_keys)
    rim = sorted({v for edge, count in edge_counts.items() if count == 1 for v in edge})
    tree = KDTree(len(rim))
    for v in rim:
        tree.insert(old.vertices[v].co, v)
    tree.balance()

    def matched_vertices(boundary):
        matches = {}
        for key in sorted(boundary):
            _, index, distance = tree.find(Vector(key))
            if distance < .001:
                matches[key] = index
        return matches

    regions = [(region, matched_vertices(boundary)) for region, boundary in donor_regions(triangles, keys)]
    region, seam = max(regions, key=lambda item: len(item[1]))
    assert len(seam) == len(set(seam.values())) == 48, 'Original scalp rim does not fit this face'

    # Share the actual facial vertices along the rim and preserve the atlas UVs
    # on each side. This keeps the former opening closed under animation.
    vertices = [v.co.copy() for v in old.vertices]
    face_indices = [tuple(poly.vertices) for poly in old.polygons]
    mapped = dict(seam)
    original_count = len(vertices)
    patch_faces = []
    for i in region:
        for v in triangles[i].vertices:
            if keys[v] not in mapped:
                mapped[keys[v]] = len(vertices)
                vertices.append(positions[v])
        patch_faces.append(tuple(mapped[keys[v]] for v in triangles[i].vertices))
    original_count_faces = len(old.polygons)
    assert len(region) == 452, 'Unexpected source scalp topology'
    kept, new_faces, tone_blend = round_scalp(vertices, patch_faces, original_count)
    used = list(range(original_count)) + sorted({v for f in new_faces for v in f if v >= original_count})
    compact = {v: i for i, v in enumerate(used)}
    faces = face_indices + [tuple(compact[v] for v in f) for f in new_faces]
    seam_indices = set(seam.values())
    edges = Counter(tuple(sorted(edge)) for face_indices in faces
                    for edge in zip(face_indices, face_indices[1:] + face_indices[:1]))
    for a, b in edge_counts:
        if a in seam_indices and b in seam_indices and edge_counts[a, b] == 1:
            assert edges[a, b] == 2, 'Open edge at the face and scalp join'

    material = bpy.data.materials.new(SCALP)
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Roughness'].default_value = .63
    shader.inputs['Specular IOR Level'].default_value = .35
    atlas = material.node_tree.nodes.new('ShaderNodeTexImage')
    atlas.image = image
    blend = material.node_tree.nodes.new('ShaderNodeAttribute')
    blend.attribute_name = '后脑肤色过渡'
    skin_tone = material.node_tree.nodes.new('ShaderNodeMixRGB')
    skin_tone.inputs[2].default_value = (.72, .44, .325, 1)
    links = material.node_tree.links
    links.new(atlas.outputs['Color'], skin_tone.inputs[1])
    links.new(blend.outputs['Fac'], skin_tone.inputs[0])
    links.new(skin_tone.outputs['Color'], shader.inputs['Base Color'])

    mesh = bpy.data.meshes.new(old.name + ' · 后脑已补全')
    mesh.from_pydata([vertices[i] for i in used], [], faces)
    blend_values = mesh.attributes.new(blend.attribute_name, 'FLOAT', 'POINT')
    blend_values.data.foreach_set('value', [tone_blend[i] for i in used])
    for original_material in old.materials:
        mesh.materials.append(original_material)
    scalp_slot = len(old.materials)
    mesh.materials.append(material)
    uv_layer = mesh.uv_layers.new(name=old.uv_layers.active.name)
    original_uv = old.uv_layers.active.uv
    original_normals = [normal.vector.copy() for normal in old.corner_normals]
    rim_normals = {old.loops[loop].vertex_index: original_normals[loop]
                   for poly in face_polygons for loop in poly.loop_indices
                   if old.loops[loop].vertex_index in seam_indices}
    for polygon in old.polygons:
        replacement = mesh.polygons[polygon.index]
        replacement.material_index = polygon.material_index
        replacement.use_smooth = polygon.use_smooth
        for old_loop, new_loop in zip(polygon.loop_indices, replacement.loop_indices):
            uv_layer.uv[new_loop].vector = original_uv[old_loop].vector

    source_uv = source.uv_layers.active.uv
    for offset, polygon in enumerate(list(mesh.polygons)[original_count_faces:]):
        polygon.material_index = scalp_slot
        polygon.use_smooth = True
        if offset >= len(kept):
            continue
        source_triangle = triangles[region[kept[offset]]]
        for loop, source_loop in zip(polygon.loop_indices, source_triangle.loops):
            uv_layer.uv[loop].vector = source_uv[source_loop].vector
    mesh.update()
    new_normals = [normal.vector.copy() for normal in mesh.corner_normals]
    for offset in range(len(new_faces)):
        polygon = mesh.polygons[original_count_faces + offset]
        for loop in polygon.loop_indices:
            v = mesh.loops[loop].vertex_index
            if v in rim_normals:
                new_normals[loop] = rim_normals[v]
    new_normals[:len(original_normals)] = original_normals
    mesh.normals_split_custom_set(new_normals)
    mesh.update()

    # Assign mesh data on the existing object so the rig modifier, pose and
    # material preview layout are carried through to the repaired scene.
    names = [group.name for group in face.vertex_groups]
    weights_by_vertex = [[(g.group, g.weight) for g in v.groups] for v in old.vertices]
    face.data = mesh
    groups = [face.vertex_groups.new(name=name) for name in names]
    for v, weights in enumerate(weights_by_vertex):
        for group, weight in weights:
            groups[group].add([v], weight, 'REPLACE')
    head_name = rig['bones'][13]['name']
    face.vertex_groups[head_name].add(list(range(original_count, len(used))), 1, 'REPLACE')
    if old.users == 0:
        bpy.data.meshes.remove(old)
    face['后脑来源'] = '琉潮.blend / 官方原始网格 · 隐藏备份'

    # Only the packed source image is needed from the appended backup.
    bpy.data.batch_remove(ids=loaded - {image})
    print(f'LIUCHAO_SCALP_READY: {len(new_faces)} triangles, {len(seam)} joined rim vertices', flush=True)


if __name__ == '__main__':
    mesh_path = ROOT / 'dist/assets/enhanced/liuchao/mesh.json'
    rig = json.loads(mesh_path.read_text())['bodyRig']
    assert Path(bpy.data.filepath).resolve() == EDITABLE.resolve(), 'Open 琉潮-修复版.blend before running'
    face = bpy.context.scene.objects['官方面部 · 游戏适配']
    restore_scalp(face, rig)
    notes = bpy.data.texts.get('打开这里 · 修复说明')
    if notes and '后脑已补全' not in notes.as_string():
        notes.write('\n后脑已补全。补片取自原始底稿，沿脸部边缘拼接并绑定头骨。可隐藏头发检查。\n')
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    destination = Path(args[0]) if args else EDITABLE
    bpy.ops.wm.save_as_mainfile(filepath=str(destination.resolve()), compress=True, relative_remap=False)
