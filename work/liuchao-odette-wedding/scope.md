# Case Scope

## meta
- case_id: liuchao-odette-wedding
- created: 2026-11-16T12:03:52+08:00
- operator: local
- project_root: /Users/dulinfeng/Desktop/linf_Ai_projects/陨星/meteor-web
- primary_skill: reverse-engineering/SKILL.md
- primary_id: R0
- lead_role: lead
- specialist_roles: []
- hint: 通用逆向 二进制资源格式分析 本地离线样本
- preset: offline-sample

## auth
- status: granted
- basis: own_system
- evidence_of_auth: User requested local extraction and fitting of Odette wedding clothing to repaired Liuchao.
- MUST NOT proceed if status != granted

## in_scope
- assets:
  - /Users/dulinfeng/Downloads/人物模型/其他模型/Odette_Virgin_Bride_Wedding_Mod_NANAS_p_v2/OdetteBodyPosition.buf
  - /Users/dulinfeng/Desktop/linf_Ai_projects/陨星/meteor-web
  - /Users/dulinfeng/Downloads/人物模型/其他模型/Odette_Virgin_Bride_Wedding_Mod_NANAS_p_v2
- surfaces: []
- activities: []

## out_of_scope
- assets: []
- activities: [dos, phishing_real_users, unrestricted_exfil]

## network_profile
- mode: offline
- notes: |
    offline | lab_only | authorized_target_only | unrestricted_lab
    Change mode only after auth.status = granted.
    Presets: offline-sample | ctf-public | own-system

## deliverables
- report: true
- field_journal: true
- diagrams: true
- timeline: true

## constraints
- timebox: {}
- stealth: low
- data_handling: anonymize

## signoff
- ready_for_act: true
- checklist:
  - [x] auth.status = granted
  - [x] in_scope.assets non-empty OR offline sample path set
  - [x] network_profile.mode chosen
  - [ ] out_of_scope reviewed
  - [ ] roles assigned (see skills/ops/role-map.md)

## ops_refs
- skills/ops/scope-contract.md
- skills/ops/evidence-finding-path.md
- skills/ops/role-map.md
- skills/ops/timeline-workitem.md
- skills/ops/IDENTITY.md
