import express from "express";
import {
  sendBookingReceived,
  sendBookingConfirmed,
  sendBookingRejected,
  sendBookingCancelled,
  sendTestEmails,
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

// Test — envía emails de prueba con datos mock
router.post("/test", sendTestEmails);

export default router;
