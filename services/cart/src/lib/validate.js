import { AppError } from './errors.js';

/** Valide req[source] avec un schéma Zod et remplace la valeur par la version nettoyée. */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!fields[key]) fields[key] = issue.message;
      }
      return next(new AppError(400, 'validation_error', 'Certains champs sont invalides.', { fields }));
    }
    if (source === 'query') Object.defineProperty(req, 'validatedQuery', { value: result.data, configurable: true });
    else req[source] = result.data;
    return next();
  };
}
