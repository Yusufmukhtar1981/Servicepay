const express = require("express");
const multer = require("multer");
const { protect, adminOnly } = require("../middleware/auth.middleware");
const controller = require("../controllers/adminAmana.controller");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
});
const uploadDocuments = (req, res, next) => {
  upload.fields([
    { name: "paymentReceipt", maxCount: 1 },
    { name: "proof", maxCount: 5 },
    { name: "attachments", maxCount: 5 },
  ])(req, res, (error) => {
    if (!error) return next();
    return res.status(400).json({
      success: false,
      message: error.code === "LIMIT_FILE_SIZE"
        ? "Amana documents must be 8 MB or smaller."
        : "Unable to process the Amana document upload.",
    });
  });
};

router.use(protect, adminOnly("HEAD_OFFICE"));
router.get("/", controller.getAllAmanaOrders);
router.patch("/:id/request-information", controller.requestMoreInformation);
router.patch("/:id/provider", controller.updateProvider);
router.patch("/:id/provider-verification", controller.verifyProvider);
router.patch("/:id/approve", controller.approveAmanaOrder);
router.patch("/:id/reject", controller.rejectAmanaOrder);
router.post("/:id/funding", controller.recordFunding);
router.post("/:id/provider-payment", uploadDocuments, controller.recordProviderPayment);
router.post("/:id/fulfilment-proof", uploadDocuments, controller.addAmanaFulfilmentProof);
router.patch("/:id/complete", controller.completeAmanaOrder);
router.patch("/:id/cancel", controller.cancelAmanaOrder);
router.get("/:id", controller.getAmanaOrderById);

module.exports = router;