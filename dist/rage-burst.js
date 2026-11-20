// Balance settings for the Web game's defensive burst.
export const RAGE_BURST = Object.freeze({
  cost: 60,
  radius: 4,
  height: 1.6,
  pushDistance: 2.8,
  pushTime: .26,
  protection: .2,
  actionTime: .82,
  effectTime: .94
});

// Use the game's existing directional falls and their prone/recovery chains.
export const RAGE_BURST_FALL = Object.freeze({
  targetpose: 98, targetposeback: 97, targetposeleft: 99, targetposeright: 96
});

export function canRageBurst({ grounded, busy, reaction }) {
  return grounded && (!busy || reaction === 'hit' || reaction === 'guard') &&
    reaction !== 'down' && reaction !== 'recover';
}
