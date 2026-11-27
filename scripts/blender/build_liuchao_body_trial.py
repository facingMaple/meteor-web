"""Build the local Liuchao swimsuit comparison without rebuilding other outfits.

Run python3 scripts/blender/build_liuchao_body_trial.py --textures, then run
Blender -b --factory-startup --disable-autoexec --python-exit-code 1
--python scripts/blender/build_liuchao_body_trial.py -- --preview
"""
import copy
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from shutil import copyfile

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_liuchao_mint import BASE, ROOT, author_blend, retain_body
from build_liuchao_yuzuha import (
    ATLAS, SHARED_ATLAS, OUT as OUTFIT, WORK as OUTFIT_WORK, read_mesh, uv_islands,
)

ID = 'liuchao-body-trial'
LABEL = '琉潮-换装四试穿版'
OUT = ROOT / 'dist/assets/enhanced' / ID
WORK = ROOT / 'work/liuchao-body-trial'
SCALE = 24.65
FLOOR = -.06074153
BODY_Y_OFFSET = -.93
HEAD_OFFSET = np.array((0.,.06,.08))
NECK_SAMPLE = np.array([247.,230.,211.])
SCALP_RIM_SAMPLE = np.array([255.,241.,225.])
FACE_SAMPLE = np.array([246.,221.,207.])
SCALP_SAMPLE = np.array([221.,177.,155.])
FACE_TEXTURE = 'textures/liuchao-face-trial.webp'
SCALP_TEXTURE = 'textures/liuchao-scalp-trial.webp'
NECK_TEXTURE = 'textures/liuchao-neck-trial.webp'
OUTFIT_TEXTURE = 'textures/yuzuha-swimsuit.webp'
NECK_CUT = 1.2936


def smoothstep(value):
    value = np.clip(value,0.,1.)
    return value*value*(3.-2.*value)


