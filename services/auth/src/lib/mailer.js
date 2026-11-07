import nodemailer from 'nodemailer';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(title, intro, link, cta, outro) {
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#F5EFE6;font-family:Arial,sans-serif;color:#2B2420">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;font-size:22px;margin:0 0 24px">Maison Argile</p>
<h1 style="font-family:Georgia,serif;font-size:26px;font-weight:normal;margin:0 0 16px">${esc(title)}</h1>
<p style="line-height:1.6">${esc(intro)}</p>
${link ? `<p style="margin:28px 0"><a href="${esc(link)}" style="background:#B5532F;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;display:inline-block">${esc(cta)}</a></p>
<p style="font-size:13px;color:#6B5D52;word-break:break-all">${esc(link)}</p>` : ''}
<p style="line-height:1.6;color:#6B5D52;font-size:14px">${esc(outro)}</p></div></body></html>`;
  const text = `${title}\n\n${intro}\n\n${link ? `${link}\n\n` : ''}${outro}`;
  return { html, text };
}

export function createMailer(cfg, transport) {
  const t = transport ?? nodemailer.createTransport({ host: cfg.SMTP_HOST, port: cfg.SMTP_PORT, secure: false, ignoreTLS: true });
  const send = (to, subject, content) => t.sendMail({ from: cfg.MAIL_FROM, to, subject, ...content });
  const url = (p, token) => `${cfg.APP_ORIGIN}${p}?token=${encodeURIComponent(token)}`;

  return {
    sendVerification: (to, token) =>
      send(to, 'Confirmez votre adresse e-mail', layout(
        'Bienvenue chez Maison Argile',
        'Confirmez votre adresse e-mail pour pouvoir passer commande. Ce lien est valable 24 heures et ne peut être utilisé qu’une fois.',
        url('/verifier-email', token), 'Confirmer mon adresse',
        'Si vous n’êtes pas à l’origine de cette inscription, ignorez simplement ce message.')),
    sendAlreadyRegistered: (to) =>
      send(to, 'Vous avez déjà un compte', layout(
        'Vous avez déjà un compte',
        'Une inscription a été demandée avec cette adresse, mais un compte existe déjà. Vous pouvez vous connecter ou réinitialiser votre mot de passe.',
        `${cfg.APP_ORIGIN}/connexion`, 'Me connecter',
        'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.')),
    sendPasswordReset: (to, token) =>
      send(to, 'Réinitialisation de votre mot de passe', layout(
        'Réinitialiser votre mot de passe',
        'Utilisez ce lien pour choisir un nouveau mot de passe. Il est valable 30 minutes et ne peut servir qu’une fois.',
        url('/reinitialiser-mot-de-passe', token), 'Choisir un nouveau mot de passe',
        'Si vous n’avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.')),
    sendEmailChange: (to, token) =>
      send(to, 'Confirmez votre nouvelle adresse e-mail', layout(
        'Confirmer votre nouvelle adresse',
        'Cliquez pour confirmer que cette adresse remplacera l’ancienne sur votre compte. Ce lien est valable 24 heures.',
        url('/verifier-email', token), 'Confirmer la nouvelle adresse',
        'Si vous n’avez pas demandé ce changement, ignorez ce message.')),
    sendSecurityNotice: (to, subject, body) =>
      send(to, subject, layout(subject, body, null, null, 'Si ce n’était pas vous, changez immédiatement votre mot de passe.')),
    verify: () => t.verify(),
  };
}
