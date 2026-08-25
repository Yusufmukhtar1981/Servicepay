const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");
const {
  requireNoRestriction,
  requireSpendableBalance,
} = require("../middleware/accountRestriction.middleware");

const transferController = require(
  "../controllers/transfer.controller"
);

const bankTransferController = require(
  "../controllers/bankTransfer.controller"
);

const router = express.Router();

/*
 * Squad webhook must remain public.
 * The controller verifies Squad's
 * HMAC-SHA512 signature before processing it.
 */
router.post(
  "/squad/webhook",
  bankTransferController.squadWebhook
);

/*
 * ServicePay-to-ServicePay beneficiary lookup.
 */
router.get(
  "/beneficiary/:phone",
  protect,
  transferController.lookupBeneficiary
);

/*
 * Complete ServicePay-to-ServicePay transfer.
 */
router.post(
  "/servicepay",
  protect,
  requireNoRestriction("BLOCK_OUTGOING_TRANSFERS", "BLOCK_WALLET_DEBIT"),
  requireSpendableBalance,
  transferController.transfer
);

/*
 * Return the supported Nigerian banks
 * and their Squad/NIBSS bank codes.
 */
router.get(
  "/banks",
  protect,
  bankTransferController.getBanks
);

/*
 * Verify bank account number and
 * return the account holder's name.
 */
router.post(
  "/bank/resolve-account",
  protect,
  bankTransferController.resolveBankAccount
);

/*
 * Initiate Squad bank transfer.
 */
router.post(
  "/bank",
  protect,
  requireNoRestriction("BLOCK_OUTGOING_TRANSFERS", "BLOCK_WITHDRAWALS", "BLOCK_WALLET_DEBIT"),
  requireSpendableBalance,
  bankTransferController.initiateBankTransfer
);

/*
 * Re-query a bank transfer status.
 */
router.post(
  "/bank/requery",
  protect,
  bankTransferController.requeryBankTransfer
);

/*
 * Get the logged-in customer's
 * bank-transfer history.
 */
router.get(
  "/bank/history",
  protect,
  bankTransferController.getBankTransferHistory
);

module.exports = router;