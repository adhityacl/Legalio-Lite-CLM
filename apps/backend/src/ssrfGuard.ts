/**
 * SSRF protection for outbound requests to addresses an administrator typed in (webhooks).
 *
 * - Hostnames are resolved by us and EVERY resolved address must be public; the connection is then pinned to the checked addresses
 *   (no second lookup between check and connect, so DNS rebinding cannot swap them).
 * - Literal IP hosts are checked the same way (decimal/octal/hex IPv4 spellings are normalized by the URL parser first).
 * - Redirects are never followed: the response is whatever the first answer is (a 3xx counts as a failed delivery).
 * - Connect + response time and the response size are capped; the request body is capped by the caller.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export class SsrfError extends Error {
  constructor(readonly code: 'URL_INVALID' | 'SCHEME_NOT_ALLOWED' | 'HOST_BLOCKED' | 'ADDRESS_BLOCKED' | 'DNS_FAILED', message: string) { super(message); }
}

export interface OutboundPolicy {
  /** Allow `http:` (development only). */
  allowHttp: boolean;
  /** Allow private, loopback and link-local addresses (development and tests only). */
  allowPrivateNetworks: boolean;
}
export const outboundPolicyFromEnv = (env: NodeJS.ProcessEnv = process.env): OutboundPolicy => ({
  allowHttp: env.WEBHOOK_ALLOW_HTTP === 'true',
  allowPrivateNetworks: env.WEBHOOK_ALLOW_PRIVATE_NETWORKS === 'true',
});

/* ------------------------------ address classification ------------------------------ */

const v4ToInt = (ip: string): number => ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
const inV4 = (value: number, base: string, bits: number) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((value & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
};
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
export const isBlockedIPv4 = (ip: string) => { const value = v4ToInt(ip); return BLOCKED_V4.some(([base, bits]) => inV4(value, base, bits)); };

/** 16 bytes of an IPv6 address (handles `::` and a trailing dotted IPv4). */
function parseIPv6(ip: string): number[] | null {
  let text = ip.split('%')[0].toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    if (!net.isIPv4(dotted[1])) return null;
    const value = v4ToInt(dotted[1]);
    text = text.slice(0, -dotted[1].length) + ((value >>> 16) & 0xffff).toString(16) + ':' + (value & 0xffff).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}
const embeddedV4 = (bytes: number[], from: number) => `${bytes[from]}.${bytes[from + 1]}.${bytes[from + 2]}.${bytes[from + 3]}`;

export function isBlockedIPv6(ip: string): boolean {
  const bytes = parseIPv6(ip);
  if (!bytes) return true; // unparseable: never connect
  if (bytes.every((b) => b === 0)) return true; // ::
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true; // ::1
  const first = bytes[0];
  if ((first & 0xfe) === 0xfc) return true; // fc00::/7 unique local (includes the AWS IPv6 metadata address)
  if (first === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (first === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local (deprecated)
  if (first === 0xff) return true; // multicast
  if (first === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32 documentation
  // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), 64:ff9b::/96 (NAT64) and 2002::/16 (6to4) carry an IPv4 address.
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) return isBlockedIPv4(embeddedV4(bytes, 12));
  if (bytes.slice(0, 12).every((b) => b === 0)) return isBlockedIPv4(embeddedV4(bytes, 12));
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((b) => b === 0)) return isBlockedIPv4(embeddedV4(bytes, 12));
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isBlockedIPv4(embeddedV4(bytes, 2));
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true;
}

const BLOCKED_NAME = /(^|\.)(localhost|local|internal|localdomain|home|corp|lan|intranet)$|^(metadata|instance-data|kubernetes|kubernetes\.default)$/i;

/** Validates the URL an administrator entered (scheme, credentials, obviously internal names or literal addresses). No network access. */
export function parseOutboundUrl(input: unknown, policy: OutboundPolicy): URL {
  if (typeof input !== 'string' || !input.trim() || input.length > 2000) throw new SsrfError('URL_INVALID', 'Enter a URL of at most 2000 characters.');
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new SsrfError('URL_INVALID', 'The URL is not valid.'); }
  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) {
    throw new SsrfError('SCHEME_NOT_ALLOWED', policy.allowHttp ? 'Only http and https URLs are allowed.' : 'Only https URLs are allowed.');
  }
  if (url.username || url.password) throw new SsrfError('URL_INVALID', 'The URL must not contain credentials.');
  if (url.hash) throw new SsrfError('URL_INVALID', 'The URL must not contain a fragment.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new SsrfError('URL_INVALID', 'The URL has no host.');
  if (!policy.allowPrivateNetworks) {
    if (net.isIP(host)) {
      if (isBlockedAddress(host)) throw new SsrfError('HOST_BLOCKED', 'The URL points to a private, loopback or link-local address.');
    } else if (BLOCKED_NAME.test(host)) {
      throw new SsrfError('HOST_BLOCKED', 'The URL points to an internal host name.');
    }
  }
  return url;
}

/** Resolves the host and requires every address to be public (unless private networks are allowed). */
export async function resolvePublicAddresses(host: string, policy: OutboundPolicy, lookup: typeof dns.promises.lookup = dns.promises.lookup): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const bare = host.replace(/^\[|\]$/g, '');
  let addresses: Array<{ address: string; family: number }>;
  if (net.isIP(bare)) addresses = [{ address: bare, family: net.isIP(bare) }];
  else {
    try { addresses = await lookup(bare, { all: true, verbatim: true }) as Array<{ address: string; family: number }>; }
    catch { throw new SsrfError('DNS_FAILED', 'The host name could not be resolved.'); }
  }
  if (!addresses.length) throw new SsrfError('DNS_FAILED', 'The host name did not resolve to an address.');
  if (!policy.allowPrivateNetworks && addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new SsrfError('ADDRESS_BLOCKED', 'The host name resolves to a private, loopback or link-local address.');
  }
  return addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
}

