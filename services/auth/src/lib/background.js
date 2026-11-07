/**
 * Exécute des tâches après l'envoi de la réponse (e-mails, hachage) pour que le temps de réponse
 * ne dépende pas de l'existence d'un compte. `drain()` attend les tâches en cours (arrêt propre, tests).
 */
export function createBackground(log) {
  const pending = new Set();
  return {
    run(fn) {
      const p = Promise.resolve()
        .then(fn)
        .catch((err) => log.error({ err: { message: err?.message } }, 'tâche de fond en échec'))
        .finally(() => pending.delete(p));
      pending.add(p);
    },
    async drain() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}
