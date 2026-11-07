/**
 * Journal d'audit : événements de sécurité uniquement. Les métadonnées sont filtrées (liste blanche)
 * pour qu'aucun secret, mot de passe, jeton ou e-mail en clair n'y entre.
 */
const ALLOWED_META = new Set(['reason', 'sessionId', 'revoked', 'method', 'target', 'family']);

export function createAudit(db, log) {
  return async function audit(event, { userId = null, ip = null, userAgent = null, metadata = {} } = {}) {
    const safe = Object.fromEntries(Object.entries(metadata).filter(([k]) => ALLOWED_META.has(k)));
    log.info({ audit: true, event, userId, ip, ...safe }, 'événement de sécurité');
    try {
      await db.query(
        'INSERT INTO audit_log (user_id, event, ip, user_agent, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)',
        [userId, event, ip, userAgent ? userAgent.slice(0, 255) : null, JSON.stringify(safe)],
      );
    } catch (err) {
      log.error({ err: { message: err.message } }, "échec d'écriture du journal d'audit");
    }
  };
}
