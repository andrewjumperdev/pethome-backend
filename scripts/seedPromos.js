/**
 * seedPromos.js — Seed promoCodes via Firestore REST API (no Admin SDK needed)
 *
 * Uses the Firebase Web API key (public) to write directly to Firestore.
 * Make sure Firestore security rules allow writes to promoCodes, or run this
 * while rules are in test mode.
 *
 * Usage:  node scripts/seedPromos.js
 */

const PROJECT_ID = "pethome-db";
const API_KEY = "AIzaSyC6euZm9Yp3ip0n1wyRjBi4Mkhi3vktBTs"; // Web API key (public)
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Convert a JS object to Firestore REST field format
function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null) {
      fields[key] = { nullValue: null };
    } else if (typeof value === "boolean") {
      fields[key] = { booleanValue: value };
    } else if (typeof value === "number") {
      fields[key] = { doubleValue: value };
    } else if (typeof value === "string") {
      fields[key] = { stringValue: value };
    } else if (Array.isArray(value)) {
      fields[key] = {
        arrayValue: {
          values: value.map((v) =>
            typeof v === "string"
              ? { stringValue: v }
              : typeof v === "number"
              ? { doubleValue: v }
              : { stringValue: String(v) }
          ),
        },
      };
    }
  }
  return fields;
}

async function upsertDocument(collection, docId, data) {
  const url = `${BASE_URL}/${collection}/${docId}?key=${API_KEY}`;
  const body = JSON.stringify({ fields: toFirestoreFields(data) });

  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore error on ${docId}: ${errText}`);
  }
  return await res.json();
}

const promoCodes = [
  {
    id: "HPYNEWCLIENT",
    data: {
      discount: 0.1,
      label: "Nouveau client (-10%)",
      condition: "new_client",
      maxUsesPerEmail: 1,
      usageCount: 0,
      active: true,
      expiresAt: null,
      // serviceTypes and usedByEmails omitted (null/empty array handled below)
    },
  },
  {
    id: "LOVE4PET",
    data: {
      discount: 0.15,
      label: "Séjour fidélité (-15%)",
      condition: null,
      maxUsesPerEmail: null,
      usageCount: 0,
      active: true,
      expiresAt: null,
    },
  },
];

async function seed() {
  console.log("🌱 Seeding promoCodes collection...\n");

  for (const { id, data } of promoCodes) {
    try {
      await upsertDocument("promoCodes", id, data);
      console.log(`✅ ${id} — OK`);
    } catch (err) {
      console.error(`❌ ${id} — ${err.message}`);
    }
  }

  // LOVE4PET needs serviceTypes array — patch separately
  try {
    const url = `${BASE_URL}/promoCodes/LOVE4PET?key=${API_KEY}&updateMask.fieldPaths=serviceTypes&updateMask.fieldPaths=usedByEmails`;
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          serviceTypes: { arrayValue: { values: [{ stringValue: "sejour" }] } },
          usedByEmails: { arrayValue: { values: [] } },
        },
      }),
    });
    console.log("✅ LOVE4PET.serviceTypes — OK");
  } catch (err) {
    console.error("❌ LOVE4PET.serviceTypes —", err.message);
  }

  // HPYNEWCLIENT needs usedByEmails array
  try {
    const url = `${BASE_URL}/promoCodes/HPYNEWCLIENT?key=${API_KEY}&updateMask.fieldPaths=usedByEmails&updateMask.fieldPaths=serviceTypes`;
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          usedByEmails: { arrayValue: { values: [] } },
          serviceTypes: { nullValue: null },
        },
      }),
    });
    console.log("✅ HPYNEWCLIENT.usedByEmails — OK");
  } catch (err) {
    console.error("❌ HPYNEWCLIENT.usedByEmails —", err.message);
  }

  console.log("\n✅ Done! Check Firestore Console > promoCodes");
}

seed().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
