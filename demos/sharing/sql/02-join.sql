-- Optional: joins, result export and Explain. All values are synthetic.
SELECT o.id, o.customer_name, SUM(i.quantity * i.unit_price_cents) AS total_cents
FROM orders o
JOIN order_items i ON i.order_id = o.id
WHERE o.status = 'paid'
GROUP BY o.id, o.customer_name
ORDER BY total_cents DESC;
-- Expected: 102 / 129900, 105 / 75700, 101 / 49700.
