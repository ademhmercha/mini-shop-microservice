import { sha256 } from './tokens.js';
import { tooMany } from './errors.js';

/**
 * Limitation de débit et verrouillage, compteurs dans Redis.
 * Les clés de compte sont dérivées de l'e-mail saisi (haché) qu'il existe ou non :
 * le comportement est donc identique pour les comptes inexistants (pas d'énumération).
 */
export function createRateLimiter(redis, cfg) {
  const acct = (email) => sha256(email.trim().toLowerCase()).slice(0, 32);

  return {
    /** Fenêtre fixe par adresse IP. Lève 429 au-delà de la limite. */
    async hitIp(ip, bucket = 'auth') {
      const key = `rl:ip:${bucket}:${ip}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, cfg.IP_RATE_LIMIT_WINDOW_SECONDS);
      if (count > cfg.IP_RATE_LIMIT_MAX) {
        const ttl = await redis.ttl(key);
        throw tooMany(ttl > 0 ? ttl : cfg.IP_RATE_LIMIT_WINDOW_SECONDS);
      }
    },

    /** Lève 429 si le compte est verrouillé ou dans un délai d'attente après un échec. */
    async assertAccountOpen(email) {
      const id = acct(email);
      const lockMs = await redis.pttl(`lock:${id}`);
      if (lockMs > 0) throw tooMany(Math.ceil(lockMs / 1000));
      const delayMs = await redis.pttl(`delay:${id}`);
      if (delayMs > 0) throw tooMany(Math.ceil(delayMs / 1000));
    },

    /** Enregistre un échec : délai croissant (1, 2, 4… s, plafonné à 30 s) puis verrouillage. */
    async recordFailure(email) {
      const id = acct(email);
      const failures = await redis.incr(`fail:${id}`);
      if (failures === 1) await redis.expire(`fail:${id}`, cfg.LOCKOUT_SECONDS);
      if (failures >= cfg.MAX_FAILED_LOGINS) {
        await redis.set(`lock:${id}`, '1', 'EX', cfg.LOCKOUT_SECONDS);
        await redis.del(`fail:${id}`, `delay:${id}`);
        return { locked: true, failures };
      }
      const delaySeconds = Math.min(2 ** (failures - 1), 30);
      await redis.set(`delay:${id}`, '1', 'PX', delaySeconds * 1000);
      return { locked: false, failures, delaySeconds };
    },

    async reset(email) {
      const id = acct(email);
      await redis.del(`fail:${id}`, `delay:${id}`);
    },

    /** Usage unique d'un identifiant (jti de défi 2FA, par ex.). Retourne false s'il a déjà été utilisé. */
    async consumeOnce(key, ttlSeconds) {
      const res = await redis.set(`once:${key}`, '1', 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    },
  };
}
