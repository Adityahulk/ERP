-- Rebuild party ledger running balances from debit/credit signs.
-- Positive balance = receivable from party. Negative balance = payable to party.
WITH ordered AS (
  SELECT
    id,
    party_id,
    company_id,
    SUM(CASE WHEN type = 'debit' THEN amount ELSE -amount END)
      OVER (PARTITION BY company_id, party_id ORDER BY created_at ASC, id ASC ROWS UNBOUNDED PRECEDING) AS running_balance
  FROM party_ledger
)
UPDATE party_ledger l
SET balance_after = ordered.running_balance
FROM ordered
WHERE ordered.id = l.id;

WITH closing AS (
  SELECT DISTINCT ON (company_id, party_id)
    company_id,
    party_id,
    balance_after
  FROM party_ledger
  ORDER BY company_id, party_id, created_at DESC, id DESC
)
UPDATE parties p
SET balance = closing.balance_after
FROM closing
WHERE p.id = closing.party_id
  AND p.company_id = closing.company_id
  AND p.is_deleted = false;

UPDATE parties p
SET balance = 0
WHERE p.is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM party_ledger l
    WHERE l.company_id = p.company_id AND l.party_id = p.id
  );
