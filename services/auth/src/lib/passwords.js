import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, verify } from '@node-rs/argon2';

// Argon2id, paramètres minimaux OWASP : m = 19 MiB, t = 2, p = 1.
const ARGON2ID = 2;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => hash(password, OPTIONS);

export async function verifyPassword(storedHash, password) {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

// Hash factice pour égaliser le temps de réponse quand le compte n'existe pas.
let dummy;
export async function dummyVerify(password) {
  dummy ??= await hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(dummy, password);
  return false;
}

const listFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'common-passwords.txt');
let common;
function commonSet() {
  common ??= new Set(
    fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean),
  );
  return common;
}

const STRIP = /[^a-z]+$/;

/** Retourne un message d'erreur (français) ou null si le mot de passe respecte la politique. */
export function passwordPolicyError(password, email = '') {
  if (password.length < 12) return 'Le mot de passe doit contenir au moins 12 caractères.';
  if (password.length > 128) return 'Le mot de passe ne doit pas dépasser 128 caractères.';
  const lower = password.toLowerCase();
  const set = commonSet();
  if (set.has(lower) || set.has(lower.replace(STRIP, ''))) {
    return 'Ce mot de passe est trop courant. Choisissez-en un autre.';
  }
  if (/^(.{1,8})\1+$/.test(lower)) return 'Ce mot de passe est trop répétitif.';
  const mail = email.toLowerCase();
  const local = mail.split('@')[0];
  if (mail && (lower.includes(mail) || (local.length >= 4 && lower.includes(local)))) {
    return "Le mot de passe ne doit pas contenir votre adresse e-mail.";
  }
  return null;
}
