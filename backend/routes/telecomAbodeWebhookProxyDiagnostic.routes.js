"use strict";

const express = require("express");
const {
  protect,
  adminOnly,
} = require("../middleware/auth.middleware");
const { loadStaffRole } = require("../middleware/staffPermission.middleware");
const { normalizeIp } = require("../services/telecomAbodeWebhookSource.service");

// Temporary read-only diagnostic. It is not mounted by this module; the
// owning application must explicitly mount it and remove it after observation.
const DIAGNOSTIC_EXPIRES_AT = Date.parse("2026-10-04T00:00:00.000Z");
const MAX_HEADER_FIELDS = 4;
const MAX_HEADER_VALUE_LENGTH = 256;
const MAX_HEADER_TOTAL_LENGTH = 768;

const boundedHeaderValues = (req, name, maxFields = MAX_HEADER_FIELDS) => {
  const normalizedName = name.toLowerCase();
  const values = [];
  let totalLength = 0;
  let truncated = false;
  const rawHeaders = req.rawHeaders;

  if (Array.isArray(rawHeaders)) {
    for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
      if (
        typeof rawHeaders[index] !== "string" ||
        rawHeaders[index].toLowerCase() !== normalizedName
      ) {
        continue;
      }
      if (values.length >= maxFields || typeof rawHeaders[index + 1] !== "string") {
        truncated = true;
        continue;
      }

      const remaining = MAX_HEADER_TOTAL_LENGTH - totalLength;
      if (remaining <= 0) {
        truncated = true;
        continue;
      }
      const value = rawHeaders[index + 1];
      const boundedValue = value.slice(
        0,
        Math.min(MAX_HEADER_VALUE_LENGTH, remaining),
      );
      values.push(boundedValue);
      totalLength += boundedValue.length;
      if (boundedValue.length !== value.length) truncated = true;
    }
  } else {
    const value = req.headers && req.headers[normalizedName];
    if (typeof value === "string") {
      const boundedValue = value.slice(
        0,
        Math.min(MAX_HEADER_VALUE_LENGTH, MAX_HEADER_TOTAL_LENGTH),
      );
      values.push(boundedValue);
      truncated = boundedValue.length !== value.length;
    } else if (value !== undefined) {
      truncated = true;
    }
  }

  return { values, truncated };
};

const createTelecomAbodeWebhookProxyDiagnosticRouter = ({
  expiresAt = DIAGNOSTIC_EXPIRES_AT,
} = {}) => {
  if (!Number.isFinite(expiresAt)) {
    throw new TypeError("A finite diagnostic expiration time is required.");
  }

  const router = express.Router();
  router.get(
    "/",
    (req, res, next) => {
      if (Date.now() >= expiresAt) {
        return res.status(404).json({ success: false, message: "Not found." });
      }
      return next();
    },
    protect,
    adminOnly("HEAD_OFFICE"),
    loadStaffRole,
    (req, res) => {
      const socketPeer = normalizeIp(req.socket && req.socket.remoteAddress);
      return res.status(200).json({
        success: true,
        diagnosticExpiresAt: new Date(expiresAt).toISOString(),
        observed: {
          socketPeer,
          xForwardedFor: boundedHeaderValues(req, "x-forwarded-for"),
          cfConnectingIp: boundedHeaderValues(req, "cf-connecting-ip", 2),
          host: boundedHeaderValues(req, "host", 2),
          cfRay: boundedHeaderValues(req, "cf-ray", 2),
        },
      });
    },
  );
  return router;
};

module.exports = createTelecomAbodeWebhookProxyDiagnosticRouter();
module.exports.createTelecomAbodeWebhookProxyDiagnosticRouter =
  createTelecomAbodeWebhookProxyDiagnosticRouter;
module.exports.DIAGNOSTIC_EXPIRES_AT = DIAGNOSTIC_EXPIRES_AT;