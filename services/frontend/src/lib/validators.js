// Mêmes règles que le service auth (qui reste la référence) : retour immédiat à l'utilisateur.
const COMMON = new Set([
  'password1234', 'passwordpassword', 'motdepasse123', 'motdepasse1234', 'azertyuiop12', 'azertyazerty',
  'qwertyuiop12', 'qwertyqwerty', '123456789012', '1234567890123', 'iloveyou1234', 'letmein12345',
  'administrator', 'welcome12345', 'changeme1234', 'abcdefghijkl', 'bonjour12345', 'marseille1234',
]);

export function emailError(value) {
  const v = value.trim();
  if (!v) return 'Saisissez votre adresse e-mail.';
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Cette adresse e-mail ne semble pas valide.';
  return '';
}

export function passwordError(password, email = '') {
  if (!password) return 'Choisissez un mot de passe.';
  if (password.length < 12) {
    const missing = 12 - password.length;
    return `Encore ${missing} caractère${missing > 1 ? 's' : ''} pour atteindre 12.`;
  }
  if (password.length > 128) return 'Maximum 128 caractères.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.{1,8})\1+$/.test(lower)) return 'Ce mot de passe est trop courant ou répétitif.';
  const mail = email.trim().toLowerCase();
  const local = mail.split('@')[0];
  if (mail && (lower.includes(mail) || (local.length >= 4 && lower.includes(local)))) {
    return 'Le mot de passe ne doit pas contenir votre adresse e-mail.';
  }
  return '';
}

export const requiredError = (label) => (value) => (String(value ?? '').trim() ? '' : `${label} est requis.`);

/** Indicateur de solidité : 0 (vide) à 4. Toujours accompagné d'un libellé et de conseils (jamais la couleur seule). */
export function passwordStrength(password, email = '') {
  if (!password) return { score: 0, label: '', hints: [], valid: false };
  const hints = [];
  const policy = passwordError(password, email);
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  let score = 1;
  if (!policy) score = 2;
  if (!policy && password.length >= 14 && classes >= 3) score = 3;
  if (!policy && password.length >= 18 && classes >= 3) score = 4;
  if (policy) hints.push(policy);
  if (!policy && classes < 3) hints.push('Mélangez majuscules, minuscules, chiffres ou symboles.');
  if (!policy && password.length < 16) hints.push('Une phrase de passe longue est plus sûre.');
  const labels = ['', 'Trop faible', 'Acceptable', 'Solide', 'Excellent'];
  return { score, label: labels[score], hints, valid: !policy };
}
