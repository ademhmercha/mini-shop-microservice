/** Description lisible et minimale de l'appareil, déduite du User-Agent (aucune donnée supplémentaire stockée). */
export function describeDevice(ua = '') {
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null;
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  if (!browser && !os) return 'Appareil inconnu';
  return [browser ?? 'Navigateur', os].filter(Boolean).join(' sur ');
}
