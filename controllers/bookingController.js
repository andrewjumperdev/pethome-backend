import Stripe from "stripe";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "pethome-db";
const WEB_API_KEY =
  process.env.FIREBASE_WEB_API_KEY || "AIzaSyC6euZm9Yp3ip0n1wyRjBi4Mkhi3vktBTs";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const MAX_CAPACITY = parseInt(process.env.MAX_CAPACITY || "5", 10);
const FROM_EMAIL = process.env.FROM_EMAIL || "Maison pour Pets <reservations@maisonpourpets.com>";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@maisonpourpets.com";

// ── No-op middleware — kept so routes file doesn't need changes ───────────────
export const requireFirebase = (_req, _res, next) => next();

// ── Firestore REST helpers ────────────────────────────────────────────────────

function fromFirestoreValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("doubleValue" in v) return v.doubleValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("nullValue" in v) return null;
  if ("arrayValue" in v)
    return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in v) return fromFirestoreFields(v.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) {
    obj[k] = fromFirestoreValue(v);
  }
  return obj;
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") return { doubleValue: val };
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val))
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === "object") {
    return { mapValue: { fields: toFirestoreFields(val) } };
  }
  return { stringValue: String(val) };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

/** GET a single document by ID. Returns { id, data } or null if not found. */
async function fsGetDoc(collection, docId) {
  const res = await fetch(
    `${FS_BASE}/${collection}/${docId}?key=${WEB_API_KEY}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET failed: ${res.status}`);
  const json = await res.json();
  if (!json.fields) return null;
  return { id: json.name.split("/").pop(), data: fromFirestoreFields(json.fields) };
}

/** PATCH only the provided fields (uses updateMask so untouched fields stay). */
async function fsUpdate(collection, docId, partialData) {
  const fields = Object.keys(partialData);
  let url = `${FS_BASE}/${collection}/${docId}?key=${WEB_API_KEY}`;
  for (const f of fields) url += `&updateMask.fieldPaths=${encodeURIComponent(f)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(partialData) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore PATCH failed (${res.status}): ${text}`);
  }
  return await res.json();
}

