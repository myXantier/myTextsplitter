export interface BenchmarkResult {
  averageTime: number;
  totalTime: number;
  resultText: string;
};

export function benchmark<T>(fn: () => T, runs: number = 10): BenchmarkResult {
  if (runs <= 0) {
    throw new Error('Number of runs must be greater than 0.');
  }

  const warmUpRuns = runs > 5 ? 3 : 1;
  for (let i = 0; i < warmUpRuns; i++) {
    fn();
  }

  const startTime = performance.now();

  for (let i = 0; i < runs; i++) {
    fn();
  }

  const endTime = performance.now();

  const totalTime = endTime - startTime;
  const averageTime = totalTime / runs;
  const result: BenchmarkResult = { averageTime: averageTime, totalTime: totalTime, resultText: `Gesamte Zeit: ${totalTime.toFixed(2)}ms ≙ Ø ${averageTime.toFixed(2)}ms pro run` }
  return result;
}
