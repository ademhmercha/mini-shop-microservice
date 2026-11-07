import { useId, useState } from 'react';
import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import { PasswordStrength } from './PasswordStrength.jsx';

function Wrapper({ id, label, optional, hint, error, children }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label} {optional && <span className="field__optional">(facultatif)</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={`${id}-error`} role="alert">
          <CircleAlert className="icon icon--sm" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

const describedBy = (id, hint, error) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

export function Field({ label, name, type = 'text', value, onChange, onBlur, error, hint, optional, ...rest }) {
  const id = useId();
  return (
    <Wrapper id={id} label={label} optional={optional} hint={hint} error={error}>
      <div className="field__control">
        <input
          id={id} className="input" name={name} type={type} value={value ?? ''} onChange={onChange} onBlur={onBlur}
          aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy(id, hint, error)} {...rest}
        />
      </div>
    </Wrapper>
  );
}

export function TextArea({ label, name, value, onChange, onBlur, error, hint, optional, ...rest }) {
  const id = useId();
  return (
    <Wrapper id={id} label={label} optional={optional} hint={hint} error={error}>
      <textarea
        id={id} className="input" name={name} value={value ?? ''} onChange={onChange} onBlur={onBlur}
        aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy(id, hint, error)} {...rest}
      />
    </Wrapper>
  );
}

/** Mot de passe avec bouton afficher/masquer et, au besoin, indicateur de solidité. */
export function PasswordField({ label, name, value, onChange, onBlur, error, hint, showStrength = false, email = '', autoComplete = 'current-password', ...rest }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <Wrapper id={id} label={label} hint={hint} error={error}>
      <div className="field__control">
        <input
          id={id} className="input input--with-action" name={name} type={visible ? 'text' : 'password'} value={value ?? ''}
          onChange={onChange} onBlur={onBlur} autoComplete={autoComplete} autoCapitalize="none" spellCheck="false"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={[describedBy(id, hint, error), showStrength ? `${id}-strength` : null].filter(Boolean).join(' ') || undefined}
          {...rest}
        />
        <button
          type="button" className="field__action" onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={visible}
        >
          {visible ? <EyeOff className="icon" aria-hidden="true" /> : <Eye className="icon" aria-hidden="true" />}
        </button>
      </div>
      {showStrength && <PasswordStrength id={`${id}-strength`} password={value ?? ''} email={email} />}
    </Wrapper>
  );
}
