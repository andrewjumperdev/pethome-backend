import admin from "firebase-admin";

// Capacidad maxima del alojamiento
const MAX_CAPACITY = parseInt(process.env.MAX_CAPACITY) || 5;
const TEMP_RESERVATION_MINUTES = 15;

// Inicializar Firebase Admin solo si hay credenciales validas
let db = null;
let firebaseInitialized = false;

const initFirebase = () => {
  if (firebaseInitialized) return db;
  firebaseInitialized = true;

  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!privateKey || privateKey.includes("YOUR_PRIVATE_KEY_HERE")) {
    console.warn("Firebase Admin no configurado - funciones de capacidad deshabilitadas");
    return null;
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        }),
      });
    }
    db = admin.firestore();
  } catch (error) {
    console.error("Error inicializando Firebase Admin:", error.message);
    db = null;
  }
  return db;
};

// Middleware para verificar que Firebase esta configurado
export const requireFirebaseCapacity = (req, res, next) => {
  const firestore = initFirebase();
  if (!firestore) {
    return res.status(503).json({
      error: "Servicio no disponible",
      message: "Firebase Admin no esta configurado"
    });
  }
  req.db = firestore;
  next();
};

// Obtener reservas activas para un rango de fechas
const getActiveBookings = async (db, startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Buscar reservas que se solapan con el rango
  const snapshot = await db
    .collection("bookings")
    .where("status", "in", ["pending", "confirmed"])
    .get();

  return snapshot.docs.filter((doc) => {
    const booking = doc.data();
    const bookingStart = new Date(booking.startDate);
    const bookingEnd = new Date(booking.endDate);

    // Verificar solapamiento
    return bookingStart < end && bookingEnd > start;
  });
};

// Obtener reservas temporales activas
const getActiveTempReservations = async (db, startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = new Date();

  const snapshot = await db
    .collection("tempReservations")
    .where("expiresAt", ">", now.toISOString())
    .get();

  return snapshot.docs.filter((doc) => {
    const reservation = doc.data();
    const resStart = new Date(reservation.startDate);
    const resEnd = new Date(reservation.endDate);

    return resStart < end && resEnd > start;
  });
};

// Verificar disponibilidad
export const checkAvailability = async (req, res) => {
  try {
    const { startDate, endDate, quantity = 1 } = req.query;

    if (!startDate) {
      return res.status(400).json({ error: "startDate es requerido" });
    }

    const end = endDate || startDate;
    const qty = parseInt(quantity);

    // Obtener reservas activas
    const activeBookings = await getActiveBookings(req.db, startDate, end);
    const tempReservations = await getActiveTempReservations(req.db, startDate, end);

    // Calcular ocupacion por dia
    const start = new Date(startDate);
    const endD = new Date(end);
    const occupancyByDay = {};

    for (let d = new Date(start); d <= endD; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      occupancyByDay[dateStr] = 0;
    }

    // Sumar reservas confirmadas/pendientes
    activeBookings.forEach((doc) => {
      const booking = doc.data();
      const bookingStart = new Date(booking.startDate);
      const bookingEnd = new Date(booking.endDate);
      const bookingQty = booking.quantity || 1;

      for (let d = new Date(Math.max(bookingStart, start)); d < Math.min(bookingEnd, endD); d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        if (occupancyByDay[dateStr] !== undefined) {
          occupancyByDay[dateStr] += bookingQty;
        }
      }
    });

    // Sumar reservas temporales
    tempReservations.forEach((doc) => {
      const res = doc.data();
      const resStart = new Date(res.startDate);
      const resEnd = new Date(res.endDate);
      const resQty = res.quantity || 1;

      for (let d = new Date(Math.max(resStart, start)); d < Math.min(resEnd, endD); d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        if (occupancyByDay[dateStr] !== undefined) {
          occupancyByDay[dateStr] += resQty;
        }
      }
    });

    // Verificar si hay disponibilidad
    const maxOccupancy = Math.max(...Object.values(occupancyByDay), 0);
    const available = maxOccupancy + qty <= MAX_CAPACITY;
    const spotsAvailable = MAX_CAPACITY - maxOccupancy;

    res.json({
      available,
      spotsAvailable,
      maxCapacity: MAX_CAPACITY,
      requestedQuantity: qty,
      occupancyByDay,
    });
  } catch (error) {
    console.error("Error checking availability:", error);
    res.status(500).json({ error: "Error al verificar disponibilidad" });
  }
};

