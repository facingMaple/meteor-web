const families = {
  sword: {
    prefix: 'w0', glyph: '剑',
    variants: { 0: '赤铭剑', 1: '熔阳剑', 2: '紫篆剑', 3: '玄霄剑', 4: '雪晶礼剑' },
    festive: '星羽流虹剑'
  },
  dagger: {
    prefix: 'w1', glyph: '匕',
    variants: { 0: '金牙匕', 1: '双焰匕', 2: '雾蓝匕', 3: '素铁匕', 4: '乌银缎结' },
    festive: '烈凰匕'
  },
  musket: {
    prefix: 'w2', glyph: '铳',
    variants: { 0: '铁蜂连铳', 1: '赤木火铳', 2: '霜原长铳', 3: '蓝弦星铳', 4: '游龙彩铳' }
  },
  dart: {
    prefix: 'w3', glyph: '镖',
    variants: { 0: '飞来靴', 1: '银口扳手', 2: '紫晶飞珠', 3: '蓝晶飞珠', 4: '黑白旋球', 5: '流火飞珠' }
  },
  hammer: {
    prefix: 'w4', glyph: '锤',
    variants: { 0: '金箍鼓锤', 1: '赤纹战锤', 2: '巨型针筒', 3: '倒栽金甲', 4: '彩糖巨锤' },
    festive: '鎏金紫鼓'
  },
  blade: {
    prefix: 'w5', glyph: '刀',
    variants: { 0: '绯纹双月斧', 1: '百炼阔刃', 2: '暮蝠刃', 4: '怪脸木拍' },
    festive: '曦焰阔刀'
  },
  wheel: {
    prefix: 'w6', glyph: '轮',
    variants: { 0: '赤环星轮', 1: '碧纹三月轮', 2: '四芒铁轮', 3: '银月四翼轮', 4: '翠光飞碟' },
    festive: '金鳞焰轮'
  },
  spear: {
    prefix: 'w7', glyph: '枪',
    variants: { 0: '银潮双锋戟', 1: '青鳞龙牙枪', 2: '金枝鹿角枪', 3: '曜金飞翼戟', 4: '彩结雪铲' },
    festive: '金藤缠枪'
  },
  dual: {
    prefix: 'w8', glyph: '刺', paired: true,
    variants: { 0: '碧蝠双刃', 1: '赤柄双叉', 2: '紫晶双斧', 3: '霜线双刺', 4: '碧蝠巨刃' }
  },
  qiankun: {
    prefix: 'w9', glyph: '乾', paired: true,
    variants: { 0: '金羽折扇', 1: '墨鞘长刀', 2: '金星乾坤刀', 3: '绯缠乾坤刀' }
  },
  knuckle: {
    prefix: 'w10', glyph: '虎', paired: true,
    variants: { 0: '赤腕三爪', 1: '朱漆双拐', 2: '银棘拳刃', 3: '蓝晶双锤' }
  },
  ninja: {
    prefix: 'w11', glyph: '忍',
    variants: { 0: '碧烟忍刀', 1: '赤练忍刀', 2: '紫夜忍刀', 3: '沧浪忍刀' }
  }
};

export const COLLECTION_MODEL_PREFIX = 'collection-';

function appearance(family, variant, name, festive = false) {
  const code = `${family.prefix}_${variant}`;
  const id = `${COLLECTION_MODEL_PREFIX}${festive ? 'festive-' : ''}${code}`;
  return {
    id,
    name,
    glyph: festive ? '雪' : family.glyph,
    detail: festive ? '动态贴图' : '',
    collection: festive ? 'festive' : 'standard',
    festive,
    modelIds: family.paired ? [`${id}r`, `${id}l`] : [id]
  };
}

export const WEAPON_COLLECTION_APPEARANCES = Object.fromEntries(
  Object.entries(families).map(([weapon, family]) => {
    const appearances = Object.entries(family.variants).map(([variant, name]) => appearance(family, variant, name));
    if (family.festive) appearances.push(appearance(family, 4, family.festive, true));
    return [weapon, appearances];
  })
);
