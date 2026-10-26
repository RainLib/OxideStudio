-- Run after the grid demonstration. Only changes the dedicated synthetic row.
UPDATE share_demo SET score = 92, note = 'Edit this score in the grid' WHERE id = 2;
SELECT id, name, score, note FROM share_demo ORDER BY id;