// Obtener calendario del mes
export const getCalendar = async (req, res) => {
  try {
    const { month, year } = req.query;

    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();

    const startOfMonth = new Date(y, m - 1, 1);
    const endOfMonth = new Date(y, m, 0);

    // Obtener todas las reservas del mes
    const activeBookings = await getActiveBookings(
      req.db,
      startOfMonth.toISOString(),
      endOfMonth.toISOString()
    );
    const tempReservations = await getActiveTempReservations(
      req.db,
      startOfMonth.toISOString(),
      endOfMonth.toISOString()
    );

    // Construir calendario
    const calendar = [];
    for (let d = 1; d <= endOfMonth.getDate(); d++) {
      const date = new Date(y, m - 1, d);
      const dateStr = date.toISOString().split("T")[0];

      let occupancy = 0;

      // Contar reservas para este dia
      activeBookings.forEach((doc) => {
        const booking = doc.data();
        const bookingStart = new Date(booking.startDate);
        const bookingEnd = new Date(booking.endDate);

        if (date >= bookingStart && date < bookingEnd) {
          occupancy += booking.quantity || 1;
        }
      });

      // Contar reservas temporales
      tempReservations.forEach((doc) => {
        const res = doc.data();
        const resStart = new Date(res.startDate);
        const resEnd = new Date(res.endDate);

        if (date >= resStart && date < resEnd) {
          occupancy += res.quantity || 1;
        }
      });

      calendar.push({
        date: dateStr,
        dayOfWeek: date.getDay(),
        occupancy,
        available: MAX_CAPACITY - occupancy,
        isFull: occupancy >= MAX_CAPACITY,
      });
    }

    res.json({
      month: m,
      year: y,
      maxCapacity: MAX_CAPACITY,
      calendar,
    });
  } catch (error) {
    console.error("Error getting calendar:", error);
    res.status(500).json({ error: "Error al obtener calendario" });
  }
};

// Crear reserva temporal (bloqueo de 15 minutos)
export const createTempReservation = async (req, res) => {
  try {
    const { startDate, endDate, quantity = 1, sessionId } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate y endDate son requeridos" });
    }

    // Verificar disponibilidad primero
    const activeBookings = await getActiveBookings(req.db, startDate, endDate);
    const tempReservations = await getActiveTempReservations(req.db, startDate, endDate);

    let maxOccupancy = 0;
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      let dayOccupancy = 0;

      activeBookings.forEach((doc) => {
        const booking = doc.data();
        if (d >= new Date(booking.startDate) && d < new Date(booking.endDate)) {
          dayOccupancy += booking.quantity || 1;
        }
      });

      tempReservations.forEach((doc) => {
        const res = doc.data();
        if (d >= new Date(res.startDate) && d < new Date(res.endDate)) {
          dayOccupancy += res.quantity || 1;
        }
      });

      maxOccupancy = Math.max(maxOccupancy, dayOccupancy);
    }

    if (maxOccupancy + parseInt(quantity) > MAX_CAPACITY) {
      return res.status(409).json({
        error: "No hay disponibilidad para las fechas seleccionadas",
        available: MAX_CAPACITY - maxOccupancy,
      });
    }

    // Crear reserva temporal
    const expiresAt = new Date(Date.now() + TEMP_RESERVATION_MINUTES * 60 * 1000);

    const tempDoc = await req.db.collection("tempReservations").add({
      startDate,
      endDate,
      quantity: parseInt(quantity),
      sessionId: sessionId || null,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    res.json({
      success: true,
      reservationId: tempDoc.id,
      expiresAt: expiresAt.toISOString(),
      expiresInMinutes: TEMP_RESERVATION_MINUTES,
    });
  } catch (error) {
    console.error("Error creating temp reservation:", error);
    res.status(500).json({ error: "Error al crear reserva temporal" });
  }
};

// Liberar reserva temporal
export const releaseTempReservation = async (req, res) => {
  try {
    const { id } = req.params;

    await req.db.collection("tempReservations").doc(id).delete();

    res.json({ success: true, message: "Reserva temporal liberada" });
  } catch (error) {
    console.error("Error releasing temp reservation:", error);
    res.status(500).json({ error: "Error al liberar reserva temporal" });
  }
};

// Limpiar reservas temporales expiradas (ejecutar periodicamente)
export const cleanupExpiredReservations = async () => {
  const firestore = initFirebase();
  if (!firestore) return;

  try {
    const now = new Date().toISOString();
    const snapshot = await firestore
      .collection("tempReservations")
      .where("expiresAt", "<", now)
      .get();

    const batch = firestore.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`Cleaned up ${snapshot.size} expired temp reservations`);
  } catch (error) {
    console.error("Error cleaning up temp reservations:", error);
  }
};
