import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BODY_BYTES = 2_000_000;

// Fetch spec forbids a body on these statuses; passing a stream to
// `new Response()` with one of them throws synchronously. Conditional GETs
// hit 304 routinely, so we drop the body and resume the source stream to
// release the socket. (101, 103, 204, 205, 304 per
// https://fetch.spec.whatwg.org/#null-body-status)
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

const blockedIpv4Networks = new BlockList();
const blockedIpv6Networks = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Networks.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Networks.addSubnet(network, prefix, "ipv6");
}

const blockedHostnames = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

export class SafeFetchError extends Error {
  readonly code: string;
  readonly url: string;

  constructor(code: string, url: string, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    this.url = url;
  }
}

export interface SafeFetchInit extends RequestInit {
  timeoutMs?: number;
  maxRedirects?: number;
}

interface LookupAddress {
  address: string;
  family: 4 | 6;
}

interface SafeFetchTarget {
  url: URL;
  address: string;
  family: 4 | 6;
  servername: string | undefined;
}

type LookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;
type PinnedFetchFn = (target: SafeFetchTarget, init: RequestInit) => Promise<Response>;

let lookupHost: LookupFn = async (hostname, options) =>
  (await dnsLookup(hostname, options)) as LookupAddress[];
let pinnedFetch: PinnedFetchFn = fetchPinnedTarget;
const responseBodyTimeouts = new WeakMap<Response, number>();

export function _setLookupForTests(fn: LookupFn): void {
  lookupHost = fn;
}

export function _setPinnedFetchForTests(fn: PinnedFetchFn): void {
  pinnedFetch = fn;
}

export function _resetLookupForTests(): void {
  lookupHost = async (hostname, options) => (await dnsLookup(hostname, options)) as LookupAddress[];
}

export function _resetPinnedFetchForTests(): void {
  pinnedFetch = fetchPinnedTarget;
}

export async function safeFetch(input: string | URL, init: SafeFetchInit = {}): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    ...fetchInit
  } = init;
  let current = parseHttpUrl(input);
  let requestInit: RequestInit = { ...fetchInit };
  let previousOrigin = current.origin;

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const target = await resolveSafeTarget(current);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortListener = () => controller.abort();
    if (requestInit.signal) {
      if (requestInit.signal.aborted) controller.abort();
      else requestInit.signal.addEventListener("abort", abortListener, { once: true });
    }

    let response: Response;
    try {
      response = await pinnedFetch(target, {
        ...requestInit,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      requestInit.signal?.removeEventListener("abort", abortListener);
    }

    if (!isRedirect(response.status)) {
      responseBodyTimeouts.set(response, timeoutMs);
      return response;
    }

    if (redirects === maxRedirects) {
      throw new SafeFetchError(
        "too_many_redirects",
        current.toString(),
        `too many redirects while fetching ${current.toString()}`,
      );
    }

    const location = response.headers.get("location");
    if (!location) {
      responseBodyTimeouts.set(response, timeoutMs);
      return response;
    }

    const next = new URL(location, current);
    requestInit = rewriteRedirectRequest(response.status, requestInit, current.origin, next.origin);
    previousOrigin = current.origin;
    current = next;
    if (previousOrigin !== current.origin) {
      requestInit = stripSensitiveHeaders(requestInit);
    }
  }

  throw new SafeFetchError(
    "too_many_redirects",
    current.toString(),
    `too many redirects while fetching ${current.toString()}`,
  );
}

