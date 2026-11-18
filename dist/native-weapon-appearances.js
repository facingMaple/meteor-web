// Appearance-only variants use separate model IDs from the equipped weapon record.
export const DEFAULT_NATIVE_WEAPON_APPEARANCES = Object.freeze({
  sword: 'butterfly', blade: 'original', spear: 'original', dagger: 'original',
  dart: 'original', dual: 'original', hammer: 'original', musket: 'original',
  wheel: 'original', qiankun: 'original', knuckle: 'original', ninja: 'original'
});

const entries = {
  sword: [
    { id: 'original', name: '原版长剑', glyph: '剑', detail: '原版模型与贴图' },
    { id: 'butterfly', name: '月蝶剑', glyph: '蝶', detail: '冰蓝剑身 · 蝶翼护手' },
    { id: 'raiden', name: '雷电影佩刀', glyph: '影', detail: '紫色弯刃 · 原模型贴图' },
    { id: 'fairy-wand', name: '仙女棒', glyph: '星', detail: '原版圣诞外观 · 璀璨长剑', festive: true, modelIds: ['w0_4'] },
    { id: 'glow-azure-sword', name: '流光剑', glyph: '流', detail: '发光外观 · 蓝色剑光', modelIds: ['glow-w0_0'] },
    { id: 'glow-flame-sword', name: '赤焰剑', glyph: '焰', detail: '发光外观 · 赤色剑光', modelIds: ['glow-w0_1'] }
  ],
  blade: [
    { id: 'original', name: '原版大刀', glyph: '刀', detail: '原版模型与贴图' },
    { id: 'back-scratcher', name: '抓扒子', glyph: '扒', detail: '原版圣诞外观 · 趣味大刀', festive: true, modelIds: ['w5_4'] }
  ],
  spear: [
    { id: 'original', name: '原版长枪', glyph: '枪', detail: '原版模型与贴图' },
    { id: 'phoenix', name: '霜翎凤鸣枪', glyph: '凤', detail: '冰蓝双尖 · 银金凤翼' },
    { id: 'snow-shovel', name: '雪地铲', glyph: '铲', detail: '原版圣诞外观 · 雪地长兵', festive: true, modelIds: ['w7_4'] },
    { id: 'glow-azure-spear', name: '寒星枪', glyph: '寒', detail: '发光外观 · 蓝色枪芒', modelIds: ['glow-w7_0'] },
    { id: 'glow-flame-spear', name: '烈焰枪', glyph: '烈', detail: '发光外观 · 赤色枪芒', modelIds: ['glow-w7_1'] }
  ],
  dagger: [
    { id: 'original', name: '原版匕首', glyph: '匕', detail: '原版模型与贴图' },
    { id: 'candy-cane', name: '拐杖糖', glyph: '糖', detail: '原版圣诞外观 · 糖果匕首', festive: true, modelIds: ['w1_4'] },
    { id: 'glow-serpent-dagger', name: '灵蛇匕首', glyph: '蛇', detail: '发光外观 · 红蓝双刃', modelIds: ['glow-w1_0'] }
  ],
  dart: [
    { id: 'original', name: '原版飞镖', glyph: '镖', detail: '原版模型与贴图' },
    { id: 'snowball', name: '雪球', glyph: '雪', detail: '原版圣诞外观 · 银白飞镖', festive: true, modelIds: ['w3_4'] },
    { id: 'bell', name: '铃铛', glyph: '铃', detail: '原版圣诞外观 · 清脆飞镖', festive: true, modelIds: ['w3_5'] }
  ],
  dual: [
    { id: 'original', name: '原版双刺', glyph: '刺', detail: '原版模型与贴图' },
    { id: 'star', name: '星星', glyph: '星', detail: '原版圣诞外观 · 双手星刃', festive: true, modelIds: ['w8_4r', 'w8_4l'] },
    { id: 'glow-twin-stingers', name: '双生刺', glyph: '双', detail: '发光外观 · 左红右蓝', modelIds: ['glow-w8_0r', 'glow-w8_0l'] }
  ],
  hammer: [
    { id: 'original', name: '原版重锤', glyph: '锤', detail: '原版模型与贴图' },
    { id: 'lollipop', name: '棒棒糖', glyph: '糖', detail: '原版圣诞外观 · 糖果重锤', festive: true, modelIds: ['w4_4'] }
  ],
  musket: [
    { id: 'original', name: '原版火铳', glyph: '铳', detail: '原版模型与贴图' },
    { id: 'firecracker', name: '拉炮', glyph: '炮', detail: '原版圣诞外观 · 喜庆火铳', festive: true, modelIds: ['w2_4'] }
  ],
  wheel: [
    { id: 'original', name: '原版飞轮', glyph: '轮', detail: '原版模型与贴图' },
    { id: 'saucer', name: '飞碟', glyph: '碟', detail: '原版圣诞外观 · 回旋飞碟', festive: true, modelIds: ['w6_4'] }
  ],
  qiankun: [
    { id: 'original', name: '原版乾坤刀', glyph: '乾', detail: '原版模型与贴图' },
    { id: 'glow-qiankun', name: '发光乾坤刀', glyph: '坤', detail: '发光外观 · 红刃蓝鞘', modelIds: ['glow-w9_0r', 'glow-w9_0l'] }
  ],
  knuckle: [{ id: 'original', name: '原版指虎', glyph: '虎', detail: '原版模型与贴图' }],
  ninja: [{ id: 'original', name: '原版忍刀', glyph: '忍', detail: '原版模型与贴图' }]
};

export const NATIVE_WEAPON_APPEARANCES = Object.freeze(Object.fromEntries(
  Object.entries(entries).map(([weapon, options]) => [weapon, Object.freeze(options.map(option => Object.freeze(option)))])
));

export function nativeWeaponAppearance(weapon, id) {
  return NATIVE_WEAPON_APPEARANCES[weapon]?.find(option => option.id === id) || null;
}

export function nativeWeaponAppearanceName(weapon, id) {
  return nativeWeaponAppearance(weapon, id)?.name || NATIVE_WEAPON_APPEARANCES[weapon]?.[0]?.name || '原版外观';
}

export function normalizeNativeWeaponAppearances(value, legacy = {}) {
  const normalized = { ...DEFAULT_NATIVE_WEAPON_APPEARANCES };
  for (const [weapon, options] of Object.entries(NATIVE_WEAPON_APPEARANCES)) {
    const selected = value?.[weapon] ?? (weapon === 'sword' ? legacy.sword : weapon === 'spear' ? legacy.spear : null);
    if (options.some(option => option.id === selected)) normalized[weapon] = selected;
  }
  return normalized;
}
