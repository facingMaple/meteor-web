const families = {
  sword: { prefix: 'w0', glyph: '剑', variants: [0, 1, 2, 3, 4], festive: true },
  dagger: { prefix: 'w1', glyph: '匕', variants: [0, 1, 2, 3, 4], festive: true },
  musket: { prefix: 'w2', glyph: '铳', variants: [0, 1, 2, 3, 4] },
  dart: { prefix: 'w3', glyph: '镖', variants: [0, 1, 2, 3, 4, 5] },
  hammer: { prefix: 'w4', glyph: '锤', variants: [0, 1, 2, 3, 4], festive: true },
  blade: { prefix: 'w5', glyph: '刀', variants: [0, 1, 2, 4], alias: 'W5_3', festive: true },
  wheel: { prefix: 'w6', glyph: '轮', variants: [0, 1, 2, 3, 4], alias: 'W6_5', festive: true },
  spear: { prefix: 'w7', glyph: '枪', variants: [0, 1, 2, 3, 4], festive: true },
  dual: { prefix: 'w8', glyph: '刺', variants: [0, 1, 2, 3, 4], paired: true },
  qiankun: { prefix: 'w9', glyph: '乾', variants: [0, 1, 2, 3], paired: true },
  knuckle: { prefix: 'w10', glyph: '虎', variants: [0, 1, 2, 3], paired: true },
  ninja: { prefix: 'w11', glyph: '忍', variants: [0, 1, 2, 3] }
};

export const COLLECTION_MODEL_PREFIX = 'collection-';

function appearance(family, variant, festive = false) {
  const code = `${family.prefix}_${variant}`;
  const id = `${COLLECTION_MODEL_PREFIX}${festive ? 'festive-' : ''}${code}`;
  const label = code.toUpperCase();
  const alias = variant === 0 && family.alias;
  return {
    id,
    name: festive ? `圣诞动态 ${label}` : alias ? `${label} / ${alias}` : label,
    glyph: festive ? '雪' : family.glyph,
    detail: festive ? '动态贴图' : '',
    collection: festive ? 'festive' : 'standard',
    festive,
    modelIds: family.paired ? [`${id}r`, `${id}l`] : [id]
  };
}

export const WEAPON_COLLECTION_APPEARANCES = Object.fromEntries(
  Object.entries(families).map(([weapon, family]) => {
    const appearances = family.variants.map(variant => appearance(family, variant));
    if (family.festive) appearances.push(appearance(family, 4, true));
    return [weapon, appearances];
  })
);
