# Vox Keyword Patrol Rule Contract

Patrol rules should distinguish accepted records, rejected records, blocked states, and uncertain records.

The default Feishu output should contain only accepted records that meet the business rules. Rejected,
blocked, and uncertain records should stay in local audit logs unless the user explicitly asks for a
diagnostic sheet.

Every accepted record should retain enough source evidence to support manual review.
