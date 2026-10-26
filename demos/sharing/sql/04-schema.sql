-- Optional SQLite/personal PostgreSQL demo: run one statement at a time.
-- Take snapshot A, add the column, take snapshot B and compare them.
ALTER TABLE schema_sandbox ADD COLUMN demo_tag TEXT;
-- After reviewing the difference, restore the original structure:
ALTER TABLE schema_sandbox DROP COLUMN demo_tag;
-- Managed Gateway DDL requires a separate schema.ddl grant for this exact table.
