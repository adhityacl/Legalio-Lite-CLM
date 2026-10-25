# Single sign-on (OpenID Connect)

Each organization can connect **one** OpenID Connect provider (Okta, Microsoft Entra ID, Google Workspace, Keycloak, Auth0, Authentik ...).
Organization administrators configure it in **Settings > Data & automation > Single sign-on**
(`GET/PUT/DELETE /api/organizations/:id/sso`, permission `tenant.sso.manage`, audited as `sso.configure` / `sso.delete`).

## Set-up

1. Register Legalio at the provider as a **confidential web client** with the **authorization-code flow**.
   Redirect URI (shown in the panel): `https://<your-legalio-host>/api/sso/callback`. The host is the public URL configured at first run
   (`BETTER_AUTH_URL` overrides it); the callback is never taken from request parameters.
2. Enter the **issuer URL** (Legalio reads `<issuer>/.well-known/openid-configuration`), client id, client secret and scopes
   (`openid email profile`; add the scope that releases your group claim if you map roles).
3. List the **allowed e-mail domains**. Only an e-mail address whose domain is on this list can sign in through SSO, for every user.
4. Decide how people get in (below), save, press **Test connection**, and give members the sign-in link `https://<host>/sso/<organization-slug>`.

The client secret is sealed at rest (AES-256-GCM, same key handling as the other integration credentials) and is never returned by the API.

## Sign-in flow

`GET /api/sso/<slug>/start` creates a single-use login state (10 minutes: `state`, `nonce`, PKCE `code_verifier`, the hash of a
browser-binding cookie) and redirects to the provider's authorization endpoint with `response_type=code`, `code_challenge_method=S256`,
`state`, `nonce` and the exact redirect URI. `GET /api/sso/callback` then:

* consumes the state exactly once and requires the **binding cookie** set by `start` (an attacker cannot make a victim's browser finish a flow the attacker started),
* exchanges the code at the token endpoint (client_secret_basic, or client_secret_post if that is all the provider offers) with the PKCE verifier,
* verifies the **ID token**: asymmetric signature from the provider's JWKS (RS/PS/ES 256-512; `none` and HMAC are refused; the algorithm must be one the
  discovery document advertises; JWKS cached 10 minutes and refreshed once, at most every 30 s, for an unknown `kid`), `iss` equal to the configured issuer,
  `aud` containing the client id (`azp` must match when there are several audiences), `exp`/`nbf`/`iat` (2 minute skew), `nonce`,
* requires `email` and **`email_verified: true`**, and an allowed domain,
* matches or provisions the user (below), then creates a normal **Better Auth session** (`internalAdapter.createSession`, so session hooks such as the
  ban check apply) and sets Better Auth's own *signed* `better-auth.session_token` cookie (HttpOnly, SameSite=Lax, `Secure` over https).

Failures redirect to `/?sso_error=<CODE>` with a stable code (shown translated on the sign-in page) and are audited as `sso.login_denied`.
Success is audited as `sso.login`, `sso.link` (first login of an existing member) or `sso.provision`.

## Who is let in (account-takeover rules)

1. A linked `(issuer, subject)` pair always resolves to its user (so an e-mail change at the provider does not create a second account), who must still be an **active member**.
2. Otherwise an **existing local account is linked only if it is already an active member of this organization**. A local account that merely has the same e-mail
   but is not a member (for example one registered by someone who does not control the mailbox) is **never** linked or taken over: the login is refused (`SSO_ACCOUNT_NOT_LINKED`).
3. A new e-mail address becomes a new user only
   * through a **pending invitation** to this organization (the invited role and departments apply; the invitation is marked accepted), or
   * when **just-in-time provisioning** is on: limited to the allowed domains; the role and departments come from the claim mapping (highest matching role wins) or
     the configured default role (never `admin` by default; a non-admin needs at least one department, as everywhere in Legalio).
   With both unavailable the login is refused (`SSO_NOT_PROVISIONED`). Open first-run setup is unaffected; SSO never creates platform superusers.
4. Optionally **sync roles** re-applies the mapping at every login (never demotes the last active administrator).

Residual risk to know about: an existing member whose local password was set by someone else before the person was invited keeps that password. Turn on
"SSO required" to remove password access for members.

## Provider lookup on the sign-in page

`GET /api/sso/lookup?email=...` or `?slug=...` returns at most five `{ slug, name }` of organizations **with SSO enabled** that list the e-mail's domain (or have the slug).
Unknown organizations and organizations without SSO return the same empty list, so the endpoint does not reveal that an organization exists beyond its public
sign-in link. The sign-in page shows **Continue with SSO** when a match exists; `/sso/<slug>` shows the organization's own sign-in card.

## SSO required and break-glass administrators

With **Require SSO** on, members of the organization can no longer start a password session; Better Auth answers `403 SSO_REQUIRED`.
Exceptions: platform superusers, and the organization's **break-glass administrators** (1-5 explicitly chosen active admins, required to turn the option on; the
exemption lasts only while the person is still an active administrator). The rule applies if the user is a member of *any* organization that requires SSO.
Sessions that already exist when the option is switched on are not revoked; revoke them in the platform console if needed.

## Operations and limits

* Discovery, JWKS and token requests use the webhook **SSRF guard**: https only, no credentials in the URL, every resolved address must be public, connections are pinned
  to the checked addresses, nothing is redirected, responses are capped (512 KiB) and time out after 8 s. `WEBHOOK_ALLOW_HTTP=true` and
  `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` relax this for development and tests only.
* `/api/sso/*` public routes are rate limited per client address (60 requests per minute) unless `RATE_LIMIT_DISABLED=true`.
* Group claims are read from the ID token only (not the userinfo endpoint). Configure the provider to release groups in the ID token.
* Tables: `sso_providers`, `sso_identities`, `sso_login_states` (migration `0026_sso`). Expired login states are deleted whenever a new login starts.
* Local manual check without a real provider: `node --import tsx apps/backend/src/mockOidcProvider.ts` starts a mock provider (it auto-approves `/authorize`).
