// Balance settings for the Web game's defensive burst.
export const RAGE_BURST = Object.freeze({
  cost: 60,
  radius: 4,
  height: 1.6,
  protection: .2,
  effectTime: .94
});

export function canRageBurst({ grounded, busy, reaction }) {
  return grounded && (!busy || reaction === 'hit' || reaction === 'guard') &&
    reaction !== 'down' && reaction !== 'recover';
}
