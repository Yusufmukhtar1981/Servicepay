"use strict";

const net = require("node:net");

const TELECOM_ABODE_SOURCE_IP = "49.12.92.4";

const IDENTITY_HEADERS = [
  "x-forwarded-for",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "cf-connecting-ipv6",
];

const parseIp = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    return null;
  }

  const family = net.isIP(value);
  if (family === 4) {
    const octets = value.split(".").map(Number);
    return {
      family: 4,
      value: octets.reduce((result, octet) => (result << 8n) | BigInt(octet), 0n),
      mappedIpv4: false,
    };
  }
  if (family !== 6 || value.includes("%")) return null;

  let ipv6 = value.toLowerCase();
  if (ipv6.includes(".")) {
    const lastColon = ipv6.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = parseIp(ipv6.slice(lastColon + 1));
    if (!ipv4 || ipv4.family !== 4) return null;
    const highWord = Number((ipv4.value >> 16n) & 0xffffn).toString(16);
    const lowWord = Number(ipv4.value & 0xffffn).toString(16);
    ipv6 = `${ipv6.slice(0, lastColon + 1)}${highWord}:${lowWord}`;
  }

  const compressedParts = ipv6.split("::");
  if (compressedParts.length > 2) return null;
  const left = compressedParts[0] ? compressedParts[0].split(":") : [];
  const right = compressedParts.length === 2 && compressedParts[1]
    ? compressedParts[1].split(":")
    : [];
  const words = compressedParts.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) {
    return null;
  }

  const parsed = words.reduce(
    (result, word) => (result << 16n) | BigInt(`0x${word}`),
    0n,
  );
  const mappedIpv4 = (parsed >> 32n) === 0xffffn;
  return { family: 6, value: parsed, mappedIpv4 };
};

const formatIpv6 = (value) => {
  const words = [];
  for (let index = 7; index >= 0; index -= 1) {
    words.push(Number((value >> BigInt(index * 16)) & 0xffffn));
  }

  let bestStart = -1;
  let bestLength = 1;
  for (let index = 0; index < words.length;) {
    if (words[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < words.length && words[end] === 0) end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }

  if (bestStart < 0) return words.map((word) => word.toString(16)).join(":");
  const before = words.slice(0, bestStart).map((word) => word.toString(16)).join(":");
  const after = words
    .slice(bestStart + bestLength)
    .map((word) => word.toString(16))
    .join(":");
  return `${before}::${after}`;
};

const normalizeParsedIp = (parsed) => {
  if (parsed.family === 4) {
    return [24n, 16n, 8n, 0n]
      .map((shift) => Number((parsed.value >> shift) & 0xffn))
      .join(".");
  }
  if (parsed.mappedIpv4) {
    return normalizeParsedIp({
      family: 4,
      value: parsed.value & 0xffffffffn,
    });
  }
  return formatIpv6(parsed.value);
};

const normalizeIp = (value) => {
  const parsed = parseIp(value);
  return parsed ? normalizeParsedIp(parsed) : null;
};

const parseCidr = (value) => {
  if (typeof value !== "string" || value.trim() !== value) return null;
  const parts = value.split("/");
  if (parts.length > 2) return null;
  const address = parseIp(parts[0]);
  if (!address) return null;

  const bitCount = address.family === 4 ? 32 : 128;
  const prefix = parts.length === 1
    ? bitCount
    : (/^(0|[1-9]\d*)$/.test(parts[1]) ? Number(parts[1]) : NaN);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bitCount) return null;
  return { ...address, prefix };
};

const inCidr = (address, cidr) => {
  let value = address.value;
  let family = address.family;

  if (family === 6 && address.mappedIpv4 && cidr.family === 4) {
    family = 4;
    value &= 0xffffffffn;
  } else if (family === 4 && cidr.family === 6) {
    family = 6;
    value = (0xffffn << 32n) | value;
  }
  if (family !== cidr.family) return false;

  const bits = family === 4 ? 32 : 128;
  const shift = BigInt(bits - cidr.prefix);
  return (value >> shift) === (cidr.value >> shift);
};

