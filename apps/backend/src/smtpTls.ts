/**
 * TLS options for the SMTP relay. Certificates are verified unless the operator explicitly opts out for a relay with a
 * self-signed certificate: SMTP_ALLOW_SELF_SIGNED=true, or `smtpAllowSelfSigned: true` in the saved provider settings.
 */
export function smtpTlsOptions(settings: { smtpAllowSelfSigned?: unknown } | null | undefined, env: NodeJS.ProcessEnv = process.env) {
  const flag = (value: unknown) => value === true || String(value ?? '').trim().toLowerCase() === 'true';
  return flag(env.SMTP_ALLOW_SELF_SIGNED) || flag(settings?.smtpAllowSelfSigned) ? { rejectUnauthorized: false } : { rejectUnauthorized: true };
}
