import "dotenv/config";
import mongoose from "mongoose";
import Review from "./models/Review.js";
import puppeteer from "puppeteer";

async function connectDB() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ MongoDB conectado");
}

async function fetchAndStoreReviews() {
  const url = process.env.ROVER_URL;
  // Lanzamos Chromium empaquetado, sin sandbox (necesario en contenedores)
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "networkidle2" });

  // Aceptar cookies si aparece
  try {
    await page.click("#onetrust-accept-btn-handler", { timeout: 5000 });
    console.log("🍪 Cookies aceptadas");
  } catch {
    console.log("🍪 Banner de cookies no encontrado");
  }

  // Esperar al contenedor de reviews
  await page.waitForSelector("[data-testid=\"reviews-list\"]", { timeout: 20000 });

  // Disparar “Leer más” si existe el botón
  await page.evaluate(() => {
    const container = document.querySelector("[data-testid=\"reviews-list\"]");
    if (!container) return;
    const btn = Array.from(container.querySelectorAll("button"))
      .find(b => /leer más|read more/i.test(b.innerText));
    if (btn) btn.click();
  });

  // Dejar un par de segundos para el lazy-load
  await new Promise(r => setTimeout(r, 2000));

  // Extraer reseñas
  const reviews = await page.evaluate(() => {
    const container = document.querySelector("[data-testid=\"reviews-list\"]");
    if (!container) return [];
    return Array.from(container.querySelectorAll("div.jBHkHc")).map(card => {
      const spans = card.querySelectorAll("span[data-element=\"StyledText\"]");
      const author = spans[0]?.textContent.trim() || "Anonymous";
      const [, dateRaw] = (spans[1]?.textContent || "").split("•").map(s => s.trim());
      const textEl = card.parentElement.querySelector("p[data-element=\"StyledParagraph\"]");
      const text   = textEl?.textContent.trim() || "";
      return { author, dateRaw, text };
    });
  });

  await browser.close();

  // Normalizar fechas y guardar
  let inserted = 0;
  for (const { author, dateRaw, text } of reviews) {
    const date = dateRaw ? new Date(dateRaw) : null;
    if (!date || isNaN(date)) continue;
    const res = await Review.updateOne(
      { author, date, sourceUrl: url },
      { $setOnInsert: { author, date, text, sourceUrl: url } },
      { upsert: true }
    );
    if (res.upsertedCount) inserted++;
  }

  console.log(`🔖 ${inserted} nuevas reseñas guardadas.`);
}

async function main() {
  await connectDB();
  await fetchAndStoreReviews();
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
