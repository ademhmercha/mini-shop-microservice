/** Appels de service à service (RGPD : effacement des données liées dans cart et orders). */
export function createInternalClient(cfg, log, fetchImpl = fetch) {
  const targets = [cfg.ORDERS_INTERNAL_URL, cfg.CART_INTERNAL_URL].filter(Boolean);
  return {
    async purgeUser(userId) {
      if (!cfg.INTERNAL_API_TOKEN) return;
      await Promise.all(
        targets.map(async (base) => {
          try {
            const res = await fetchImpl(`${base}/internal/users/${encodeURIComponent(userId)}`, {
              method: 'DELETE',
              headers: { 'x-internal-token': cfg.INTERNAL_API_TOKEN },
              signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) log.warn({ target: base, status: res.status }, "échec de l'effacement distant");
          } catch (err) {
            log.warn({ target: base, err: { message: err.message } }, "service injoignable pour l'effacement");
          }
        }),
      );
    },
  };
}
