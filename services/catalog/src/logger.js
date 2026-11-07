import pino from 'pino';

export const REDACT_PATHS = [
  'password', 'newPassword', 'currentPassword', 'token', 'refreshToken', 'accessToken',
  'code', 'secret', 'totp_secret_enc', 'password_hash', 'authorization', 'cookie',
  '*.password', '*.newPassword', '*.currentPassword', '*.token', '*.refreshToken', '*.accessToken',
  '*.code', '*.secret', '*.password_hash', '*.totp_secret_enc',
  'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-fresh-token"]',
  'res.headers["set-cookie"]',
];

export function createLogger(level = 'info', stream) {
  return pino(
    {
      level,
      base: { service: 'catalog' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    stream,
  );
}
