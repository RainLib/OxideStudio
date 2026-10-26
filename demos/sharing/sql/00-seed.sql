-- Synthetic data shared by SQLite and PostgreSQL. Run only in the dedicated demo database.
CREATE TABLE demo_manifest (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fixture TEXT NOT NULL,
    version INTEGER NOT NULL
);
INSERT INTO demo_manifest VALUES (1, 'oxide-sharing', 1);

CREATE TABLE share_demo (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    team TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
);
INSERT INTO share_demo VALUES
    (1, 'Alice', 86, 'Platform', 'Synthetic demo participant'),
    (2, 'Bob', 92, 'Data', 'Edit this score in the grid'),
    (3, 'Carol', 78, 'Platform', 'Synthetic demo participant');

CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    stock INTEGER NOT NULL CHECK (stock >= 0)
);
INSERT INTO products VALUES
    (1, 'DEMO-KEYBOARD', 'Demo Keyboard', 29900, 20),
    (2, 'DEMO-MOUSE', 'Demo Mouse', 9900, 50),
    (3, 'DEMO-DISPLAY', 'Demo Display', 129900, 8),
    (4, 'DEMO-HUB', 'Demo USB Hub', 15900, 32);

CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('paid', 'pending', 'cancelled')),
    ordered_at TEXT NOT NULL
);
INSERT INTO orders VALUES
    (101, 'Demo Customer A', 'paid', '2026-10-20T09:00:00Z'),
    (102, 'Demo Customer B', 'paid', '2026-10-21T10:00:00Z'),
    (103, 'Demo Customer C', 'pending', '2026-10-22T11:00:00Z'),
    (104, 'Demo Customer D', 'cancelled', '2026-10-23T12:00:00Z'),
    (105, 'Demo Customer E', 'paid', '2026-10-24T13:00:00Z'),
    (106, 'Demo Customer F', 'pending', '2026-10-25T14:00:00Z');

CREATE TABLE order_items (
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    PRIMARY KEY (order_id, product_id)
);
INSERT INTO order_items VALUES
    (101, 1, 1, 29900), (101, 2, 2, 9900),
    (102, 3, 1, 129900), (103, 4, 2, 15900),
    (104, 2, 1, 9900), (105, 1, 2, 29900),
    (105, 4, 1, 15900), (106, 3, 1, 129900);
CREATE INDEX orders_status_idx ON orders(status);
CREATE INDEX order_items_product_idx ON order_items(product_id);

CREATE TABLE demo_notes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL
);
INSERT INTO demo_notes VALUES
    (1, 'Query lifecycle', 'Connection -> queryId -> driver -> result -> history'),
    (2, 'Grid editing', 'Draft -> primary key -> bound parameters -> refresh'),
    (3, 'AI Plan', 'Read metadata, propose a plan, do not execute mutations');

CREATE TABLE schema_sandbox (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL
);
INSERT INTO schema_sandbox VALUES (1, 'Temporary column demo');

CREATE VIEW paid_order_totals AS
SELECT o.id, o.customer_name, SUM(i.quantity * i.unit_price_cents) AS total_cents
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.status = 'paid'
GROUP BY o.id, o.customer_name;
