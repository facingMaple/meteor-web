export const TRAINING_ENEMY_COUNT = Object.freeze({ min: 1, max: 6, defaultValue: 2 });

export function trainingEnemyCount(value) {
  const { min, max, defaultValue } = TRAINING_ENEMY_COUNT;
  const count = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isInteger(count) ? Math.max(min, Math.min(count, max)) : defaultValue;
}
