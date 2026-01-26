import Stripe from "stripe";
import admin from "firebase-admin";
import jwt from "jsonwebtoken";
import { generateCancellationToken } from "../middleware/auth.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Inicializar Firebase Admin solo si hay credenciales validas
let db = null;
let firebaseInitialized = false;

const initFirebase = () => {
  if (firebaseInitialized) return db;
  firebaseInitialized = true;

  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!privateKey || privateKey.includes("YOUR_PRIVATE_KEY_HERE")) {
    console.warn("Firebase Admin no configurado - funciones de booking deshabilitadas");
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
    console.log("Firebase Admin inicializado correctamente");
  } catch (error) {
    console.error("Error inicializando Firebase Admin:", error.message);
    db = null;
  }
  return db;
};

// Middleware para verificar que Firebase esta configurado
export const requireFirebase = (req, res, next) => {
  const firestore = initFirebase();
  if (!firestore) {
    return res.status(503).json({
      error: "Servicio no disponible",
      message: "Firebase Admin no esta configurado. Agrega FIREBASE_PRIVATE_KEY en .env"
    });
  }
  req.db = firestore;
  next();
};

// Politica de cancelacion
const CANCELLATION_POLICY = {
  freeCancellationDays: 3,
  partialRefundPercentage: 50,
  noRefundHours: 24,
};

// Obtener politica de cancelacion
export const getCancellationPolicy = (req, res) => {
  res.json({
    policy: CANCELLATION_POLICY,
    description: {
      full: `Reembolso completo si cancelas ${CANCELLATION_POLICY.freeCancellationDays} dias antes de la llegada`,
      partial: `${CANCELLATION_POLICY.partialRefundPercentage}% de reembolso si cancelas despues`,
      none: `Sin reembolso si cancelas menos de ${CANCELLATION_POLICY.noRefundHours} horas antes`,
    },
  });
};

// Calcular reembolso segun politica
const calculateRefund = (booking) => {
  const now = new Date();
  const startDate = new Date(booking.startDate);
  const hoursUntilStart = (startDate - now) / (1000 * 60 * 60);
  const daysUntilStart = hoursUntilStart / 24;

  if (daysUntilStart >= CANCELLATION_POLICY.freeCancellationDays) {
    return { percentage: 100, reason: "Cancelacion gratuita" };
  }

  if (hoursUntilStart >= CANCELLATION_POLICY.noRefundHours) {
    return {
      percentage: CANCELLATION_POLICY.partialRefundPercentage,
      reason: "Reembolso parcial",
    };
  }

  return { percentage: 0, reason: "Sin reembolso (menos de 24h)" };
};

// Obtener reserva por ID (para cliente)
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    const bookingDoc = await req.db.collection("bookings").doc(id).get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    const booking = { id: bookingDoc.id, ...bookingDoc.data() };

    // Verificar que el email coincida (seguridad basica)
    if (email && booking.email?.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: "No tienes acceso a esta reserva" });
    }

    // Generar token de cancelacion si la reserva puede ser cancelada
    let cancellationToken = null;
    if (booking.status !== "cancelled" && booking.status !== "completed") {
      cancellationToken = generateCancellationToken(id, booking.email);
    }

    // No enviar datos sensibles
    const safeBooking = {
      id: booking.id,
      status: booking.status,
      startDate: booking.startDate,
      endDate: booking.endDate,
      petName: booking.petName,
      petType: booking.petType,
      totalPrice: booking.totalPrice,
      paymentStatus: booking.paymentStatus,
      createdAt: booking.createdAt,
    };

    res.json({ booking: safeBooking, cancellationToken });
  } catch (error) {
    console.error("Error getting booking:", error);
    res.status(500).json({ error: "Error al obtener reserva" });
  }
};

// Obtener reservas por email
export const getBookingsByEmail = async (req, res) => {
  try {
    const { email } = req.params;

    const snapshot = await req.db
      .collection("bookings")
      .where("email", "==", email.toLowerCase())
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const bookings = snapshot.docs.map((doc) => ({
      id: doc.id,
      status: doc.data().status,
      startDate: doc.data().startDate,
      endDate: doc.data().endDate,
      petName: doc.data().petName,
      totalPrice: doc.data().totalPrice,
      createdAt: doc.data().createdAt,
    }));

    res.json({ bookings });
  } catch (error) {
    console.error("Error getting bookings:", error);
    res.status(500).json({ error: "Error al obtener reservas" });
  }
};