def prepare_textures():
    from PIL import Image

    (OUT / 'textures').mkdir(parents=True,exist_ok=True)
    # Use the same UVs and decoded colors as the supplied outfit. The atlas
    # already carries painted shadows and color for the exposed torso and limbs.
    if ATLAS.read_bytes() != SHARED_ATLAS.read_bytes():
        raise ValueError('The two supplied draws must share the same diffuse atlas')
    with Image.open(ATLAS) as dds:
        image = dds.convert('RGB')
        image.crop((image.width//2,0,image.width,image.height)).save(
            OUT / OUTFIT_TEXTURE, quality=94, method=6)

    with Image.open(BASE / 'textures/颜.webp') as image:
        face = np.asarray(image.convert('RGB'),dtype=np.float32)
    # Balance only skin-colored regions on a copy of the face atlas used by
    # the skin materials. The eyes, lashes, teeth and lips keep their maps.
    red,green,blue = face.transpose(2,0,1)
    mask = smoothstep((red-172)/52)*smoothstep((green-125)/62)*smoothstep((red-blue-7)/15)
    correction = NECK_SAMPLE - FACE_SAMPLE - [0.,3.,1.]
    corrected = np.clip(face+mask[:,:,None]*correction,0,255)
    Image.fromarray(np.rint(corrected).astype(np.uint8)).save(
        OUT / FACE_TEXTURE, quality=96, method=6)

    with Image.open(BASE / 'textures/scalp.webp') as image:
        scalp = np.asarray(image.convert('RGB'),dtype=np.float32)
    # Preserve the painted value variation along the rear scalp while matching
    # its skin tone to the neck instead of carrying over the old body tint.
    scalp = (scalp-SCALP_SAMPLE)*[.62,.65,.68]+NECK_SAMPLE-[3.,7.,6.]
    Image.fromarray(np.rint(np.clip(scalp,0,255)).astype(np.uint8)).save(
        OUT / SCALP_TEXTURE, quality=96, method=6)

    blend = smoothstep(np.linspace(1.,0.,96))[:,None]
    neck = NECK_SAMPLE + blend*(SCALP_RIM_SAMPLE-NECK_SAMPLE)
    strip = np.repeat(neck[:,None,:],16,axis=1)
    Image.fromarray(np.rint(strip).astype(np.uint8)).save(OUT / NECK_TEXTURE, lossless=True)


def donor_transform(p):
    return np.asarray(p,dtype=float)*SCALE + np.array([0.,BODY_Y_OFFSET,-FLOOR*SCALE])


def lower_neckline(points):
    x,_,z = points.T
    center = 1-smoothstep((np.abs(x+.001)-.041)/.063)
    collar = smoothstep((z-1.256)/.062)
    result = points.copy()
    result[:,2] -= .0245*center*collar
    return result


def deform_surface(points,normals,warp):
    epsilon = .0001
    jacobian = np.stack([
        (warp(points+delta)-warp(points-delta))/(2*epsilon)
        for delta in np.eye(3)*epsilon
    ],axis=2)
    normals = np.linalg.solve(jacobian.transpose(0,2,1),normals[:,:,None])[:,:,0]
    normals /= np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
    return warp(points),normals


def joint_landmarks(side):
    # Centers estimated on the body from the supplied mesh. The offset between
    # the ankle and toe lands inside the platform sandal, above its sole.
    return {
        'hip': (side*.064,.001,.814),
        'knee': (side*.097,-.018,.499),
        'ankle': (side*.114,.023,.101),
        'toe': (side*.119,-.072,.014),
        'clavicle': (side*.026,.029,1.269),
        'shoulder': (side*.105,.035,1.234),
        'elbow': (side*.235,.041,1.113),
        'wrist': (side*.350,.026,.948),
        'thumb': (side*.365,.016,.914),
        'thumb_end': (side*.385,.003,.889),
        'fingers': (side*.410,.020,.870),
        'finger_end': (side*.448,.022,.841),
    }


def build_rig(base):
    from mathutils import Vector
    from hutao_native_rest import B, world as REST

    rig = copy.deepcopy(base['bodyRig'])
    positions = [None] * 30
    for slot, point in {
        0:(0,.021,.783), 1:(0,.017,.862), 2:(0,.020,.981),
        11:(0,.020,1.132), 12:(0,.026,1.258),
    }.items():
        positions[slot] = donor_transform(point)
    positions[13] = np.asarray(rig['bones'][13]['position']) + HEAD_OFFSET
    for side, leg_slots, arm_slots in [
        (1, (3,4,5,6), (14,15,16,17,18,19,20,21)),
        (-1,(7,8,9,10),(22,23,24,25,26,27,28,29)),
    ]:
        points = joint_landmarks(side)
        for slot,key in zip(leg_slots,('hip','knee','ankle','toe')):
            positions[slot] = donor_transform(points[key])
        for slot,key in zip(arm_slots,('clavicle','shoulder','elbow','wrist','thumb','thumb_end','fingers','finger_end')):
            positions[slot] = donor_transform(points[key])
    native = [REST[x['name']] for x in B]
    aims = {3:4,4:5,5:6,7:8,8:9,9:10,
            14:15,15:16,16:17,17:20,18:19,20:21,
            22:23,23:24,24:25,25:28,26:27,28:29}
    for i,bone in enumerate(rig['bones']):
        bone['position'] = positions[i].tolist()
        if i in aims:
            j = aims[i]
            rest_axis = (native[j].translation-native[i].translation).normalized()
            source_axis = Vector(positions[j]-positions[i]).normalized()
            q = rest_axis.rotation_difference(source_axis) @ native[i].to_quaternion()
            bone['rotation'] = [q.x,q.y,q.z,q.w]
    rig.update(sourceUniformScale=SCALE,sourceFloor=FLOOR)
    return rig


def soften_jaw(points):
    x,y,z = points.T
    # Preserve the expressive features. Smooth the sudden change in width
    # at the lower cheek and lift the point of the chin slightly.
    lower_jaw = np.exp(-((z-34.24)/.54)**2)
    forward = smoothstep((-y-.94)/1.18)
    chin_tip = np.exp(-((z-33.74)/.38)**2)*np.exp(-(x/.73)**2)*forward
    return np.column_stack((
        x*(1+.105*lower_jaw),
        y+.095*chin_tip,
        z+.16*chin_tip,
    ))


def retained_head(base):
    original, old_parts = retain_body(base)
    skin = {**original, **{key:[] for key in ['positions','normals','uvs','skinIndices','skinWeights','faces']}}
    parts = []
    start = face_start = 0
    for part in old_parts:
        end = start+part['runtimeVertices']
        face_end = face_start+part['triangles']
        name = part['name']
        if not name.startswith(('身体','左手','右手')):
            offset = len(skin['positions'])//3-start
            positions = np.asarray(original['positions'][start*3:end*3]).reshape(-1,3)
            normals = np.asarray(original['normals'][start*3:end*3]).reshape(-1,3)
            if name.startswith(('官方面部','后脑')):
                # Apply the same map and normal transform to both sides of
                # the face/scalp joins so the closed head stays closed.
                positions,normals = deform_surface(positions,normals,soften_jaw)
            skin['positions'].extend((positions+HEAD_OFFSET).round(6).ravel().tolist())
            skin['normals'].extend(normals.round(6).ravel().tolist())
            for key,width in [('uvs',2),('skinIndices',4),('skinWeights',4)]:
                skin[key].extend(original[key][start*width:end*width])
            # Original head, eyes, hair and ornaments remain attached to the
            # same bone slots. Only the position of the head assembly changes.
            skin['faces'].extend(dict(material=face['material'],indices=[v+offset for v in face['indices']])
                                 for face in original['faces'][face_start:face_end])
            parts.append(dict(part))
        start,face_start = end,face_end
    materials = [dict(material) for material in base['materials']]
    for material in materials:
        if material['name'] in ('颜.001','颜2.001'):
            material['texture'] = FACE_TEXTURE
        elif material['name'] == '后脑 · 原始头皮':
            material['texture'] = SCALP_TEXTURE
        if material.get('skinSurface'):
            material['roughness'] = .6
    skin['materials'] = materials
    return skin,parts


def combine(groups,limit=4):
    totals = {}
    for index,value in groups:
        if value > 1e-8:
            totals[index] = totals.get(index,0.)+value
    strongest = sorted(totals.items(),key=lambda member:-member[1])[:limit]
    weight = sum(v for _,v in strongest)
    return [(i,v/weight) for i,v in strongest]


def ramp(value,lo,hi):
    return float(smoothstep((value-lo)/(hi-lo)))


def arm_location(point,side):
    marks = joint_landmarks(side)
    shoulder = np.asarray(marks['shoulder'])
    elbow = np.asarray(marks['elbow'])
    wrist = np.asarray(marks['wrist'])
    axis = wrist-shoulder
    t = np.dot(point-shoulder,axis)/np.dot(axis,axis)
    elbow_t = np.dot(elbow-shoulder,axis)/np.dot(axis,axis)
    return float(t),float(elbow_t)


def upper_weights(point,hand_bones=None):
    x,y,z = point
    side = 1 if x>=0 else -1
    collar,shoulder,elbow,wrist = (14,15,16,17) if side==1 else (22,23,24,25)
    t,elbow_t = arm_location(point,side)

    # The shoulder transition is continuous across the skin and fabric UVs.
    east = abs(x)
    shoulder_height = ramp(z,.91,1.035)
    arm_amount = ramp(east,.154-.062*shoulder_height,.224-.05*shoulder_height)
    arm_amount *= 1-ramp(z,1.27,1.318)
    upper_arm = ramp(t,-.13,.15)
    forearm = ramp(t,elbow_t-.13,elbow_t+.14)
    palm = ramp(t,.83,1.023)
    arm_groups = [(collar,(1-upper_arm)*(1-forearm)),
                  (shoulder,upper_arm*(1-forearm)),(elbow,forearm*(1-palm)),(wrist,forearm*palm)]
    if hand_bones:
        hand_fraction = ramp(t,.93,1.088)
        arm_groups = [(i,v*(1-hand_fraction)) for i,v in arm_groups]
        arm_groups.extend((i,v*hand_fraction) for i,v in hand_bones)
        arm_amount = max(arm_amount,hand_fraction)

    neck = ramp(z,1.238,1.306)*(1-ramp(east,.028,.082))
    # Keep the choker and the skin directly behind it on the neck joint.
    collar_height = ramp(z,1.292,1.302)*(1-ramp(east,.039,.068))
    neck = max(neck,collar_height)
    chest = ramp(z,1.012,1.136)
    waist = ramp(z,.895,1.008)
    torso = [(1,(1-waist)*(1-neck)),(2,waist*(1-chest)*(1-neck)),
             (11,waist*chest*(1-neck)),(12,neck)]
    return combine([(i,v*arm_amount) for i,v in arm_groups]+
                   [(i,v*(1-arm_amount)) for i,v in torso])


def lower_weights(point):
    x,y,z = point
    side = 1 if x>=0 else -1
    thigh,shin,ankle,toe = (3,4,5,6) if side==1 else (7,8,9,10)
    pelvis = ramp(z,.755,.881)
    calf = 1-ramp(z,.449,.550)
    foot = 1-ramp(z,.083,.159)
    # Weight the foot and sandal together. Only the toe edge follows toe flex
    # so the thick platform keeps its profile.
    toes = .32*(1-ramp(y,-.107,-.047))*(1-ramp(z,.026,.066))
    return combine([(1,pelvis),(thigh,(1-pelvis)*(1-calf)),(shin,calf*(1-foot)*(1-pelvis)),
                    (ankle,calf*foot*(1-toes)*(1-pelvis)),(toe,calf*foot*toes*(1-pelvis))])


def donor_hand_weights(indices,weights,left):
    # Read the supplied phalanx weights, grouping the four long fingers onto
    # the original game's finger pair. The palm and thumb retain their slots.
    base = 77 if left else 58
    wrist,thumb,thumb_end,fingers,finger_end = (17,18,19,20,21) if left else (25,26,27,28,29)
    local_map = (wrist,wrist,wrist,thumb,thumb,thumb_end,
                 fingers,fingers,finger_end,finger_end,fingers,finger_end,
                 finger_end,fingers,finger_end,fingers,finger_end,finger_end,thumb_end)
    grouped = [(local_map[int(i)-base],float(w)) for i,w in zip(indices,weights)
               if base<=i<base+len(local_map) and np.isfinite(w) and 0<w<=1.001]
    return combine(grouped) if grouped else [(wrist,1.)]


def scalp_opening(skin,parts):
    """Return the rim under Liuchao's head in counterclockwise order."""
    vertex_start = face_start = 0
    for part in parts:
        vertex_end = vertex_start+part['runtimeVertices']
        face_end = face_start+part['triangles']
        if part['name'].startswith('后脑'):
            break
        vertex_start,face_start = vertex_end,face_end
    else:
        raise ValueError('Liuchao scalp is missing')

    points = np.asarray(skin['positions'][vertex_start*3:vertex_end*3]).reshape(-1,3)
    normals = np.asarray(skin['normals'][vertex_start*3:vertex_end*3]).reshape(-1,3)
    triangles = np.asarray([face['indices'] for face in skin['faces'][face_start:face_end]])-vertex_start
    _, representatives, welded = np.unique(points.round(4),axis=0,return_index=True,return_inverse=True)
    edges = Counter(tuple(sorted((a,b))) for x,y,z in welded[triangles]
                    for a,b in ((x,y),(y,z),(z,x)) if a != b)
    at_neck = points[representatives,2] < points[:,2].min()+.185
    rim_edges = [(representatives[i],representatives[j]) for (i,j),count in edges.items()
                 if count == 1 and at_neck[i] and at_neck[j]]
    degree = Counter(i for edge in rim_edges for i in edge)
    if len(degree) < 12 or set(degree.values()) != {2}:
        raise ValueError('The neck opening must be a closed ring')
    ids = np.array(list(degree))
    planar = points[ids,:2]-(points[ids,:2].max(0)+points[ids,:2].min(0))/2
    angles = np.arctan2(planar[:,1],planar[:,0])
    order = np.argsort(angles)
    return points[ids[order]],normals[ids[order]],angles[order]


def cut_neck_skin(vertices,triangles,source_indices):
    """Keep the torso below the throat and retain the exact edge for the new skin."""
    below = vertices[:,2] < NECK_CUT
    edge_indices = {}
    intersections = []

    def cut_index(a,b):
        i,j = sorted((a,b))
        if (i,j) not in edge_indices:
            start,end = vertices[i],vertices[j]
            fraction = (NECK_CUT-start[2])/(end[2]-start[2])
            edge_indices[i,j] = len(vertices)+len(intersections)
            intersections.append(start+(end-start)*fraction)
        return edge_indices[i,j]

    faces = triangles[below[triangles].all(1)].tolist()
    for polygon in triangles[below[triangles].any(1)&~below[triangles].all(1)]:
        clipped = []
        for a,b in zip(polygon,np.roll(polygon,-1)):
            if below[a]:
                clipped.append(a)
            if below[a] != below[b]:
                clipped.append(cut_index(a,b))
        faces.extend((clipped[0],clipped[i],clipped[i+1]) for i in range(1,len(clipped)-1))
    used,indices = np.unique(faces,return_inverse=True)
    data = np.vstack((vertices,intersections))[used]
    source_indices = np.append(source_indices,np.full(len(intersections),-1))[used]
    return data,indices.reshape(-1,3),source_indices


def append_rings(skin,parts,name,rings,normals,angles,weights,levels,material):
    first_vertex = len(skin['positions'])//3
    first_face = len(skin['faces'])
    starts = []
    slot = len(skin['materials'])
    skin['materials'].append(material)
    for ring,ring_normals,ring_weights,level in zip(rings,normals,weights,levels):
        starts.append(len(skin['positions'])//3)
        skin['positions'].extend(ring.round(6).ravel().tolist())
        skin['normals'].extend(ring_normals.round(6).ravel().tolist())
        for group in ring_weights:
            pad = 4-len(group)
            skin['uvs'].extend([.5,float(level)])
            skin['skinIndices'].extend([i for i,_ in group]+[0]*pad)
            skin['skinWeights'].extend([round(w,7) for _,w in group]+[0]*pad)

    # Walk both outlines by angle so the bottom and top edges can retain
    # their own vertex spacing without leaving gaps in the skin.
    for start,end,lower,upper in zip(starts,starts[1:],angles,angles[1:]):
        i = j = 0
        while i<len(lower) or j<len(upper):
            a = start+(i-1)%len(lower)
            b = end+(j-1)%len(upper)
            if j==len(upper) or (i<len(lower) and lower[i]<=upper[j]):
                triangle = [a,start+i,b]
                i += 1
            else:
                triangle = [a,end+j,b]
                j += 1
            skin['faces'].append(dict(material=slot,indices=triangle))
    parts.append(dict(name=name,runtimeVertices=len(skin['positions'])//3-first_vertex,
                      triangles=len(skin['faces'])-first_face))


def add_neck(skin,parts,root,root_normals,root_source):
    """Fit the skin from the torso to the jaw, then place the fabric around it."""
    top,top_normals,top_angles = scalp_opening(skin,parts)
    _,representatives = np.unique(root.round(4),axis=0,return_index=True)
    root,root_normals,root_source = (
        values[representatives] for values in (root,root_normals,root_source)
    )
    planar = root[:,:2]-(root[:,:2].max(0)+root[:,:2].min(0))/2
    theta = np.arctan2(planar[:,1],planar[:,0])
    order = np.argsort(theta)
    theta,root,root_normals,root_source = (v[order] for v in (theta,root,root_normals,root_source))
    target = np.column_stack([np.interp(theta,top_angles,axis,period=2*np.pi) for axis in top.T])
    target_normals = np.column_stack([np.interp(theta,top_angles,axis,period=2*np.pi)
                                       for axis in top_normals.T])
    height = target[:,2:]-root[:,2:]
    delta = target[:,:2]-root[:,:2]

    def tangent(normal):
        lateral = normal[:,:2]
        slope = -normal[:,2:]*lateral/np.maximum(np.sum(lateral*lateral,axis=1,keepdims=True),1e-8)
        return np.clip(slope*height,np.minimum(0,2*delta),np.maximum(0,2*delta))

    # Follow the torso and scalp normals at each end. Limit the slope of
    # each curve to the interval between those ends to avoid a pinched waist.
    fabric_levels = np.array([.35,.39,.54,.58])
    levels = np.sort(np.r_[0.,.12,.24,.31,fabric_levels,.66,.77,.87,.94])
    t = levels[:,None,None]
    rings = root+(target-root)*smoothstep(t)
    rings[:,:,:2] += t*(1-t)**2*tangent(root_normals)+t*t*(t-1)*tangent(target_normals)
    rings[:,:,2:] = root[:,2:]+t*height
    tangent_along_ring = np.roll(rings,-1,axis=1)-np.roll(rings,1,axis=1)
    normals = np.cross(tangent_along_ring,np.gradient(rings,levels,axis=0))
    normals /= np.linalg.norm(normals,axis=2,keepdims=True)
    normals[0] = root_normals
    base_weights = [upper_weights(point) for point in root_source]
    weights = []
    for level in levels:
        # The skin through the ribbon and the ribbon itself turn together.
        # Ease into the chest below that area and into the head above it.
        torso = 1-ramp(level,0.,.30)
        head = ramp(level,.66,1.)
        weights.append([
            combine([(i,w*torso) for i,w in group]+[(12,(1-torso)*(1-head)),(13,(1-torso)*head)])
            for group in base_weights
        ])
    top_weights = [[(13,1.)] for _ in top]
    append_rings(skin,parts,'颈部 · 下颌过渡',[*rings,top],[*normals,top_normals],
                 [theta]*len(rings)+[top_angles],weights+[top_weights],
                 [*levels,1.],dict(name='颈部 · 肤色过渡',texture=NECK_TEXTURE,color=0xffffff,
                                  roughness=.6,metalness=0,skinSurface=True))

    ribbon_rows = np.searchsorted(levels,fabric_levels)
    fabric = rings[ribbon_rows].copy()
    fabric_normals = normals[ribbon_rows].copy()
    outward = fabric_normals[:,:,:2]
    radial = outward/np.linalg.norm(outward,axis=2,keepdims=True)
    fabric[:,:,:2] += np.array([.062,.098,.098,.062])[:,None,None]*radial
    append_rings(skin,parts,'浅蓝软质颈带',fabric,fabric_normals,[theta]*len(fabric),
                 [weights[i] for i in ribbon_rows],fabric_levels,
                 dict(name='浅蓝织带',texture='null',color=0x82ADB9,twoSide=True,roughness=.83,metalness=0))


def build():
    import bpy
    from build_liuchao_yuzuha import SOURCE

    base_bytes = (BASE/'mesh.json').read_bytes()
    base = json.loads(base_bytes)
    skin,parts = retained_head(base)
    skin['bodyRig'] = build_rig(base)
    selections = json.loads((OUTFIT_WORK/'clothing-faces.json').read_text())
    if not (OUT/NECK_TEXTURE).is_file():
        raise RuntimeError('Run this file with --textures first')

    outfitted_source = [
        ('5144c409',read_mesh('5144c409',11177,39447),'身体 · 泳装随包躯干'),
        ('73757570',read_mesh('73757570',10004,36561),'身体 · 泳装随包手脚'),
    ]
    labels = {'bodice':'蓝白泳装上衣','sleeves':'荷叶袖与袖扣','skirt':'短裙与腰饰',
              'shoe-left':'左厚底凉鞋','shoe-right':'右厚底凉鞋',
              'thigh-left':'左腿饰','thigh-right':'右腿饰'}
    costume_slot = len(skin['materials'])
    skin_slot = costume_slot + 1
    skin['materials'].extend([
        dict(name='蓝白泳装与凉鞋',texture=OUTFIT_TEXTURE,color=0xffffff,twoSide=True,transparent=False,
             opacity=1,depthWrite=True,roughness=.64,metalness=.02),
        dict(name='配套原肤色',texture=OUTFIT_TEXTURE,color=0xffffff,twoSide=True,transparent=False,
             opacity=1,depthWrite=True,roughness=.6,metalness=0,skinSurface=True),
    ])
    evidence = []
    neck_root = None
    for code,(points,normals,uv,faces),body_name in outfitted_source:
        groups = {'skin':selections[code]['skin'],**selections[code]['parts']}
        assert sum(map(len,groups.values())) > 10000
        blend = np.fromfile(SOURCE/'Buffer'/f'{code}-Blend.buf','<u4').reshape(len(points),8)
        source_joints = blend[:,4:]
        source_weights = blend[:,:4].copy().view('<f4')

        # Fabric and skin vertices at coincident UV seams use the same
        # geometric falloff across the joint.
        for region,selection in groups.items():
            source_triangles = faces[selection]
            if region=='bodice':
                kept = []
                for island in uv_islands(points,uv,source_triangles):
                    island_points = points[np.unique(source_triangles[island])]
                    is_old_choker = island_points[:,2].min()>1.277 and np.abs(island_points[:,0]).max()<.056
                    if not is_old_choker:
                        kept.extend(island)
                source_triangles = source_triangles[sorted(kept)]
            ids, indices = np.unique(source_triangles,return_inverse=True)
            triangles = indices.reshape(-1,3)
            vertices = np.column_stack((points[ids],normals[ids],uv[ids]))
            if code=='5144c409' and region=='skin':
                vertices,triangles,ids = cut_neck_skin(vertices,triangles,ids)
            original,original_normals,original_uv = vertices[:,:3],vertices[:,3:6],vertices[:,6:]
            a,b,c = original[triangles].transpose(1,0,2)
            if np.median(np.sum(np.cross(b-a,c-a)*original_normals[triangles].mean(1),axis=1))<0:
                triangles = triangles[:,[0,2,1]]
            neck_region = (np.abs(original[:,0]+.001)<.104)&(original[:,2]>1.256)
            model_points = original.copy()
            model_normals = original_normals.copy()
            model_points[neck_region],model_normals[neck_region] = deform_surface(
                model_points[neck_region],model_normals[neck_region],lower_neckline,
            )
            new_points = donor_transform(model_points)
            new_uv = original_uv*[2,-1]+[-1,1]
            if code=='5144c409' and region=='skin':
                cut = ids<0
                neck_root = (new_points[cut],model_normals[cut],original[cut])
            offset = len(skin['positions'])//3
            for field,array in [('positions',new_points),('normals',model_normals),('uvs',new_uv)]:
                skin[field].extend(np.asarray(array,dtype=float).round(6).ravel().tolist())
            for index,p in zip(ids,original):
                if p[2]<.881 and abs(p[0])<.22:
                    weights = lower_weights(p)
                else:
                    hand = (donor_hand_weights(source_joints[index],source_weights[index],p[0]>=0)
                            if code=='73757570' and abs(p[0])>.323 else None)
                    weights = upper_weights(p,hand)
                pad = 4-len(weights)
                skin['skinIndices'].extend([i for i,_ in weights]+[0]*pad)
                skin['skinWeights'].extend([round(w,7) for _,w in weights]+[0]*pad)
            material = skin_slot if region=='skin' else costume_slot
            skin['faces'].extend(dict(material=material,indices=triangle) for triangle in (triangles+offset).tolist())
            name = body_name if region=='skin' else labels[region]
            parts.append(dict(name=name,runtimeVertices=len(ids),triangles=len(triangles)))
            evidence.append(dict(source=code,part=name,triangles=len(triangles),
                                 sourceIndices=ids[ids>=0].tolist(),cutVertices=int(np.sum(ids<0))))

    if neck_root is None:
        raise ValueError('Torso neck edge is missing')
    add_neck(skin,parts,*neck_root)
    used = sorted({face['material'] for face in skin['faces']})
    remap = {old:new for new,old in enumerate(used)}
    skin['materials'] = [skin['materials'][i] for i in used]
    for face in skin['faces']:
        face['material'] = remap[face['material']]
    textures = {material['texture'] for material in skin['materials'] if material['texture']!='null'}
    for texture in textures:
        if (BASE/texture).is_file():
            copyfile(BASE/texture,OUT/texture)
        assert (OUT/texture).is_file(),texture
    skin.update(vertexCount=len(skin['positions'])//3,triangleCount=len(skin['faces']))
    mesh = json.dumps(skin,ensure_ascii=False,separators=(',',':')).encode()
    (OUT/'mesh.json').write_bytes(mesh)
    manifest = json.loads((OUTFIT/'manifest.json').read_text())
    manifest.update(appearance=ID,label=LABEL)
    manifest['stats'].update(vertices=skin['vertexCount'],triangles=skin['triangleCount'],
                             materials=len(used),textures=len(textures))
    manifest['retarget']['method'] = (
        'Supplied swimsuit body, clothing and shoes on a source-length display rig. '
        'Liuchao head kept at its fitted height, with continuous neck skin and a separate fabric band.')
    manifest['provenance'].update(baseAppearance='liuchao',referenceAppearance='liuchao-yuzuha',
        baseMeshSha256=hashlib.sha256(base_bytes).hexdigest(),trial=True,
        limits=['Swimsuit surfaces retain the supplied diffuse colors. The neck band is newly fitted.',
                'Hair and clothing follow bones; no secondary physics or expression morphs.'])
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    WORK.mkdir(parents=True,exist_ok=True)
    (WORK/'build-evidence.json').write_text(json.dumps(dict(parts=parts,sourceDraws=evidence,
        uniformScale=SCALE,sourceFloor=FLOOR,headOffset=HEAD_OFFSET.tolist(),
        neckColor=NECK_SAMPLE.astype(int).tolist(),meshSha256=hashlib.sha256(mesh).hexdigest()),
        ensure_ascii=False,separators=(',',':'))+'\n')
    print('LIUCHAO_BODY_TRIAL_READY',manifest['stats'],flush=True)
    author_blend(bpy,skin,parts,label=LABEL,asset=OUT,work=WORK,open_arms=True)


if __name__=='__main__':
    if '--textures' in sys.argv:
        prepare_textures()
    else:
        build()