/** Full PATCH (replaces entire document). */
async function fsPatch(collection, docId, data) {
  const url = `${FS_BASE}/${collection}/${docId}?key=${WEB_API_KEY}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) throw new Error(`Firestore PATCH failed: ${res.status}`);
  return await res.json();
}

/** Query a collection with a single field filter. Returns array of { id, data }. */
async function fsQueryAll(collection, fieldPath, op, value, limit = 200) {
  const url = `${FS_BASE}:runQuery?key=${WEB_API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: {
        fieldFilter: {
          field: { fieldPath },
          op,
          value: toFirestoreValue(value),
        },
      },
      limit,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status}`);
  const results = await res.json();
  return results
    .filter((r) => r.document)
    .map((r) => ({
      id: r.document.name.split("/").pop(),
      data: fromFirestoreFields(r.document.fields || {}),
    }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Check whether two date ranges overlap. Both are ISO date strings. */
function datesOverlap(startA, endA, startB, endB) {
  const s1 = new Date(startA).getTime();
  const e1 = new Date(endA || startA).getTime();
  const s2 = new Date(startB).getTime();
  const e2 = new Date(endB || startB).getTime();
  // Overlap when neither ends before the other starts
  return s1 <= e2 && s2 <= e1;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ── Email templates ───────────────────────────────────────────────────────────

function buildConfirmationEmail(bookingId, booking) {
  const details = booking.details || [];
  const petName = details[0]?.name || booking.petName || "votre animal";
  const clientName = booking.contact?.name || booking.ownerName || "Client";
  const clientEmail = booking.contact?.email || booking.email || "";
  const startDate = formatDate(booking.startDate || booking.date);
  const endDate = formatDate(booking.endDate || booking.startDate || booking.date);
  const total = (booking.total || 0).toFixed(2);
  const arrivalTime = booking.arrivalTime || "non précisé";
  const departureTime = booking.departureTime || "non précisé";

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#4CAF50,#2e7d32);padding:40px 40px 30px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:28px;font-weight:700;">Réservation Confirmée</h1>
            <p style="color:rgba(255,255,255,0.85);margin:10px 0 0;font-size:16px;">Maison pour Pets — Hôtel pour animaux</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="font-size:16px;color:#333;margin:0 0 20px;">Bonjour <strong>${clientName}</strong>,</p>
            <p style="font-size:16px;color:#555;margin:0 0 30px;line-height:1.6;">
              Nous avons le plaisir de vous confirmer votre réservation et le paiement a bien été encaissé. Votre animal sera entre de bonnes mains !
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fffe;border:1px solid #c8e6c9;border-radius:8px;margin-bottom:30px;">
              <tr><td style="padding:20px;">
                <h3 style="color:#2e7d32;margin:0 0 16px;font-size:18px;">Détails de la réservation</h3>
                <table width="100%" cellpadding="6" cellspacing="0">
                  <tr>
                    <td style="color:#666;font-size:14px;width:45%;">Référence</td>
                    <td style="color:#333;font-size:14px;font-weight:600;">#${bookingId}</td>
                  </tr>
                  <tr>
                    <td style="color:#666;font-size:14px;">Animal</td>
                    <td style="color:#333;font-size:14px;font-weight:600;">${petName}</td>
                  </tr>
                  <tr>
                    <td style="color:#666;font-size:14px;">Date d'arrivée</td>
                    <td style="color:#333;font-size:14px;font-weight:600;">${startDate} à ${arrivalTime}</td>
                  </tr>
                  <tr>
                    <td style="color:#666;font-size:14px;">Date de départ</td>
                    <td style="color:#333;font-size:14px;font-weight:600;">${endDate} à ${departureTime}</td>
                  </tr>
                  <tr>
                    <td style="color:#666;font-size:14px;">Montant encaissé</td>
                    <td style="color:#2e7d32;font-size:16px;font-weight:700;">${total} €</td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <p style="font-size:15px;color:#555;margin:0 0 20px;line-height:1.6;">
              Si vous avez des questions ou souhaitez nous communiquer des informations supplémentaires sur votre animal, n'hésitez pas à nous contacter en répondant à cet email.
            </p>

            <p style="font-size:15px;color:#555;margin:0;line-height:1.6;">
              À très bientôt,<br>
              <strong style="color:#2e7d32;">L'équipe Maison pour Pets</strong>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f8f8;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
            <p style="color:#999;font-size:12px;margin:0;">
              Maison pour Pets · ${clientEmail}<br>
              Vous recevez cet email car vous avez effectué une réservation sur maisonpourpets.com
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    from: FROM_EMAIL,
    to: [clientEmail],
    bcc: [ADMIN_EMAIL],
    subject: `✅ Votre réservation est confirmée — Maison pour Pets`,
    html,
  };
}

function buildRejectionEmail(bookingId, booking, reason) {
  const details = booking.details || [];
  const petName = details[0]?.name || booking.petName || "votre animal";
  const clientName = booking.contact?.name || booking.ownerName || "Client";
  const clientEmail = booking.contact?.email || booking.email || "";
  const startDate = formatDate(booking.startDate || booking.date);
  const endDate = formatDate(booking.endDate || booking.startDate || booking.date);

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#e57373,#c62828);padding:40px 40px 30px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:28px;font-weight:700;">Réservation Non Disponible</h1>
            <p style="color:rgba(255,255,255,0.85);margin:10px 0 0;font-size:16px;">Maison pour Pets — Hôtel pour animaux</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="font-size:16px;color:#333;margin:0 0 20px;">Bonjour <strong>${clientName}</strong>,</p>
            <p style="font-size:16px;color:#555;margin:0 0 30px;line-height:1.6;">
              Nous sommes au regret de vous informer que nous ne sommes pas en mesure d'accepter votre demande de réservation pour les dates demandées.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border:1px solid #ffcdd2;border-radius:8px;margin-bottom:30px;">
              <tr><td style="padding:20px;">
                <h3 style="color:#c62828;margin:0 0 16px;font-size:18px;">Détails de la demande</h3>
                <table width="100%" cellpadding="6" cellspacing="0">
                  <tr>
                    <td style="color:#666;font-size:14px;width:45%;">Référence</td>
                    <td style="color:#333;font-size:14px;font-weight:600;">#${bookingId}</td>
                  </tr>
                  <tr>
                    <td style="color:#666;font-size:14px;">Animal</td>
                    <td style="color:#333;font-size:14px;font-weight:600;">${petName}</td>
                  </tr>
                  <tr>
                    <td style="color:#666;font-size:14px;">Date d'arrivée souhaitée</td>
                    <td style="color:#333;font-size:14px;font-weight:600;">${startDate}</td>
                  </tr>
                  <tr>
                    <td style="color:#666;font-size:14px;">Date de départ souhaitée</td>
                    <td style="color:#333;font-size:14px;font-weight:600;">${endDate}</td>
                  </tr>
                  ${reason ? `<tr>
                    <td style="color:#666;font-size:14px;">Motif</td>
                    <td style="color:#c62828;font-size:14px;font-weight:600;">${reason}</td>
                  </tr>` : ""}
                </table>
              </td></tr>
            </table>

            <p style="font-size:15px;color:#555;margin:0 0 20px;line-height:1.6;">
              Aucun prélèvement n'a été effectué sur votre carte. N'hésitez pas à nous contacter pour proposer d'autres dates ou pour toute question.
            </p>

            <p style="font-size:15px;color:#555;margin:0;line-height:1.6;">
              Nous espérons pouvoir vous accueillir prochainement,<br>
              <strong style="color:#c62828;">L'équipe Maison pour Pets</strong>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f8f8;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
            <p style="color:#999;font-size:12px;margin:0;">
              Maison pour Pets · ${clientEmail}<br>
              Vous recevez cet email car vous avez effectué une demande de réservation sur maisonpourpets.com
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    from: FROM_EMAIL,
    to: [clientEmail],
    bcc: [ADMIN_EMAIL],
    subject: `Votre demande de réservation — Maison pour Pets`,
    html,
  };
}

// ── Cancellation policy ───────────────────────────────────────────────────────

const CANCELLATION_POLICY = {
  freeCancellationDays: 3,
  partialRefundPercentage: 50,
  noRefundHours: 24,
};

export const getCancellationPolicy = (req, res) => {
  res.json({
    policy: CANCELLATION_POLICY,
    description: {
      full: `Remboursement complet si vous annulez ${CANCELLATION_POLICY.freeCancellationDays} jours avant l'arrivée`,
      partial: `${CANCELLATION_POLICY.partialRefundPercentage}% de remboursement si vous annulez après`,
      none: `Aucun remboursement si vous annulez moins de ${CANCELLATION_POLICY.noRefundHours}h avant`,
    },
  });
};

