/**
 * Email delivery. With RESEND_API_KEY and MAIL_FROM set, mail goes out through Resend's HTTP API.
 * Without them (local development) the message is printed to the server console instead,
 * so the password-reset link can be copied from the terminal.
 */
export function createMailer(config) {
  const sent = [];
  return {
    sent, // kept in memory for tests only
    async send({ to, subject, body }) {
      if (config.resendApiKey && config.mailFrom) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: config.mailFrom, to, subject, text: body }),
        });
        if (!res.ok) throw new Error(`Email provider answered ${res.status}`);
        return;
      }
      if (config.production) {
        console.error(`[mail] Not sent to ${to}: no email provider is configured (set RESEND_API_KEY and MAIL_FROM).`);
        return;
      }
      sent.push({ to, subject, body });
      if (sent.length > 20) sent.shift();
      if (!config.quiet) console.log(`\n[mail — development only, not actually sent]\nTo: ${to}\nSubject: ${subject}\n\n${body}\n`);
    },
  };
}
