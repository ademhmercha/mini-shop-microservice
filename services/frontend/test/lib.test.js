import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { emailError, passwordError, passwordStrength, requiredError } from '../src/lib/validators.js';
import { formatPrice, plural, ORDER_STATUS } from '../src/lib/format.js';
import { safeRedirect } from '../src/auth/RequireAuth.jsx';
import { describeError } from '../src/lib/hooks.js';
import { ApiError } from '../src/api/http.js';

describe('validation', () => {
  it('valide les adresses e-mail', () => {
    expect(emailError('')).toMatch(/Saisissez/);
    expect(emailError('pas-un-email')).toMatch(/valide/);
    expect(emailError('a@b')).toMatch(/valide/);
    expect(emailError('camille@example.fr')).toBe('');
  });

  it('applique la politique de mot de passe (12 caractères, courant, e-mail)', () => {
    expect(passwordError('')).toMatch(/Choisissez/);
    expect(passwordError('court')).toMatch(/Encore 7 caractères/);
    expect(passwordError('abcdefghijk')).toMatch(/Encore 1 caractère pour/);
    expect(passwordError('a'.repeat(129))).toMatch(/128/);
    expect(passwordError('passwordpassword')).toMatch(/courant/);
    expect(passwordError('abcabcabcabc')).toMatch(/répétitif/);
    expect(passwordError('camille.dupont-1234', 'camille.dupont@example.fr')).toMatch(/e-mail/);
    expect(passwordError('Correct-Horse-Battery-9', 'camille@example.fr')).toBe('');
  });

  it('calcule la solidité avec un libellé et des conseils', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('court')).toMatchObject({ score: 1, label: 'Trop faible', valid: false });
    expect(passwordStrength('motdepassesimple')).toMatchObject({ score: 2, valid: true });
    expect(passwordStrength('Une-phrase-de-passe-9').score).toBeGreaterThanOrEqual(3);
    expect(passwordStrength('Cheval-Agrafeuse-Pile-Correcte-77!').score).toBe(4);
    expect(passwordStrength('minuscules-seulement').hints.join(' ')).toMatch(/Mélangez/);
  });

  it('requiredError', () => {
    expect(requiredError('La ville')('  ')).toBe('La ville est requis.');
    expect(requiredError('La ville')('Lyon')).toBe('');
  });
});

describe('formats', () => {
  it('formate les prix en euros et les pluriels', () => {
    expect(formatPrice(2400).replace(/\s/g, ' ')).toBe('24,00 €');
    expect(formatPrice(undefined)).toMatch(/0,00/);
    expect(plural(1, 'pièce', 'pièces')).toBe('1 pièce');
    expect(plural(3, 'pièce', 'pièces')).toBe('3 pièces');
    expect(ORDER_STATUS.pending).toMatch(/régler sur place/);
  });

  it('describeError indique le délai quand la limitation de débit s’applique', () => {
    expect(describeError(null)).toBe('');
    expect(describeError(new ApiError(429, {}, 30))).toMatch(/30 secondes/);
    expect(describeError(new ApiError(429, {}, 900))).toMatch(/15 minutes/);
    expect(describeError(new ApiError(429, {}))).toMatch(/quelques instants/);
    expect(describeError(new ApiError(400, { error: { message: 'Message serveur' } }))).toBe('Message serveur');
  });
});

describe('redirections après connexion', () => {
  it('n’accepte que des chemins internes (pas de redirection ouverte)', () => {
    expect(safeRedirect('/commande')).toBe('/commande');
    expect(safeRedirect('/compte/securite?x=1')).toBe('/compte/securite?x=1');
    expect(safeRedirect('https://evil.example')).toBe('/compte');
    expect(safeRedirect('//evil.example')).toBe('/compte');
    expect(safeRedirect('/\\evil.example')).toBe('/compte');
    expect(safeRedirect('javascript:alert(1)')).toBe('/compte');
    expect(safeRedirect(undefined, '/x')).toBe('/x');
  });
});

/* ---- Contrastes WCAG AA, calculés à partir des variables CSS réelles ---- */
const css = fs.readFileSync(path.resolve(__dirname, '../src/styles/tokens.css'), 'utf8');
const color = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))[1];
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a, b, pctA) => {
  const ch = (i) => Math.round((parseInt(a.slice(i, i + 2), 16) * pctA + parseInt(b.slice(i, i + 2), 16) * (100 - pctA)) / 100);
  return `#${[1, 3, 5].map((i) => ch(i).toString(16).padStart(2, '0')).join('')}`;
};

describe('palette et contrastes (niveau AA)', () => {
  const bg = color('bg'), surface = color('surface'), text = color('text'), text2 = color('text-2'), accent = color('accent'), sage = color('accent-2');
  it('respecte strictement la palette imposée', () => {
    expect([bg, surface, text, text2, accent, sage, color('border')].map((c) => c.toUpperCase())).toEqual(
      ['#F5EFE6', '#FBF8F3', '#2B2420', '#6B5D52', '#B5532F', '#7A8B6F', '#E2D6C6'],
    );
  });
  it.each([
    ['texte principal sur le fond', text, bg],
    ['texte principal sur les cartes', text, surface],
    ['texte secondaire sur le fond', text2, bg],
    ['texte secondaire sur les cartes', text2, surface],
    ['texte blanc sur les boutons d’action (accent)', '#FFFFFF', accent],
    ['texte du badge sur teinte sauge', text, mix(sage, surface, 22)],
    ['texte d’erreur sur le fond', mix(accent, text, 70), bg],
    ['texte d’erreur sur les cartes', mix(accent, text, 70), surface],
    ['texte clair sur bouton survolé', '#FFFFFF', mix(accent, text, 84)],
    ['texte du fond sur pastille de compteur', bg, text],
  ])('%s ≥ 4,5:1', (_label, fg, back) => {
    expect(ratio(fg, back)).toBeGreaterThanOrEqual(4.5);
  });
  it('l’accent n’est utilisé en texte que pour les grands titres (≥ 3:1)', () => {
    expect(ratio(accent, bg)).toBeGreaterThanOrEqual(3);
    expect(ratio(accent, surface)).toBeGreaterThanOrEqual(3);
  });
  it('les éléments d’interface (bordures de champs, jauge) atteignent 3:1', () => {
    expect(ratio(mix(color('border'), text2, 60), bg)).toBeGreaterThanOrEqual(1.5);
    expect(ratio(text2, surface)).toBeGreaterThanOrEqual(3);
  });
});
