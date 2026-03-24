import Stripe from "stripe";
import jwt from "jsonwebtoken";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// POST /payments/create-setup-intent
// Saves a card without charging. The amount is charged later when admin confirms.
// Accepts optional quoteToken (JWT) to store the backend-verified total.
export const createSetupIntent = async (req, res) => {
  try {
    const { client_name, client_email, quoteToken } = req.body;

    // Verify quoteToken if provided — this is the anti-manipulation guard
    let verifiedTotal = null;
    if (quoteToken) {
      try {
        const decoded = jwt.verify(quoteToken, process.env.JWT_SECRET);
        if (decoded.type !== "booking_quote") throw new Error("Wrong token type");
        verifiedTotal = decoded.total;
      } catch (err) {
        return res.status(400).json({ error: "quoteToken invalide ou expiré. Recommencez la réservation." });
      }
    }

    // Create (or find existing) Stripe Customer so the PM can be reused off-session
    const customers = await stripe.customers.list({ email: String(client_email || ""), limit: 1 });
    const customer = customers.data.length > 0
      ? customers.data[0]
      : await stripe.customers.create({
          email: String(client_email || ""),
          name: String(client_name || ""),
          metadata: { source: "maisonpourpets" },
        });

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: {
        client_name: String(client_name || ""),
        client_email: String(client_email || ""),
        ...(verifiedTotal !== null && { verified_total: String(verifiedTotal) }),
      },
    });

    console.log("✅ SetupIntent created:", setupIntent.id, "customer:", customer.id, "verified_total:", verifiedTotal);
    return res.json({ clientSecret: setupIntent.client_secret, customerId: customer.id });
  } catch (err) {
    console.error("❌ SetupIntent error:", err);
    return res.status(500).json({ error: "Erreur lors de la création du setup de paiement." });
  }
};

// POST /payments/charge-booking
// Charges the saved card when admin confirms a booking
export const chargeBooking = async (req, res) => {
  try {
    const { paymentMethodId, amount, bookingId, clientEmail, clientName } = req.body;

    if (!paymentMethodId || !amount) {
      return res.status(400).json({ error: "paymentMethodId et amount requis" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount) * 100), // euros → cents
      currency: "eur",
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {
        bookingId: String(bookingId || ""),
        client_email: String(clientEmail || ""),
        client_name: String(clientName || ""),
      },
    });

    console.log("✅ Booking charged:", paymentIntent.id, "status:", paymentIntent.status);
    return res.json({ success: true, paymentIntentId: paymentIntent.id, status: paymentIntent.status });
  } catch (err) {
    console.error("❌ Charge error:", err);
    return res.status(500).json({ error: err.message || "Erreur lors du paiement" });
  }
};

export const stripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret || webhookSecret.includes("YOUR_WEBHOOK")) {
    console.warn("[Webhook] STRIPE_WEBHOOK_SECRET not configured, skipping verification");
    return res.json({ received: true });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("[Webhook] Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object;
    const bookingId = pi.metadata?.bookingId;
    if (bookingId) {
      try {
        const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "pethome-db";
        const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyC6euZm9Yp3ip0n1wyRjBi4Mkhi3vktBTs";
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/bookings/${bookingId}?key=${WEB_API_KEY}&updateMask.fieldPaths=paymentStatus&updateMask.fieldPaths=paymentId&updateMask.fieldPaths=webhookConfirmed`;
        await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              paymentStatus: { stringValue: "paid" },
              paymentId: { stringValue: pi.id },
              webhookConfirmed: { booleanValue: true },
            },
          }),
        });
        console.log(`[Webhook] payment_intent.succeeded — booking ${bookingId} marked paid`);
      } catch (e) {
        console.error("[Webhook] Failed to update booking:", e.message);
      }
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object;
    const bookingId = pi.metadata?.bookingId;
    if (bookingId) {
      try {
        const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "pethome-db";
        const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyC6euZm9Yp3ip0n1wyRjBi4Mkhi3vktBTs";
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/bookings/${bookingId}?key=${WEB_API_KEY}&updateMask.fieldPaths=paymentStatus&updateMask.fieldPaths=paymentError`;
        await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              paymentStatus: { stringValue: "failed" },
              paymentError: { stringValue: pi.last_payment_error?.message || "Unknown error" },
            },
          }),
        });
        console.log(`[Webhook] payment_intent.payment_failed — booking ${bookingId}`);
      } catch (e) {
        console.error("[Webhook] Failed to update booking:", e.message);
      }
    }
  }

  res.json({ received: true });
};

export const createPaymentIntent = async (req, res) => {
  try {
    const { amount, client_name, client_email, reserva } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    // Debug: imprimir todo lo que llega en la solicitud
    console.log("💡 Received request body:", req.body);

    const paymentData = req.body;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: paymentData.amount,
      currency: "eur",
      payment_method_types: ["card"], // declarar explícitamente
      metadata: {
        client_name: String(paymentData.client_name),
        client_email: String(paymentData.client_email),
        service: String(paymentData.service),
        quantity: String(paymentData.quantity),
        sizes: paymentData.sizes.join(", "),
        details: JSON.stringify(paymentData.details),
        start_date: String(paymentData.start_date),
        end_date: String(paymentData.end_date),
        arrival_time: String(paymentData.arrival_time),
        departure_time: String(paymentData.departure_time),
        isSterilized: String(paymentData.isSterilized),
      },
    });

    console.log("Metadata enviada:", paymentIntent.metadata);

    // Debug: imprimir el PaymentIntent creado
    console.log("✅ PaymentIntent created:", paymentIntent);

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("❌ Stripe error:", err);
    res.status(500).json({ error: "Erreur lors de la création du paiement." });
  }
};
