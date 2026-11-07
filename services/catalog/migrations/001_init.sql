CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  details text NOT NULL DEFAULT '',
  price_cents integer NOT NULL CHECK (price_cents > 0),
  currency char(3) NOT NULL DEFAULT 'EUR',
  illustration_key text NOT NULL,
  tone text NOT NULL DEFAULT 'terracotta',
  featured boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_category ON products (category_id) WHERE active;

-- Moindre privilège : le catalogue est en lecture seule pour le service.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_app') THEN
    GRANT SELECT ON categories, products TO catalog_app;
  END IF;
END $$;
