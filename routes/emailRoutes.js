import express from "express";
import {
  sendBookingReceived,
  sendBookingConfirmed,
  sendBookingRejected,
  sendBookingCancelled,
  requireResend,
} from "../controllers/emailController.js";

const router = express.Router();

// Todas las rutas requieren Resend configurado
router.use(requireResend);

// Emails de reservas
router.post("/booking-received", sendBookingReceived);
router.post("/booking-confirmed", sendBookingConfirmed);
router.post("/booking-rejected", sendBookingRejected);
router.post("/booking-cancelled", sendBookingCancelled);

export default router;