/* ------------------------------ pinned request ------------------------------ */

export interface OutboundResult { statusCode: number; headers: http.IncomingHttpHeaders; body: string; truncated: boolean; durationMs: number }
export interface OutboundOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxResponseBytes?: number;
  policy?: OutboundPolicy;
  /** Tests inject a resolver. */
  lookup?: typeof dns.promises.lookup;
}

/** One request, no redirects, to the validated addresses only. Throws SsrfError (blocked) or a plain Error (network, timeout). */
export async function outboundRequest(rawUrl: string, options: OutboundOptions = {}): Promise<OutboundResult> {
  const policy = options.policy ?? outboundPolicyFromEnv();
  const url = parseOutboundUrl(rawUrl, policy);
  const addresses = await resolvePublicAddresses(url.hostname, policy, options.lookup);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxResponseBytes ?? 64 * 1024;
  const started = Date.now();
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise<OutboundResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(deadline); fn(); } };
    const request = transport.request({
      protocol: url.protocol, hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || undefined, path: `${url.pathname}${url.search}`,
      method: options.method ?? 'POST', headers: { ...options.headers, ...(options.body !== undefined ? { 'content-length': String(Buffer.byteLength(options.body)) } : {}) },
      agent: false,
      // Pinned: the socket connects to an address we already checked, whatever the resolver would say now.
      lookup: ((_hostname: string, lookupOptions: any, callback: any) => {
        if (lookupOptions?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      }) as any,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      response.on('data', (chunk: Buffer) => {
        if (size + chunk.length > maxBytes) {
          truncated = true;
          chunks.push(chunk.subarray(0, Math.max(0, maxBytes - size)));
          size = maxBytes;
          response.destroy();
          return;
        }
        size += chunk.length;
        chunks.push(chunk);
      });
      const done = () => finish(() => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8'), truncated, durationMs: Date.now() - started }));
      response.on('end', done);
      response.on('close', done);
      response.on('error', (err) => { if (truncated) done(); else finish(() => reject(err)); });
    });
    const deadline = setTimeout(() => { request.destroy(new Error(`Timed out after ${timeoutMs} ms.`)); }, timeoutMs);
    request.on('error', (err) => finish(() => reject(err)));
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}
