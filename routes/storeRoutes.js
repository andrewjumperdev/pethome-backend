import express from "express";
import {
  createPaymentIntent,
  handleWebhook,
  getPaymentStatus,
  createRefund,
} from "../controllers/storePaymentController.js";
import { requireAdminApiKey, paymentRateLimiter } from "../middleware/auth.js";

const router = express.Router();

// Pagos de tienda
router.post("/create-payment-intent", paymentRateLimiter, createPaymentIntent);
router.get("/payment/:paymentIntentId", getPaymentStatus);

// Admin
router.post("/refund", requireAdminApiKey, createRefund);

// Webhook (Stripe envia raw body)
router.post("/webhook", express.raw({ type: "application/json" }), handleWebhook);

export default router;
