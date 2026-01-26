import express from "express";
import {
  getCancellationPolicy,
  getBookingById,
  getBookingsByEmail,
  confirmBooking,
  rejectBooking,
  cancelBooking,
  requireFirebase,
} from "../controllers/bookingController.js";
import {
  requireAdminApiKey,
  verifyCancellationToken,
  paymentRateLimiter,
} from "../middleware/auth.js";

const router = express.Router();

// Publico (no requiere Firebase)
router.get("/cancel-policy", getCancellationPolicy);

// Requiere Firebase
router.get("/by-email/:email", requireFirebase, getBookingsByEmail);
router.get("/:id", requireFirebase, getBookingById);

// Cliente (requiere token de cancelacion + Firebase)
router.post("/cancel", requireFirebase, verifyCancellationToken, cancelBooking);

// Admin (requiere API Key + Firebase)
router.post("/confirm", requireFirebase, requireAdminApiKey, paymentRateLimiter, confirmBooking);
router.post("/reject", requireFirebase, requireAdminApiKey, rejectBooking);

export default router;