export async function safeReadText(
  response: Response,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<string> {
  const bytes = await readBodyBytes(
    response,
    maxBodyBytes,
    responseBodyTimeouts.get(response) ?? DEFAULT_TIMEOUT_MS,
  );
  return new TextDecoder().decode(bytes);
}

export async function safeReadJson<T>(
  response: Response,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<T> {
  return JSON.parse(await safeReadText(response, maxBodyBytes)) as T;
}

export async function safeFetchText(
  input: string | URL,
  init: SafeFetchInit = {},
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<{ response: Response; text: string }> {
  const response = await safeFetch(input, init);
  return { response, text: await safeReadText(response, maxBodyBytes) };
}

export async function safeFetchJson<T>(
  input: string | URL,
  init: SafeFetchInit = {},
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<{ response: Response; json: T }> {
  const response = await safeFetch(input, init);
  return { response, json: await safeReadJson<T>(response, maxBodyBytes) };
}

export function isUnsafeIpAddress(address: string, family?: number): boolean {
  const version = family ?? isIP(address);
  if (version === 4) return blockedIpv4Networks.check(address, "ipv4");
  if (version === 6) return blockedIpv6Networks.check(stripIpv6Brackets(address), "ipv6");
  return true;
}

function parseHttpUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    throw new SafeFetchError("invalid_url", String(input), `invalid URL: ${String(input)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError(
      "blocked_protocol",
      url.toString(),
      `blocked outbound protocol: ${url.protocol}`,
    );
  }
  return url;
}

async function resolveSafeTarget(url: URL): Promise<SafeFetchTarget> {
  parseHttpUrl(url);

  const hostname = normalizedHostname(url);
  if (blockedHostnames.has(hostname) || hostname.endsWith(".localhost")) {
    throw new SafeFetchError(
      "blocked_hostname",
      url.toString(),
      `blocked outbound hostname: ${hostname}`,
    );
  }

  const version = isIP(hostname);
  if (version === 4 || version === 6) {
    if (isUnsafeIpAddress(hostname, version)) {
      throw new SafeFetchError("blocked_ip", url.toString(), `blocked outbound IP: ${hostname}`);
    }
    return {
      url,
      address: hostname,
      family: version,
      servername: undefined,
    };
  }

  let records: LookupAddress[];
  try {
    records = await lookupHost(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new SafeFetchError(
      "dns_failed",
      url.toString(),
      err instanceof Error ? err.message : String(err),
    );
  }

  if (records.length === 0) {
    throw new SafeFetchError("dns_empty", url.toString(), `no DNS records for ${hostname}`);
  }

  for (const record of records) {
    if (record.family !== 4 && record.family !== 6) {
      throw new SafeFetchError(
        "blocked_ip",
        url.toString(),
        `unsupported address family for ${hostname}`,
      );
    }
    if (isUnsafeIpAddress(record.address, record.family)) {
      throw new SafeFetchError(
        "blocked_ip",
        url.toString(),
        `blocked outbound IP for ${hostname}: ${record.address}`,
      );
    }
  }

  return {
    url,
    address: records[0]!.address,
    family: records[0]!.family,
    servername: hostname,
  };
}

function normalizedHostname(url: URL): string {
  return stripIpv6Brackets(url.hostname).toLowerCase().replace(/\.$/, "");
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function rewriteRedirectRequest(
  status: number,
  init: RequestInit,
  fromOrigin: string,
  toOrigin: string,
): RequestInit {
  const method = String(init.method ?? "GET").toUpperCase();
  if (status !== 303 && !((status === 301 || status === 302) && method === "POST")) {
    return fromOrigin === toOrigin ? init : stripSensitiveHeaders(init);
  }

  const headers = new Headers(init.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  const nextInit = stripSensitiveHeadersIfCrossOrigin(init, fromOrigin, toOrigin);
  for (const name of ["authorization", "cookie", "proxy-authorization"]) {
    if (!new Headers(nextInit.headers).has(name)) headers.delete(name);
  }
  return {
    ...nextInit,
    method: "GET",
    body: undefined,
    headers,
  };
}

function stripSensitiveHeadersIfCrossOrigin(
  init: RequestInit,
  fromOrigin: string,
  toOrigin: string,
): RequestInit {
  return fromOrigin === toOrigin ? init : stripSensitiveHeaders(init);
}

function stripSensitiveHeaders(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("proxy-authorization");
  return { ...init, headers };
}

/**
 * Build a whatwg `Response` from a Node `IncomingMessage`. Exported under the
 * `_` prefix for tests because the surrounding `fetchPinnedTarget` does real
 * sockets and can't be unit-tested directly.
 */
export function _responseFromNodeIncoming(
  res: Pick<http.IncomingMessage, "statusCode" | "statusMessage" | "headers"> &
    NodeJS.ReadableStream,
): Response {
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) responseHeaders.append(name, item);
    } else if (value !== undefined) {
      responseHeaders.set(name, value);
    }
  }
  const status = res.statusCode ?? 0;
  const nullBody = NULL_BODY_STATUSES.has(status);
  if (nullBody) res.resume();
  return new Response(
    nullBody ? null : (Readable.toWeb(res as unknown as Readable) as ReadableStream<Uint8Array>),
    {
      status,
      statusText: res.statusMessage,
      headers: responseHeaders,
    },
  );
}

async function fetchPinnedTarget(target: SafeFetchTarget, init: RequestInit): Promise<Response> {
  const body = await requestBodyToBuffer(init.body);
  return new Promise<Response>((resolve, reject) => {
    const headers = new Headers(init.headers);
    headers.delete("host");
    headers.set("host", target.url.host);
    if (body && !headers.has("content-length")) {
      headers.set("content-length", String(body.byteLength));
    }

    const request = (target.url.protocol === "https:" ? https : http).request(
      {
        protocol: target.url.protocol,
        hostname: target.address,
        family: target.family,
        port: target.url.port || (target.url.protocol === "https:" ? 443 : 80),
        path: `${target.url.pathname}${target.url.search}`,
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers.entries()),
        servername: target.url.protocol === "https:" ? target.servername : undefined,
      },
      (res) => resolve(_responseFromNodeIncoming(res)),
    );

    const abort = () => {
      request.destroy(new SafeFetchError("aborted", target.url.toString(), "request aborted"));
    };
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    request.on("error", reject);
    request.on("close", () => init.signal?.removeEventListener("abort", abort));
    if (body) request.write(body);
    request.end();
  });
}

async function requestBodyToBuffer(body: BodyInit | null | undefined): Promise<Buffer | null> {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  throw new SafeFetchError("unsupported_body", "request", "unsupported request body type");
}

async function readBodyBytes(
  response: Response,
  maxBodyBytes: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = await withBodyTimeout(response.arrayBuffer(), response, timeoutMs);
    if (buffer.byteLength > maxBodyBytes) {
      throw new SafeFetchError(
        "body_too_large",
        response.url || "response",
        `response body exceeded ${maxBodyBytes} bytes`,
      );
    }
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(bodyTimeoutError(response, timeoutMs));
      void reader.cancel().catch(() => undefined);
    }, timeoutMs);
  });

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeoutPromise]);
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        throw new SafeFetchError(
          "body_too_large",
          response.url || "response",
          `response body exceeded ${maxBodyBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function withBodyTimeout<T>(
  promise: Promise<T>,
  response: Response,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(bodyTimeoutError(response, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function bodyTimeoutError(response: Response, timeoutMs: number): SafeFetchError {
  return new SafeFetchError(
    "aborted",
    response.url || "response",
    `response body timed out after ${timeoutMs}ms`,
  );
}
