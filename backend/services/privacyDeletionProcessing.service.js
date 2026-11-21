"use strict";

const fail = (status, message) => Object.assign(new Error(message), { status, statusCode: status });
const evidenceText = (value, label) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 15 || text.length > 1500) throw fail(400, `${label} must contain 15–1500 characters.`);
  return text;
};
const PERSONAL_FIELDS = Object.freeze([
  "address", "residentialAddress", "gender", "dateOfBirth",
  "registrationState", "registrationLga", "nin", "ninNumberMasked",
  "profilePhotoUrl", "profilePhotoPublicId", "customerDashboardSettings",
  "password", "transactionPin", "passwordResetToken", "passwordResetExpires",
  "accountRecoveryState", "accountRecoveryRate", "profileContactChallenge",
  "profileContactRate", "profileContactProposal", "profileContactProposalRate",
]);

function validateCompletionEvidence(body, referenceId, now = new Date()) {
  const input = body.completionEvidence || {};
  if (input.confirmation !== `DELETE ${referenceId}` ||
      input.otherSystemsReviewed !== true || input.processorsReviewed !== true ||
      input.financialObligationsReviewed !== true) {
    throw fail(400, "Confirm irreversible deletion and complete the associated-data and processor reviews.");
  }
  const reviewBy = new Date(input.retentionReviewBy);
  if (!Number.isFinite(+reviewBy) || +reviewBy <= +now) {
    throw fail(400, "Provide the next retention review date from the applicable approved policy.");
  }
  return {
    mode: "HEAD_OFFICE_REVIEWED",
    // These are explicit staff attestations, NOT provider/API-verified claims.
    associatedDataReviewReference: evidenceText(input.associatedDataReviewReference, "Associated-data erasure evidence"),
    processorRequestsReference: evidenceText(input.processorRequestsReference, "Processor deletion/retention evidence"),
    retentionPolicyReference: evidenceText(input.retentionPolicyReference, "Applicable retention policy and legal basis"),
    retentionScope: evidenceText(input.retentionScope, "Retained-record categories and retention schedule"),
    retentionReviewBy: reviewBy,
    otherSystemsReviewed: true, processorsReviewed: true,
    financialObligationsReviewed: true,
  };
}

function assertVerifiedOwner(request) {
  const proof = request.ownershipVerification;
  const id = request.subjectUser?._id || request.subjectUser;
  if (!id || !proof?.verifiedAt || !Number.isFinite(+new Date(proof.verifiedAt)) ||
      !["EMAIL_OTP", "PASSWORD"].includes(proof.method) ||
      String(proof.subjectUser) !== String(id) || request.confirmationAccepted !== true) {
    throw fail(409, "The customer must securely verify ownership through the deletion form before approval or completion.");
  }
}

function assertNoUnsettledBalances(user, wallet) {
  const fields = typeof user.toObject === "function" ? user.toObject() : user;
  for (const [name, value] of Object.entries(fields)) {
    if (!/balance$/i.test(name) && name !== "walletHeldBalance") continue;
    if (value != null && (typeof value !== "number" || !Number.isFinite(value) || value !== 0)) {
      throw fail(409, "Outstanding balances must be resolved through the existing authorized wallet/support process before account deletion.");
    }
  }
  if (wallet && (typeof wallet.balance !== "number" || !Number.isFinite(wallet.balance) || wallet.balance !== 0)) {
    throw fail(409, "The linked wallet has an outstanding balance. No balance has been changed.");
  }
}

function userErasureUpdate(userId, actorId, timestamp) {
  const suffix = String(userId);
  return {
    $set: {
      fullName: "Deleted ServicePay Customer", phone: `DELETED_${suffix}`,
      email: `deleted-${suffix}@deleted.servicepay.ng`,
      status: "BLOCKED", isDeleted: true, deletedAt: timestamp, deletedBy: String(actorId),
      emailVerified: false, phoneVerified: false, transactionPinSet: false,
      profileRecoveryBlocked: { email: true, phone: true },
    },
    $inc: { authTokenVersion: 1 },
    $unset: Object.fromEntries(PERSONAL_FIELDS.map(field => [field, 1])),
  };
}

