const express = require("express");

const {
  protect,
} = require("../middleware/auth.middleware");

const sudoController = require(
  "../controllers/sudo.controller"
);

const router = express.Router();

/*
 * ServicePay <-> Sudo Africa
 *
 * All operational routes are protected.
 */

router.get(
  "/status",
  protect,
  sudoController.status
);

router.get(
  "/customers",
  protect,
  sudoController.getCustomers
);

router.post(
  "/customers",
  protect,
  sudoController.createCustomer
);

router.get(
  "/customers/:customerId",
  protect,
  sudoController.getCustomer
);

router.put(
  "/customers/:customerId",
  protect,
  sudoController.updateCustomer
);

router.get(
  "/cards",
  protect,
  sudoController.getCards
);

router.get(
  "/customers/:customerId/cards",
  protect,
  sudoController.getCustomerCards
);


router.get(
  "/card-programs",
  protect,
  sudoController.getCardPrograms
);


router.post(
  "/cards/simulator/generate",
  protect,
  sudoController.generateTestCard
);


router.post(
  "/cards/map",
  protect,
  sudoController.createOrMapCard
);


router.post(
  "/accounts",
  protect,
  sudoController.createAccount
);

router.get(
  "/accounts",
  protect,
  sudoController.getAccounts
);

router.get(
  "/funding-sources",
  protect,
  sudoController.getFundingSources
);

module.exports = router;
