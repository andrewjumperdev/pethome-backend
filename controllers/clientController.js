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
  const docs = results.filter((r) => r.document);
  if (docs.length === 0) return null;
  const doc = docs[0].document;
  const id = doc.name.split("/").pop();
  return { id, data: fromFirestoreFields(doc.fields) };
}

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

// ── GET /api/clients/lookup?email= ───────────────────────────────────────────

export const lookupClient = async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email requis" });

  try {
    const result = await fsQuery("clients", "email", email.toLowerCase().trim());
    if (!result) return res.json({ found: false });

    const { id, data } = result;
    return res.json({
      found: true,
      client: {
        id,
        name: data.name,
        phone: data.phone || "",
        email: data.email,
        pets: data.pets || [],
        bookingsCount: data.bookingsCount || 0,
      },
    });
  } catch (err) {
    console.error("[Client] lookup error:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── POST /api/clients/upsert ─────────────────────────────────────────────────

export const upsertClient = async (req, res) => {
  const { email, name, phone, pet } = req.body;
  if (!email || !name)
    return res.status(400).json({ error: "Email et nom requis" });

  try {
    const emailNorm = email.toLowerCase().trim();
    const existing = await fsQuery("clients", "email", emailNorm);

    let docId;
    let currentPets = [];
    let currentBookingsCount = 0;

    if (existing) {
      docId = existing.id;
      currentPets = existing.data.pets || [];
      currentBookingsCount = existing.data.bookingsCount || 0;
    } else {
      // Generate a new doc ID using Firestore REST (POST to collection)
      docId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    // Merge pet
    let updatedPets = [...currentPets];
    if (pet) {
      const petId = pet.id || `pet_${Date.now()}`;
      const idx = updatedPets.findIndex((p) => p.id === petId);
      if (idx >= 0) {
        updatedPets[idx] = { ...updatedPets[idx], ...pet, id: petId };
      } else {
        updatedPets.push({ ...pet, id: petId });
      }
    }

    await fsPatch("clients", docId, {
      email: emailNorm,
      name,
      phone: phone || "",
      pets: updatedPets,
      bookingsCount: currentBookingsCount + 1,
      updatedAt: new Date().toISOString(),
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("[Client] upsert error:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};
