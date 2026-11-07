-- Données de démonstration : l'univers « Maison Argile », céramique artisanale.
INSERT INTO categories (slug, name, description, position) VALUES
  ('bols', 'Bols', 'Pour le riz du soir, le porridge d''hiver et les fruits du marché.', 1),
  ('tasses', 'Tasses', 'Cuites une à une, pensées pour la main qui les tient.', 2),
  ('vases', 'Vases', 'Des silhouettes calmes pour une branche, une fleur, ou rien du tout.', 3),
  ('assiettes', 'Assiettes', 'Le plat du dimanche comme la tartine du matin.', 4),
  ('theieres', 'Théières', 'Pour laisser infuser le temps.', 5);

INSERT INTO products (category_id, slug, name, description, details, price_cents, illustration_key, tone, featured)
SELECT c.id, p.slug, p.name, p.description, p.details, p.price_cents, p.illustration_key, p.tone, p.featured
FROM (VALUES
  ('bols', 'bol-aube', 'Bol Aube', 'Un bol large et profond, émail blanc cassé tiré à la cendre. Il garde la chaleur et épouse la paume.', 'Ø 14 cm · 45 cl · grès émaillé', 2400, 'bowl-aube', 'creme', true),
  ('bols', 'bol-fumee', 'Bol Fumée', 'Une teinte de braise éteinte, un bord légèrement irrégulier qui rappelle le geste du tourneur.', 'Ø 12 cm · 35 cl · grès émaillé', 2800, 'bowl-fumee', 'charbon', false),
  ('tasses', 'tasse-sieste', 'Tasse Sieste', 'Une anse généreuse pour les longs cafés. Chaque tasse porte la trace de son potier au revers.', 'H 8 cm · 25 cl · grès émaillé', 1800, 'cup-sieste', 'terracotta', true),
  ('tasses', 'tasse-brume', 'Tasse Brume', 'Un émail sauge velouté, doux au toucher, pour le thé du matin.', 'H 7 cm · 20 cl · grès émaillé', 1600, 'cup-brume', 'sauge', false),
  ('tasses', 'gobelet-sillon', 'Gobelet Sillon', 'Sans anse, strié à la main. Pour l’eau fraîche, le café allongé ou le lait chaud.', 'H 9 cm · 22 cl · grès brut', 1400, 'cup-sillon', 'creme', false),
  ('vases', 'vase-lune-basse', 'Vase Lune Basse', 'Large et posé comme une lune d’automne. Une seule branche suffit.', 'H 18 cm · Ø 22 cm · terre cuite', 6800, 'vase-lune', 'terracotta', true),
  ('vases', 'vase-souffle', 'Vase Souffle', 'Un col étroit sur un ventre rond, pensé pour les herbes sèches et les fleurs de champ.', 'H 30 cm · Ø 14 cm · grès émaillé', 8400, 'vase-souffle', 'sauge', false),
  ('vases', 'vase-colline', 'Vase Colline', 'Deux courbes, deux couleurs d’argile : une silhouette de colline au crépuscule.', 'H 24 cm · Ø 12 cm · terre cuite', 5200, 'vase-colline', 'charbon', false),
  ('assiettes', 'assiette-ecume', 'Assiette Écume', 'Un marli plat, un émail blanc légèrement craquelé. La table l’aime nue comme dressée.', 'Ø 27 cm · grès émaillé', 2200, 'plate-ecume', 'creme', false),
  ('assiettes', 'assiette-mie', 'Assiette Creuse Mie', 'Un creux accueillant pour les soupes et les pâtes, un pied discret pour la saisir d’une main.', 'Ø 22 cm · H 4 cm · grès émaillé', 2600, 'plate-mie', 'terracotta', false),
  ('theieres', 'theiere-serenade', 'Théière Sérénade', 'Une panse ronde, un bec fin qui ne goutte pas, un couvercle qui se range sans bruit.', '75 cl · anse en osier · grès émaillé', 7800, 'teapot-serenade', 'sauge', true),
  ('theieres', 'theiere-petit-matin', 'Théière Petit Matin', 'La petite sœur : quatre tasses de thé, une poignée haute et un émail terre de Sienne.', '50 cl · grès émaillé', 6400, 'teapot-matin', 'terracotta', false)
) AS p (category, slug, name, description, details, price_cents, illustration_key, tone, featured)
JOIN categories c ON c.slug = p.category;
