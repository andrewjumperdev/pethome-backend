import express from "express";
import {
  checkAvailability,
  getCalendar,
  createTempReservation,
  releaseTempReservation,
  requireFirebaseCapacity,
} from "../controllers/capacityController.js";

const router = express.Router();

// Todas las rutas requieren Firebase
router.use(requireFirebaseCapacity);

// Verificar disponibilidad
router.get("/check", checkAvailability);

// Calendario del mes
router.get("/calendar", getCalendar);

// Reservas temporales (bloqueo 15 min)
router.post("/reserve", createTempReservation);
router.delete("/reserve/:id", releaseTempReservation);

export default router;
