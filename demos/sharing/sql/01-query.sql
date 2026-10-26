-- Slide 8: expected rows: Bob / 92, Alice / 86.
SELECT id, name, score
FROM share_demo
WHERE score >= 80
ORDER BY score DESC;
