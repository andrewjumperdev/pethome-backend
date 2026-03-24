import jwt from "jsonwebtoken";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "pethome-db";
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyC6euZm9Yp3ip0n1wyRjBi4Mkhi3vktBTs";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// No-op middleware — kept so routes file doesn't need changes
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
  return { stringValue: String(val) };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

async function fsGet(collection, docId) {
  const res = await fetch(`${FS_BASE}/${collection}/${docId}?key=${WEB_API_KEY}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET failed: ${res.status}`);
  const json = await res.json();
  return json.fields ? fromFirestoreFields(json.fields) : null;
}

async function fsPatch(collection, docId, data, updateMaskFields) {
  let url = `${FS_BASE}/${collection}/${docId}?key=${WEB_API_KEY}`;
  if (updateMaskFields) {
    for (const f of updateMaskFields) url += `&updateMask.fieldPaths=${f}`;
  }
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) throw new Error(`Firestore PATCH failed: ${res.status}`);
  return await res.json();
}

async function fsQuery(collection, fieldPath, value) {
  const url = `${FS_BASE}:runQuery?key=${WEB_API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: {
        fieldFilter: {
          field: { fieldPath },
          op: "EQUAL",
          value: toFirestoreValue(value),
        },
      },
      limit: 1,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status}`);
  const results = await res.json();
  // results is an array; first element has .document if found
  return results.filter((r) => r.document).length > 0;
}

// ── Pricing logic (mirrors Checkout.tsx) ────────────────────────────────────

const PRICES = {
  DOG_FLASH: 20,
  DOG_HALF_FLASH: 15,
  DOG_NIGHT: 23,
  CAT_NIGHT: 19,
  CAT_HALF_NIGHT: 9.5,
};

function daysDiff(start, end) {
  const s = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const e = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((e - s) / 86400000);
}

function calculateTotal({ serviceId, startDate, endDate, quantity, arrivalHour, departureHour }) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const nightsBase = Math.max(0, daysDiff(start, end));
  const qty = Math.max(1, parseInt(quantity) || 1);
  const normId = String(serviceId).toLowerCase();

  const isFlash = normId === "flash";
  const isSejour = normId === "sejour";
  const isCat = normId === "feline" || normId === "cat";

  const arrival = arrivalHour ?? 8;
  const departure = departureHour ?? (isFlash ? 18 : 8);

  let total = 0;

  if (isFlash) {
    const duration = departure - arrival;
    if (departure > 21 || duration > 9) {
      total = PRICES.DOG_NIGHT * qty;
    } else if (duration <= 4) {
      total = PRICES.DOG_HALF_FLASH * qty;
    } else {
      total = PRICES.DOG_FLASH * qty;
    }
    if (qty >= 2) total -= (total / qty) * 0.1;
    return Number(total.toFixed(2));
  }

  if (isSejour) {
    total = PRICES.DOG_NIGHT * nightsBase * qty;
    const extra = departure - arrival;
    if (extra > 0) {
      if (departure > 21 || extra > 12) total += PRICES.DOG_NIGHT * qty;
      else if (extra > 4) total += PRICES.DOG_FLASH * qty;
      else total += PRICES.DOG_HALF_FLASH * qty;
    }
    if (qty >= 2) total -= (total / qty) * 0.1;
    return Number(total.toFixed(2));
  }

  if (isCat) {
    total = PRICES.CAT_NIGHT * nightsBase * qty;
    const extra = departure - arrival;
    if (extra > 0) {
      if (departure > 21 || extra > 6) total += PRICES.CAT_NIGHT * qty;
      else total += PRICES.CAT_HALF_NIGHT * qty;
    }
    return Math.ceil(total);
  }

  return Number((PRICES.DOG_NIGHT * Math.max(1, nightsBase + 1) * qty).toFixed(2));
}

function parseHour(t) {
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  return parseInt(m[1]) + (m[2] ? parseInt(m[2]) / 60 : 0);
}

// ── POST /api/promo/validate ─────────────────────────────────────────────────

