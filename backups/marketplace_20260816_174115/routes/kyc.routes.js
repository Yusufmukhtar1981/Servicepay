const multer = require("multer");
const {
  uploadKycDocument,
} = require("../controllers/kycDocument.controller");

const kycDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});
const express = require("express");
const {
  protect,
} = require("../middleware/auth.middleware");

const kycController = require(
  "../controllers/kyc.controller"
);

const router = express.Router();

/*
 * GET /api/kyc/status
 * Returns the logged-in user's KYC profile.
 */
router.get(
  "/status",
  protect,
  kycController.getMyKycStatus
);

/*
 * POST /api/kyc/submit
 * Submit or update individual KYC.
 */
router.post(
  "/submit",
  protect,
  kycController.submitMyKyc
);


/*
 * KYC supporting-document upload
 *
 * multipart field: document
 *
 * documentType:
 * SELFIE
 * ID_DOCUMENT
 * PROOF_OF_ADDRESS
 */
router.post(
  "/document/upload",
  protect,
  kycDocumentUpload.single("document"),
  uploadKycDocument
);

module.exports = router;