const readSingleHeader = (req, name) => {
  const normalizedName = name.toLowerCase();
  const headers = req && req.headers;
  const headerValue = headers && Object.prototype.hasOwnProperty.call(headers, normalizedName)
    ? headers[normalizedName]
    : undefined;
  const rawHeaders = req && req.rawHeaders;

  if (Array.isArray(rawHeaders)) {
    if (rawHeaders.length % 2 !== 0) return { valid: false, present: false };
    const values = [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (typeof rawHeaders[index] !== "string") {
        return { valid: false, present: false };
      }
      if (rawHeaders[index].toLowerCase() === normalizedName) {
        values.push(rawHeaders[index + 1]);
      }
    }
    if (values.length > 1) return { valid: false, present: true };
    if (values.length === 0) {
      return {
        valid: headerValue === undefined,
        present: false,
      };
    }
    if (typeof values[0] !== "string") return { valid: false, present: true };
    if (headerValue !== undefined && headerValue !== values[0]) {
      return { valid: false, present: true };
    }
    return { valid: true, present: true, value: values[0] };
  }

  if (headerValue === undefined) return { valid: true, present: false };
  if (typeof headerValue !== "string") return { valid: false, present: true };
  return { valid: true, present: true, value: headerValue };
};

const parseForwardedFor = (value) => {
  if (typeof value !== "string") return null;
  const tokens = value.split(",");
  if (tokens.length === 0) return null;
  const addresses = [];
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) return null;
    const address = parseIp(trimmed);
    if (!address) return null;
    addresses.push(address);
  }
  return addresses;
};

const verifyTelecomAbodeSource = (req, options = {}) => {
  try {
    const { trustedProxyCidrs = [] } = options || {};
    if (!Array.isArray(trustedProxyCidrs)) return false;
    const trustedCidrs = trustedProxyCidrs.map(parseCidr);
    if (trustedCidrs.some((cidr) => cidr === null)) return false;

    const peer = parseIp(req && req.socket && req.socket.remoteAddress);
    if (!peer) return false;
    const peerIsTrustedProxy = trustedCidrs.some((cidr) => inCidr(peer, cidr));
    const headers = Object.fromEntries(
      IDENTITY_HEADERS.map((name) => [name, readSingleHeader(req, name)]),
    );
    if (Object.values(headers).some((header) => !header.valid)) return false;

    let source = peer;
    if (!peerIsTrustedProxy) {
      // Forwarding metadata from a peer outside the explicitly trusted proxy
      // CIDRs is never source-IP evidence (even if it names the provider).
      if (Object.values(headers).some((header) => header.present)) return false;
    } else {
      // Two independently interpreted forwarding chains are ambiguous.
      if (
        headers.forwarded.present ||
        !headers["x-forwarded-for"].present ||
        !headers["cf-connecting-ip"].present
      ) {
        return false;
      }
      const chain = parseForwardedFor(headers["x-forwarded-for"].value);
      if (!chain) return false;

      let sourceIndex = -1;
      for (let index = chain.length - 1; index >= 0; index -= 1) {
        if (trustedCidrs.some((cidr) => inCidr(chain[index], cidr))) continue;
        source = chain[index];
        sourceIndex = index;
        break;
      }
      // Any values to the left of the first untrusted hop are unverified
      // caller-supplied prefixes. Reject rather than risk accepting a spoof.
      if (sourceIndex !== 0) return false;
    }

    const normalizedSource = normalizeParsedIp(source);
    if (normalizedSource !== TELECOM_ABODE_SOURCE_IP) return false;

    // On the trusted-proxy path, CF-Connecting-IP is required and must
    // corroborate the XFF-derived source. Other single-address identity
    // headers are optional corroboration only; none may select the source.
    // Reject disagreements rather than choosing between competing claims.
    for (const name of [
      "x-real-ip",
      "cf-connecting-ip",
      "true-client-ip",
      "cf-connecting-ipv6",
    ]) {
      const header = headers[name];
      if (!header.present) continue;
      const candidate = normalizeIp(header.value.trim());
      if (!candidate || candidate !== normalizedSource) return false;
    }

    return true;
  } catch {
    // This helper intentionally exposes only an allow/deny decision.
    return false;
  }
};

module.exports = {
  normalizeIp,
  verifyTelecomAbodeSource,
};