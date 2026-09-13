export function createRequestGeneration() {
  let current = 0;

  return {
    begin(): number {
      current += 1;
      return current;
    },
    isCurrent(generation: number): boolean {
      return generation === current;
    },
  };
}