const calculateRefund = (booking) => {
  const now = new Date();
  const startDate = new Date(booking.startDate || booking.date);
  const hoursUntilStart = (startDate - now) / (1000 * 60 * 60);
  const daysUntilStart = hoursUntilStart / 24;

  if (daysUntilStart >= CANCELLATION_POLICY.freeCancellationDays) {
    return { percentage: 100, reason: "Annulation gratuite" };
  }
  if (hoursUntilStart >= CANCELLATION_POLICY.noRefundHours) {
    return {
      percentage: CANCELLATION_POLICY.partialRefundPercentage,
      reason: "Remboursement partiel",
    };
  }
  return { percentage: 0, reason: "Aucun remboursement (moins de 24h)" };
};

// ── GET /api/bookings/:id ─────────────────────────────────────────────────────

export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    const result = await fsGetDoc("bookings", id);
    if (!result) return res.status(404).json({ error: "Réservation introuvable" });

    const { data: booking } = result;
    const bookingEmail = booking.contact?.email || booking.email || "";

    if (email && bookingEmail.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: "Accès non autorisé à cette réservation" });
    }

    const safeBooking = {
      id,
      status: booking.status,
      startDate: booking.startDate || booking.date,
      endDate: booking.endDate,
      petName: booking.details?.[0]?.name || booking.petName,
      petType: booking.serviceId,
      totalPrice: booking.total || booking.totalPrice,
      paymentStatus: booking.paymentStatus,
      createdAt: booking.createdAt,
    };

    res.json({ booking: safeBooking });
  } catch (error) {
    console.error("[Booking] getById error:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── GET /api/bookings/by-email/:email ────────────────────────────────────────

export const getBookingsByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const docs = await fsQueryAll("bookings", "contact.email", "EQUAL", email.toLowerCase(), 20);

    const bookings = docs.map(({ id, data }) => ({
      id,
      status: data.status,
      startDate: data.startDate || data.date,
      endDate: data.endDate,
      petName: data.details?.[0]?.name || data.petName,
      totalPrice: data.total || data.totalPrice,
      createdAt: data.createdAt,
    }));

    res.json({ bookings });
  } catch (error) {
    console.error("[Booking] getByEmail error:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── POST /api/bookings/confirm ────────────────────────────────────────────────

export const confirmBooking = async (req, res) => {
  const { bookingId } = req.body;
  if (!bookingId) return res.status(400).json({ error: "bookingId requis" });

  // 1. Fetch booking
  let bookingDoc;
  try {
    bookingDoc = await fsGetDoc("bookings", bookingId);
  } catch (err) {
    console.error("[Confirm] fetch booking error:", err);
    return res.status(500).json({ error: "Erreur lors de la récupération de la réservation" });
  }
  if (!bookingDoc) return res.status(404).json({ error: "Réservation introuvable" });

  const booking = bookingDoc.data;

  // 2. Guard: status must be pending
  if (booking.status !== "pending") {
    return res.status(400).json({
      error: `La réservation est déjà ${booking.status}`,
    });
  }

  // 3. Guard: paymentMethodId required
  if (!booking.paymentMethodId) {
    return res.status(400).json({ error: "Aucun moyen de paiement associé à cette réservation" });
  }

  // 4. Capacity check
  try {
    const confirmedDocs = await fsQueryAll("bookings", "status", "EQUAL", "confirmed", 500);
    const bookingStart = booking.startDate || booking.date;
    const bookingEnd = booking.endDate || bookingStart;

    const overlapping = confirmedDocs.filter(({ id, data }) => {
      if (id === bookingId) return false;
      const s = data.startDate || data.date;
      const e = data.endDate || s;
      return datesOverlap(bookingStart, bookingEnd, s, e);
    });

    const occupiedQuantity = overlapping.reduce((sum, { data }) => sum + (Number(data.quantity) || 1), 0);
    const thisQuantity = Number(booking.quantity) || 1;

    if (occupiedQuantity + thisQuantity > MAX_CAPACITY) {
      return res.status(400).json({
        error: "Capacité maximale atteinte pour ces dates",
        detail: `Capacité: ${MAX_CAPACITY}, déjà réservé: ${occupiedQuantity}, demandé: ${thisQuantity}`,
      });
    }
  } catch (err) {
    console.error("[Confirm] capacity check error:", err);
    // Non-blocking: if capacity check fails we log but don't block the confirmation
  }

  // 5. Ensure PaymentMethod is attached to a Stripe Customer (required for off-session)
  const details = booking.details || [];
  let stripeCustomerId = booking.stripeCustomerId || null;

  try {
    if (!stripeCustomerId) {
      // Old booking: no customer saved — create/find one and attach the PM
      const clientEmail = booking.contact?.email || booking.email || "";
      const clientName = booking.contact?.name || "";
      const existing = await stripe.customers.list({ email: clientEmail, limit: 1 });
      const customer = existing.data.length > 0
        ? existing.data[0]
        : await stripe.customers.create({ email: clientEmail, name: clientName });
      stripeCustomerId = customer.id;

      // Attach PM to customer so off-session charge works
      try {
        await stripe.paymentMethods.attach(booking.paymentMethodId, { customer: stripeCustomerId });
      } catch (attachErr) {
        // Already attached is fine; anything else re-throw
        if (!String(attachErr.message).includes("already been attached")) throw attachErr;
      }

      // Persist customerId so future confirmations don't need to re-attach
      await fsUpdate("bookings", bookingId, { stripeCustomerId }).catch(() => {});
      console.log(`[Confirm] Attached PM to customer ${stripeCustomerId} for booking ${bookingId}`);
    }
  } catch (err) {
    console.error("[Confirm] Customer/attach error:", err);
    return res.status(500).json({ error: "Erreur lors de la préparation du paiement", details: err.message });
  }

  // 6. Charge Stripe
  // Idempotency key includes a date suffix — busts any cached error from previous day's attempt
  const idempotencyKey = `confirm-${bookingId}-${new Date().toISOString().slice(0, 10)}`;
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round((booking.total || booking.totalPrice || 0) * 100),
        currency: "eur",
        payment_method: booking.paymentMethodId,
        customer: stripeCustomerId,
        confirm: true,
        off_session: true,
        description: `Réservation ${bookingId} — ${details[0]?.name || "animal"}`,
        metadata: {
          bookingId,
          clientEmail: booking.contact?.email || booking.email || "",
        },
      },
      { idempotencyKey }
    );
  } catch (err) {
    console.error("[Confirm] Stripe charge error:", err);
    if (err.type === "StripeCardError") {
      try {
        await fsUpdate("bookings", bookingId, {
          paymentStatus: "failed",
          paymentError: err.message,
        });
      } catch (fsErr) {
        console.error("[Confirm] Failed to update paymentStatus=failed:", fsErr);
      }
      return res.status(400).json({ error: "Paiement refusé", details: err.message });
    }
    return res.status(500).json({ error: "Erreur lors du paiement", details: err.message });
  }

  // 6. Update Firestore
  try {
    await fsUpdate("bookings", bookingId, {
      status: "confirmed",
      paymentStatus: "paid",
      paymentId: paymentIntent.id,
      confirmedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Confirm] Failed to update booking status:", err);
    return res.status(500).json({ error: "Paiement encaissé mais erreur lors de la mise à jour de la réservation" });
  }

  // 7. Send confirmation email
  let emailStatus = "sent";
  try {
    const emailData = buildConfirmationEmail(bookingId, booking);
    await resend.emails.send(emailData);
    console.log(`[Confirm] Confirmation email sent for booking ${bookingId}`);
  } catch (emailErr) {
    console.error("[Confirm] Email failed:", emailErr);
    emailStatus = "failed";
    try {
      await fsUpdate("bookings", bookingId, { emailStatus: "failed" });
    } catch (e) {
      console.error("[Confirm] Failed to update emailStatus:", e);
    }
  }

  // 8. Mark promo code used (fail silently)
  if (booking.promoCode) {
    try {
      const promoDoc = await fsGetDoc("promoCodes", booking.promoCode.trim().toUpperCase());
      if (promoDoc) {
        const promo = promoDoc.data;
        const clientEmail = (booking.contact?.email || booking.email || "").toLowerCase().trim();
        const usedByEmails = promo.usedByEmails || [];
        if (!usedByEmails.includes(clientEmail)) {
          usedByEmails.push(clientEmail);
          await fsUpdate("promoCodes", booking.promoCode.trim().toUpperCase(), {
            usedByEmails,
            usageCount: (promo.usageCount || 0) + 1,
          });
        }
      }
    } catch (promoErr) {
      console.error("[Confirm] Promo mark-used failed (silent):", promoErr);
    }
  }

  // 9. Update emailStatus if sent
  if (emailStatus === "sent") {
    try {
      await fsUpdate("bookings", bookingId, { emailStatus: "sent" });
    } catch (e) {
      // non-critical
    }
  }

  return res.json({ success: true, paymentIntentId: paymentIntent.id, emailStatus });
};

// ── POST /api/bookings/reject ─────────────────────────────────────────────────

export const rejectBooking = async (req, res) => {
  const { bookingId, reason } = req.body;
  if (!bookingId) return res.status(400).json({ error: "bookingId requis" });

  // 1. Fetch booking + guard
  let bookingDoc;
  try {
    bookingDoc = await fsGetDoc("bookings", bookingId);
  } catch (err) {
    console.error("[Reject] fetch error:", err);
    return res.status(500).json({ error: "Erreur lors de la récupération de la réservation" });
  }
  if (!bookingDoc) return res.status(404).json({ error: "Réservation introuvable" });

  const booking = bookingDoc.data;

  if (booking.status !== "pending") {
    return res.status(400).json({ error: `La réservation est déjà ${booking.status}` });
  }

  // 2. Update Firestore
  try {
    await fsUpdate("bookings", bookingId, {
      status: "rejected",
      rejectedAt: new Date().toISOString(),
      rejectionReason: reason || "",
    });
  } catch (err) {
    console.error("[Reject] update error:", err);
    return res.status(500).json({ error: "Erreur lors du refus de la réservation" });
  }

  // 3. Send rejection email
  let emailStatus = "sent";
  try {
    const emailData = buildRejectionEmail(bookingId, booking, reason);
    await resend.emails.send(emailData);
    console.log(`[Reject] Rejection email sent for booking ${bookingId}`);
  } catch (emailErr) {
    console.error("[Reject] Email failed:", emailErr);
    emailStatus = "failed";
    try {
      await fsUpdate("bookings", bookingId, { emailStatus: "failed" });
    } catch (e) {
      console.error("[Reject] Failed to update emailStatus:", e);
    }
  }

  if (emailStatus === "sent") {
    try {
      await fsUpdate("bookings", bookingId, { emailStatus: "sent" });
    } catch (e) {
      // non-critical
    }
  }

  return res.json({ success: true, emailStatus });
};

// ── POST /api/bookings/resend-email ──────────────────────────────────────────

export const resendEmailForBooking = async (req, res) => {
  const { bookingId, type } = req.body;
  if (!bookingId || !type) {
    return res.status(400).json({ error: "bookingId et type requis" });
  }
  if (type !== "confirmed" && type !== "rejected") {
    return res.status(400).json({ error: "type doit être 'confirmed' ou 'rejected'" });
  }

  let bookingDoc;
  try {
    bookingDoc = await fsGetDoc("bookings", bookingId);
  } catch (err) {
    return res.status(500).json({ error: "Erreur lors de la récupération de la réservation" });
  }
  if (!bookingDoc) return res.status(404).json({ error: "Réservation introuvable" });

  const booking = bookingDoc.data;

  try {
    const emailData =
      type === "confirmed"
        ? buildConfirmationEmail(bookingId, booking)
        : buildRejectionEmail(bookingId, booking, booking.rejectionReason || "");

    await resend.emails.send(emailData);
    await fsUpdate("bookings", bookingId, { emailStatus: "sent" });
    console.log(`[Resend] Email (${type}) resent for booking ${bookingId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error("[Resend] Email error:", err);
    return res.status(500).json({ error: "Erreur lors de l'envoi de l'email", details: err.message });
  }
};

// ── POST /api/bookings/cancel ─────────────────────────────────────────────────

export const cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const { bookingId: tokenBookingId } = req.cancellation || {};

    if (tokenBookingId && bookingId !== tokenBookingId) {
      return res.status(403).json({ error: "Token non valide pour cette réservation" });
    }

    const bookingDoc = await fsGetDoc("bookings", bookingId);
    if (!bookingDoc) return res.status(404).json({ error: "Réservation introuvable" });

    const booking = bookingDoc.data;

    if (booking.status === "cancelled") {
      return res.status(400).json({ error: "La réservation est déjà annulée" });
    }
    if (booking.status === "completed") {
      return res.status(400).json({ error: "Impossible d'annuler une réservation terminée" });
    }

    const refundInfo = calculateRefund(booking);
    let refundResult = null;

    if (booking.paymentId && refundInfo.percentage > 0) {
      const refundAmount = Math.round(
        ((booking.total || booking.totalPrice || 0) * refundInfo.percentage) / 100 * 100
      );
      refundResult = await stripe.refunds.create({
        payment_intent: booking.paymentId,
        amount: refundAmount,
        reason: "requested_by_customer",
        metadata: { bookingId, refundPercentage: String(refundInfo.percentage) },
      });
    }

    await fsUpdate("bookings", bookingId, {
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
      message: "Réservation annulée",
      refund: {
        percentage: refundInfo.percentage,
        reason: refundInfo.reason,
        amount: refundResult ? refundResult.amount / 100 : 0,
        id: refundResult?.id,
      },
    });
  } catch (error) {
    console.error("[Cancel] error:", error);
    res.status(500).json({ error: "Erreur lors de l'annulation" });
  }
};
