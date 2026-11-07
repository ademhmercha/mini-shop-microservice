import { createPgDb } from './db.js';
import { hashPassword } from './lib/passwords.js';

/* c8 ignore start */
// Compte de démonstration (vérifié, sans 2FA). Ne jamais utiliser en production.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL est obligatoire');
  process.exit(1);
}
const email = 'demo@maison-argile.test';
const password = process.env.DEMO_PASSWORD ?? 'Argile-Demo-2026!';
const db = createPgDb(url);
try {
  const existing = await db.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (existing.rows.length) {
    console.log(`Le compte ${email} existe déjà.`);
  } else {
    await db.query(
      `INSERT INTO users (email, password_hash, email_verified_at, first_name, last_name, shipping_address)
       VALUES ($1, $2, now(), 'Camille', 'Dupont', $3::jsonb)`,
      [email, await hashPassword(password), JSON.stringify({ line1: '12 rue des Potiers', line2: '', postalCode: '69001', city: 'Lyon', country: 'France' })],
    );
    console.log(`Compte de démonstration créé : ${email}`);
  }
} finally {
  await db.close();
}
/* c8 ignore stop */
