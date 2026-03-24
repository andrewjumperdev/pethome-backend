/**
 * seedReviews.js — Add 3 impactful reviews to Firestore `reviews` collection
 *
 * These will appear at the top of the reviews page (sorted by date desc),
 * displacing old reviews from the visible top 3.
 *
 * Usage:  node scripts/seedReviews.js
 */

const PROJECT_ID = "pethome-db";
const API_KEY = "AIzaSyC6euZm9Yp3ip0n1wyRjBi4Mkhi3vktBTs";
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

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
    }
  }
  return fields;
}

async function addDocument(collectionId, data) {
  const url = `${BASE_URL}/${collectionId}?key=${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore error: ${errText}`);
  }
  return await res.json();
}

const reviews = [
  {
    author: "Sophie M.",
    text: "Je recommande vivement ! Mon golden retriever Max a été traité comme un roi. Des photos et vidéos envoyées tous les jours, une équipe ultra-réactive et un Max qui rentre épanoui. On a enfin trouvé une garderie digne de confiance — on reviendra sans hésiter !",
    starRating: 5,
    sourceUrl: "",
    createdAt: new Date("2026-03-15").toISOString(),
    date: new Date("2026-03-15").toISOString(),
  },
  {
    author: "Thomas & Julie",
    text: "Nous avons confié notre chienne Nala (bouledogue français) pendant 10 jours. Elle est rentrée en pleine forme, détendue et heureuse. Vraiment impressionnés par l'attention personnalisée et la communication quotidienne. Bien mieux qu'un chenil classique !",
    starRating: 5,
    sourceUrl: "",
    createdAt: new Date("2026-03-10").toISOString(),
    date: new Date("2026-03-10").toISOString(),
  },
  {
    author: "Camille B.",
    text: "PetHome a changé notre façon de voyager ! Notre chat Mochi, habituellement très stressé, est revenu parfaitement serein. L'accueil est chaleureux, le cadre est magnifique et le suivi est impeccable. Je ne laisserai plus jamais mon chat ailleurs. Merci du fond du cœur !",
    starRating: 5,
    sourceUrl: "",
    createdAt: new Date("2026-03-05").toISOString(),
    date: new Date("2026-03-05").toISOString(),
  },
];

async function seed() {
  console.log("🌱 Seeding reviews collection...\n");

  for (const review of reviews) {
    try {
      await addDocument("reviews", review);
      console.log(`✅ Review by ${review.author} — OK`);
    } catch (err) {
      console.error(`❌ Review by ${review.author} — ${err.message}`);
    }
  }

  console.log("\n✅ Done! Check Firestore Console > reviews");
}

seed().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