export const validatePromo = async (req, res) => {
  const { code, email, serviceId } = req.body;
  if (!code || !email || !serviceId)
    return res.status(400).json({ valid: false, message: "Données manquantes" });

  const upperCode = code.trim().toUpperCase();

  try {
    const promo = await fsGet("promoCodes", upperCode);

    if (!promo)
      return res.json({ valid: false, message: "Code promo invalide" });

    if (!promo.active)
      return res.json({ valid: false, message: "Ce code promo n'est plus actif" });

    if (promo.expiresAt && new Date(promo.expiresAt) < new Date())
      return res.json({ valid: false, message: "Ce code promo a expiré" });

    if (promo.serviceTypes && !promo.serviceTypes.includes(serviceId.toLowerCase()))
      return res.json({ valid: false, message: "Ce code est valable uniquement pour la formule séjour" });

    const emailNorm = email.toLowerCase().trim();
    if (promo.maxUsesPerEmail === 1 && (promo.usedByEmails || []).includes(emailNorm))
      return res.json({ valid: false, message: "Vous avez déjà utilisé ce code" });

    if (promo.condition === "new_client") {
      const hasBooking = await fsQuery("bookings", "contact.email", emailNorm);
      if (hasBooking)
        return res.json({ valid: false, message: "Ce code est réservé aux nouveaux clients" });
    }

    return res.json({
      valid: true,
      discount: promo.discount,
      label: promo.label,
      message: `Code appliqué : -${Math.round(promo.discount * 100)}%`,
    });
  } catch (err) {
    console.error("[Promo] validate error:", err);
    return res.status(500).json({ valid: false, message: "Erreur serveur" });
  }
};

// ── POST /api/promo/quote ────────────────────────────────────────────────────

export const getQuote = async (req, res) => {
  const { serviceId, startDate, endDate, quantity, arrivalTime, departureTime, promoCode, email } = req.body;

  if (!serviceId || !startDate || !endDate)
    return res.status(400).json({ error: "serviceId, startDate, endDate requis" });

  try {
    const subtotal = calculateTotal({
      serviceId,
      startDate,
      endDate,
      quantity: quantity || 1,
      arrivalHour: parseHour(arrivalTime),
      departureHour: parseHour(departureTime),
    });

    let promoDiscount = 0;
    let promoLabel = null;

    if (promoCode && email) {
      const upperCode = promoCode.trim().toUpperCase();
      const promo = await fsGet("promoCodes", upperCode);
      if (promo) {
        const emailNorm = email.toLowerCase().trim();
        const serviceOk = !promo.serviceTypes || promo.serviceTypes.includes(serviceId.toLowerCase());
        const emailNotUsed = !(promo.usedByEmails || []).includes(emailNorm);
        const notExpired = !promo.expiresAt || new Date(promo.expiresAt) > new Date();
        if (promo.active && serviceOk && emailNotUsed && notExpired) {
          promoDiscount = Number((subtotal * promo.discount).toFixed(2));
          promoLabel = promo.label;
        }
      }
    }

    const total = Number((subtotal - promoDiscount).toFixed(2));

    const quoteToken = jwt.sign(
      {
        total,
        subtotal,
        promoDiscount,
        promoCode: promoCode || null,
        serviceId,
        startDate,
        endDate,
        quantity: quantity || 1,
        email: email || null,
        type: "booking_quote",
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.json({ subtotal, promoDiscount, promoLabel, total, quoteToken });
  } catch (err) {
    console.error("[Quote] error:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── POST /api/promo/mark-used ────────────────────────────────────────────────

export const markPromoUsed = async (req, res) => {
  const { code, email } = req.body;
  if (!code || !email)
    return res.status(400).json({ error: "code et email requis" });

  try {
    const upperCode = code.trim().toUpperCase();
    const promo = await fsGet("promoCodes", upperCode);
    if (!promo) return res.status(404).json({ error: "Code introuvable" });

    const emailNorm = email.toLowerCase().trim();
    const usedByEmails = promo.usedByEmails || [];
    if (!usedByEmails.includes(emailNorm)) {
      usedByEmails.push(emailNorm);
      await fsPatch(
        "promoCodes",
        upperCode,
        { usedByEmails, usageCount: (promo.usageCount || 0) + 1 },
        ["usedByEmails", "usageCount"]
      );
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("[Promo] mark-used error:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};
