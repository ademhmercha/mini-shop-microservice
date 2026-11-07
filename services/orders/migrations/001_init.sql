CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint GENERATED ALWAYS AS IDENTITY,
  -- NULL après suppression du compte (anonymisation RGPD) : la commande est conservée pour la comptabilité.
  user_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'completed', 'cancelled')),
  -- Paiement sur place (en boutique ou à la livraison) : aucune passerelle de paiement.
  payment_method text NOT NULL DEFAULT 'on_site' CHECK (payment_method IN ('on_site')),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  currency char(3) NOT NULL DEFAULT 'EUR',
  shipping_address jsonb,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user ON orders (user_id, created_at DESC);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  name_snapshot text NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20)
);
CREATE INDEX order_items_order ON order_items (order_id);

-- Moindre privilège : création et lecture ; seules l'anonymisation (user_id, adresse) et le statut sont modifiables.
-- Jamais de DELETE ni de modification des lignes de commande.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orders_app') THEN
    GRANT SELECT, INSERT ON orders, order_items TO orders_app;
    GRANT UPDATE (user_id, shipping_address, status) ON orders TO orders_app;
  END IF;
END $$;
