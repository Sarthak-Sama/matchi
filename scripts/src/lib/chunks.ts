export async function inChunks<T>(
  values: readonly T[],
  size: number,
  write: (chunk: readonly T[]) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(size) || size < 1) throw new Error("chunk size must be a positive integer");
  for (let offset = 0; offset < values.length; offset += size) {
    await write(values.slice(offset, offset + size));
  }
}
