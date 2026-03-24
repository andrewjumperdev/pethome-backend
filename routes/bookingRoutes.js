import express from "express";
import {
  getCancellationPolicy,
  getBookingById,
  getBookingsByEmail,
  confirmBooking,
  rejectBooking,
  cancelBooking,
  resendEmailForBooking,
  requireFirebase,
} from "../controllers/bookingController.js";
import {
  requireAdminApiKey,
  verifyCancellationToken,
  paymentRateLimiter,
} from "../middleware/auth.js";

const router = express.Router();

// Public
router.get("/cancel-policy", getCancellationPolicy);

// Client (no Firebase dependency — uses REST API internally)
router.get("/by-email/:email", getBookingsByEmail);
router.get("/:id", getBookingById);

// Client cancellation (requires cancellation token)
router.post("/cancel", verifyCancellationToken, cancelBooking);

// Admin routes (require API Key)
router.post("/confirm", requireAdminApiKey, paymentRateLimiter, confirmBooking);
router.post("/reject", requireAdminApiKey, rejectBooking);
router.post("/resend-email", requireAdminApiKey, resendEmailForBooking);

export default router;