function createDeletionProcessor({
  users, wallets, cashbackEntries, transactions, beneficiaries, deviceSessions, requests, audits,
  startSession, reauthenticate, now = () => new Date(),
}) {
  async function complete({ requestId, actor, body, ipAddress = "", userAgent = "" }) {
    if (actor?.role !== "HEAD_OFFICE") throw fail(403, "Only an authorized Head Office administrator may complete deletion.");
    // Uses the established, rate-limited fresh administrator authentication.
    await reauthenticate(actor, body.currentPassword);
    const session = await startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        const request = await requests.findOne({
          _id: requestId, requestKind: "ACCOUNT_DELETION", status: "APPROVED",
        }).session(session);
        if (!request) throw fail(409, "Only an approved, uncompleted deletion request can be processed.");
        assertVerifiedOwner(request);
        const timestamp = now();
        const evidence = validateCompletionEvidence(body, request.referenceId, timestamp);
        const userId = request.subjectUser;
        const user = await users.findOne({ _id: userId, role: "CUSTOMER", isDeleted: { $ne: true } }).session(session);
        if (!user) throw fail(409, "Customer not found or already deleted. Review the existing request history.");
        const wallet = await wallets.findOne({ user: userId }).session(session);
        assertNoUnsettledBalances(user, wallet);
        // Cashback credits are immutable positive ledger entries, not Main
        // Wallet money. Never erase access while that separate claim exists.
        const cashback = await cashbackEntries.exists({ user: userId, status: "POSTED" }).session(session);
        if (cashback) throw fail(409, "This customer has a Cashback Wallet entitlement. Support must resolve and document that claim before deletion; no cashback or wallet record has been changed.");
        // Unknown/nonterminal states require review, never an assumed failure.
        const pending = await transactions.exists({
          customerId: userId,
          status: { $nin: ["SUCCESS", "SUCCESSFUL", "COMPLETED", "FAILED", "REFUNDED", "REVERSED", "CANCELLED"] },
        }).session(session);
        if (pending) throw fail(409, "Unresolved transactions require review before deletion. No transaction has been modified.");

        // Deliberately avoid registration/referral qualification hooks for this
        // privacy-only operation. The explicit allowlist above never includes
        // a balance, commission, referral attribution or historical identifier.
        const changed = await users.collection.updateOne(
          { _id: userId, role: "CUSTOMER", isDeleted: { $ne: true } },
          userErasureUpdate(userId, actor._id || actor.id, timestamp), { session },
        );
        if (changed.modifiedCount !== 1) throw fail(409, "Account changed during processing. No partial deletion was committed.");
        // Address-book records are not transaction, ledger or beneficiary-payment records.
        const removed = await beneficiaries.deleteMany({ customer: userId }, { session });
        await deviceSessions.updateMany({ userId, status: "ACTIVE" }, {
          $set: { status: "REVOKED", loginEnabled: false, transactionEnabled: false },
          $unset: { credentialHash: 1, previousCredentialHash: 1 },
        }, { session });
        const completionEvidence = {
          ...evidence, processedAt: timestamp, processedBy: actor._id || actor.id,
          automatedActions: ["CUSTOMER_PROFILE_AND_AUTH_ERASURE", "SAVED_CONTACT_ERASURE", "SESSION_REVOCATION"],
          savedContactsDeleted: Number(removed.deletedCount || 0),
          financialRecordsModified: false,
        };
        const update = await requests.updateOne({ _id: requestId, status: "APPROVED" }, {
          $set: {
            status: "COMPLETED", completionEvidence,
            requester: { fullName: "Deleted ServicePay Customer" },
            description: "Removed following completed account deletion.",
          },
          $unset: { activeRequestKey: 1, deletionVerification: 1 },
          $push: { history: {
            status: "COMPLETED", actorType: "ADMIN", changedBy: actor._id || actor.id,
            changedAt: timestamp,
            note: "Profile/authentication data and saved contacts erased; sessions revoked. Associated-system and processor actions documented by Head Office. Required financial/audit records preserved under the recorded retention policy.",
          } },
        }, { session });
        if (update.modifiedCount !== 1) throw fail(409, "Request changed during processing. No partial deletion was committed.");
        // This audit insertion is mandatory and participates in the transaction.
        await audits.create([{
          actorId: actor._id || actor.id, actorRole: actor.role,
          actorName: actor.fullName, targetUserId: userId,
          action: "PRIVACY_REQUEST_UPDATED",
          reason: "Verified customer request; evidence-backed Head Office processing.",
          metadata: {
            operation: "ACCOUNT_DELETION_COMPLETED",
            referenceId: request.referenceId, financialRecordsModified: false, processingMode: evidence.mode,
          },
          ipAddress, userAgent: String(userAgent).slice(0, 500),
          requestMethod: "PATCH", requestPath: `/api/admin/control-center/account-deletion-requests/${requestId}`,
        }], { session });
        result = { request, completionEvidence };
      });
      return result;
    } finally { await session.endSession(); }
  }
  return { complete };
}

module.exports = {
  createDeletionProcessor, assertVerifiedOwner, assertNoUnsettledBalances,
  validateCompletionEvidence, userErasureUpdate, PERSONAL_FIELDS,
};