// Confirmar reserva (admin) - cobra el pago
export const confirmBooking = async (req, res) => {
  try {
    const { bookingId } = req.body;

    const bookingDoc = await req.db.collection("bookings").doc(bookingId).get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    const booking = bookingDoc.data();

    if (booking.status !== "pending") {
      return res.status(400).json({ error: `La reserva ya esta ${booking.status}` });
    }

    // Cobrar usando el PaymentMethod guardado
    if (!booking.paymentMethodId) {
      return res.status(400).json({ error: "No hay metodo de pago asociado" });
    }

    // Crear PaymentIntent y cobrar
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(booking.totalPrice * 100),
      currency: "eur",
      customer: booking.stripeCustomerId,
      payment_method: booking.paymentMethodId,
      off_session: true,
      confirm: true,
      description: `Reserva ${bookingId} - ${booking.petName}`,
      metadata: {
        bookingId,
        petName: booking.petName,
        startDate: booking.startDate,
        endDate: booking.endDate,
      },
    });

    // Actualizar reserva en Firebase
    await req.db.collection("bookings").doc(bookingId).update({
      status: "confirmed",
      paymentStatus: "paid",
      paymentIntentId: paymentIntent.id,
      confirmedAt: new Date().toISOString(),
    });

    // Generar token de cancelacion para el cliente
    const cancellationToken = generateCancellationToken(bookingId, booking.email);
    const cancellationUrl = `${process.env.SITE_URL}/cancel/${bookingId}?token=${cancellationToken}`;

    res.json({
      success: true,
      message: "Reserva confirmada y pago procesado",
      paymentIntentId: paymentIntent.id,
      cancellationUrl,
    });
  } catch (error) {
    console.error("Error confirming booking:", error);

    // Si falla el pago, actualizar estado
    if (error.type === "StripeCardError") {
      await req.db.collection("bookings").doc(req.body.bookingId).update({
        paymentStatus: "failed",
        paymentError: error.message,
      });
      return res.status(400).json({ error: "El pago fue rechazado", details: error.message });
    }

    res.status(500).json({ error: "Error al confirmar reserva" });
  }
};

// Rechazar reserva (admin)
export const rejectBooking = async (req, res) => {
  try {
    const { bookingId, reason } = req.body;

    const bookingDoc = await req.db.collection("bookings").doc(bookingId).get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    const booking = bookingDoc.data();

    if (booking.status !== "pending") {
      return res.status(400).json({ error: `La reserva ya esta ${booking.status}` });
    }

    await req.db.collection("bookings").doc(bookingId).update({
      status: "rejected",
      rejectedAt: new Date().toISOString(),
      rejectionReason: reason || "No especificado",
    });

    res.json({
      success: true,
      message: "Reserva rechazada",
    });
  } catch (error) {
    console.error("Error rejecting booking:", error);
    res.status(500).json({ error: "Error al rechazar reserva" });
  }
};

// Cancelar reserva (cliente con token)
export const cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const { bookingId: tokenBookingId, email } = req.cancellation;

    // Verificar que el token corresponde a esta reserva
    if (bookingId !== tokenBookingId) {
      return res.status(403).json({ error: "Token no valido para esta reserva" });
    }

    const bookingDoc = await req.db.collection("bookings").doc(bookingId).get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    const booking = bookingDoc.data();

    if (booking.status === "cancelled") {
      return res.status(400).json({ error: "La reserva ya esta cancelada" });
    }

    if (booking.status === "completed") {
      return res.status(400).json({ error: "No se puede cancelar una reserva completada" });
    }

    // Calcular reembolso
    const refundInfo = calculateRefund(booking);
    let refundResult = null;

    // Procesar reembolso si hay pago y corresponde reembolso
    if (booking.paymentIntentId && refundInfo.percentage > 0) {
      const refundAmount = Math.round((booking.totalPrice * refundInfo.percentage) / 100 * 100);

      refundResult = await stripe.refunds.create({
        payment_intent: booking.paymentIntentId,
        amount: refundAmount,
        reason: "requested_by_customer",
        metadata: {
          bookingId,
          refundPercentage: refundInfo.percentage,
        },
      });
    }

    // Actualizar reserva
    await req.db.collection("bookings").doc(bookingId).update({
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancelledBy: "customer",
      refundPercentage: refundInfo.percentage,
      refundReason: refundInfo.reason,
      refundId: refundResult?.id || null,
      refundAmount: refundResult ? refundResult.amount / 100 : 0,
    });

    res.json({
      success: true,
      message: "Reserva cancelada",
      refund: {
        percentage: refundInfo.percentage,
        reason: refundInfo.reason,
        amount: refundResult ? refundResult.amount / 100 : 0,
        id: refundResult?.id,
      },
    });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    res.status(500).json({ error: "Error al cancelar reserva" });
  }
};
