export function pickRecommendation<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T {
  if (items.length === 0) throw new Error('recommendation items must not be empty');
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}
