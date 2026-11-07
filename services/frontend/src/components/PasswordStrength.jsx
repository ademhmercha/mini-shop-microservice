import { passwordStrength } from '../lib/validators.js';

export function PasswordStrength({ id, password, email }) {
  const { score, label, hints } = passwordStrength(password, email);
  return (
    <div className="strength" data-score={score} id={id}>
      <div className="strength__bars" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="strength__bar" />
        ))}
      </div>
      {/* Zone vocale polie : annonce le niveau sans interrompre la saisie */}
      <p className="strength__label" role="status" aria-live="polite">
        {password ? `Solidité : ${label}` : 'Au moins 12 caractères. Une phrase de passe fonctionne très bien.'}
      </p>
      {password && hints.length > 0 && <p className="strength__hints">{hints[0]}</p>}
    </div>
  );
}
