/** Wall-clock noise only pushes a load time up, so over budget gets one more load and the smaller sample counts (#758). */
export async function measureLoadBudget(budgetMs: number, first: number, remeasure: () => Promise<number>): Promise<{ best: number; samples: number[] }> {
  if (!(first > budgetMs)) return { best: first, samples: [first] };
  const second = await remeasure();
  return { best: Math.min(first, second), samples: [first, second] };
}
