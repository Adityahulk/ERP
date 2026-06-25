import { PoolClient } from 'pg';

export async function enforceSingleDefaultTerm(client: PoolClient, firmId: string, transactionType: string, keepId?: string) {
  await client.query(
    `UPDATE terms_and_conditions
        SET is_default = false, updated_at = now()
      WHERE firm_id = $1
        AND transaction_type = $2
        AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [firmId, transactionType, keepId || null],
  );
}
