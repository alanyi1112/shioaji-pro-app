export const D1_SAFE_BATCH_SIZE = 40;

export async function runD1Batch<TStatement>(
  db: { batch(statements: TStatement[]): Promise<unknown> },
  statements: TStatement[],
  size = D1_SAFE_BATCH_SIZE,
) {
  if (!Number.isInteger(size) || size < 1 || size > D1_SAFE_BATCH_SIZE) throw new Error("invalid_d1_batch_size");
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}
