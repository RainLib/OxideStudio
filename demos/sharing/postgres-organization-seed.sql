-- Administrator-only additive seed for the existing isolated hs_test database.
-- psql: \set ON_ERROR_STOP on, then \i this-file (or run the complete transaction).
-- No credentials or grants. Existing validation tables are preserved.
BEGIN;
DO $$
BEGIN
    IF current_database() <> 'oxide_studio_validation' THEN
        RAISE EXCEPTION 'Use only the isolated oxide_studio_validation database';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'validation') THEN
        RAISE EXCEPTION 'Expected validation schema does not exist';
    END IF;
END
$$;
SET LOCAL search_path = validation, pg_catalog;

CREATE TABLE sharing_share_demo (
    id integer PRIMARY KEY,
    name text NOT NULL,
    score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
    team text NOT NULL,
    note text NOT NULL DEFAULT ''
);
INSERT INTO sharing_share_demo VALUES
    (1, 'Alice', 86, 'Platform', 'Synthetic sharing data'),
    (2, 'Bob', 92, 'Data', 'Edit this score, then restore to 92'),
    (3, 'Carol', 78, 'Platform', 'Synthetic sharing data');

CREATE TABLE sharing_products (
    id integer PRIMARY KEY,
    sku text NOT NULL UNIQUE,
    name text NOT NULL,
    price_cents integer NOT NULL CHECK (price_cents >= 0)
);
INSERT INTO sharing_products VALUES
    (1, 'DEMO-KEYBOARD', 'Demo Keyboard', 29900),
    (2, 'DEMO-MOUSE', 'Demo Mouse', 9900);

CREATE TABLE sharing_orders (
    id integer PRIMARY KEY,
    status text NOT NULL CHECK (status IN ('paid', 'pending'))
);
INSERT INTO sharing_orders VALUES (101, 'paid'), (102, 'pending');

CREATE TABLE sharing_order_items (
    order_id integer NOT NULL REFERENCES sharing_orders(id),
    product_id integer NOT NULL REFERENCES sharing_products(id),
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
    PRIMARY KEY (order_id, product_id)
);
INSERT INTO sharing_order_items VALUES (101, 1, 1, 29900), (101, 2, 2, 9900), (102, 2, 1, 9900);
CREATE INDEX sharing_order_items_product_idx ON sharing_order_items(product_id);

CREATE TABLE sharing_schema_sandbox (id integer PRIMARY KEY, label text NOT NULL);
INSERT INTO sharing_schema_sandbox VALUES (1, 'Disposable column demo');

COMMENT ON TABLE sharing_share_demo IS 'Synthetic OxideStudio sharing fixture; reset Bob score to 92 after demo';
COMMENT ON TABLE sharing_schema_sandbox IS 'Only this sharing table is intended for schema.ddl demonstration';
COMMIT;

-- Expected: Bob 92, Alice 86.
SELECT id, name, score FROM validation.sharing_share_demo WHERE score >= 80 ORDER BY score DESC;
