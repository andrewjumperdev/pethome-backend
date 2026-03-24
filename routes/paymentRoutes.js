import express from "express";
import {
  createPaymentIntent,
  createSetupIntent,
  chargeBooking,
  stripeWebhook,
} from "../controllers/paymentController.js";

const router = express.Router();

// Stripe webhook — must come before JSON body parser touches the route
router.post("/webhook", stripeWebhook);

router.post("/create-payment-intent", createPaymentIntent);
router.post("/create-setup-intent", createSetupIntent);
router.post("/charge-booking", chargeBooking);

export default router;
