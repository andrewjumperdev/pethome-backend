import "dotenv/config";
import mongoose from "mongoose";
import Review from "./models/Review.js";
import puppeteer from "puppeteer";

async function connectDB() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ MongoDB conectado");
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

async function fetchAndStoreReviews() {
  const url = process.env.ROVER_URL;
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

  // Aceptar cookies si aparece
  try {
    await page.waitForSelector("#onetrust-accept-btn-handler", { timeout: 5000 });
    await page.click("#onetrust-accept-btn-handler");
    console.log("🍪 Cookies aceptadas");
    await new Promise(r => setTimeout(r, 1000));
  } catch {
    console.log("🍪 Banner de cookies no encontrado");
  }

  // Esperar contenedor de reviews con múltiples selectores posibles
  const reviewsSelector = await Promise.race([
    page.waitForSelector("[data-testid='reviews-list']", { timeout: 15000 }).then(() => "[data-testid='reviews-list']"),
    page.waitForSelector("[data-testid='review-card']", { timeout: 15000 }).then(() => "[data-testid='review-card']"),
    page.waitForSelector(".review-card", { timeout: 15000 }).then(() => ".review-card"),
  ]).catch(() => null);

  if (!reviewsSelector) {
    // Debug: dump selectores disponibles para diagnosticar
    const html = await page.content();
    console.log("❌ No se encontró el contenedor de reviews.");
    console.log("🔍 Buscando posibles selectores...");
    const found = await page.evaluate(() => {
      const candidates = [
        "[data-testid]",
        "[class*='review']",
        "[class*='Review']",
        "[id*='review']",
      ];
      return candidates.map(sel => ({
        selector: sel,
        count: document.querySelectorAll(sel).length,
        sample: document.querySelector(sel)?.outerHTML?.slice(0, 200) || null,
      }));
    });
    console.log(JSON.stringify(found, null, 2));
    await browser.close();
    return;
  }

  console.log(`✅ Contenedor encontrado con selector: ${reviewsSelector}`);

  // Scroll para cargar todas las reseñas (lazy-load / infinite scroll)
  let prevCount = 0;
  for (let i = 0; i < 20; i++) {
    await autoScroll(page);
    await new Promise(r => setTimeout(r, 1500));

    const count = await page.evaluate((sel) => {
      return document.querySelectorAll(sel).length;
    }, reviewsSelector === "[data-testid='reviews-list']"
      ? "[data-testid='reviews-list'] > *"
      : reviewsSelector);

    console.log(`📜 Scroll ${i + 1}: ${count} elementos visibles`);
    if (count === prevCount) break;
    prevCount = count;

    // Buscar botón "cargar más" / "load more"
    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button, a"))
        .find(b => /load more|cargar más|ver más|show more|more reviews/i.test(b.textContent));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (clicked) {
      console.log("🔘 Botón 'cargar más' clickeado");
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Extraer reseñas usando múltiples estrategias de selector
  const reviews = await page.evaluate(() => {
    // Estrategia 1: data-testid="review-card"
    let cards = Array.from(document.querySelectorAll("[data-testid='review-card']"));

    // Estrategia 2: buscar por estructura semántica
    if (!cards.length) {
      cards = Array.from(document.querySelectorAll("[class*='ReviewCard'], [class*='review-card'], [class*='reviewCard']"));
    }

    // Estrategia 3: buscar dentro del contenedor de reviews
    if (!cards.length) {
      const container = document.querySelector("[data-testid='reviews-list']");
      if (container) cards = Array.from(container.children);
    }

    console.log(`Cards encontradas: ${cards.length}`);

    return cards.map(card => {
      // Autor: primer texto en negrita o span de nombre
      const authorEl =
        card.querySelector("[data-testid='reviewer-name']") ||
        card.querySelector("[class*='reviewerName'], [class*='reviewer-name']") ||
        card.querySelector("strong, b") ||
        card.querySelector("span:first-child");
      const author = authorEl?.textContent.trim() || "Anonymous";

      // Fecha: buscar por data-testid o texto con patrón de fecha
      const dateEl =
        card.querySelector("[data-testid='review-date']") ||
        card.querySelector("[class*='reviewDate'], [class*='review-date'], time");
      const dateRaw = dateEl?.getAttribute("datetime") || dateEl?.textContent.trim() || "";

      // Texto: párrafo de la reseña
      const textEl =
        card.querySelector("[data-testid='review-text']") ||
        card.querySelector("p, [class*='reviewText'], [class*='review-text']");
      const text = textEl?.textContent.trim() || "";

      // Rating: buscar estrellas
      const ratingEl =
        card.querySelector("[aria-label*='star'], [aria-label*='estrella']") ||
        card.querySelector("[data-testid='rating']");
      const ratingRaw = ratingEl?.getAttribute("aria-label") || "";
      const ratingMatch = ratingRaw.match(/(\d[\d.]*)/);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

      return { author, dateRaw, text, rating };
    }).filter(r => r.text.length > 0);
  });

  console.log(`📋 Reseñas extraídas: ${reviews.length}`);
  if (reviews.length > 0) {
    console.log("🔍 Muestra:", JSON.stringify(reviews[0], null, 2));
  }

  await browser.close();

  // Guardar en MongoDB
  let inserted = 0;
  for (const { author, dateRaw, text, rating } of reviews) {
    // Intentar parsear la fecha de múltiples formatos
    let date = null;
    if (dateRaw) {
      date = new Date(dateRaw);
      if (isNaN(date)) {
        // Formato "Month YYYY" en inglés/español
        const monthMap = {
          enero: "January", febrero: "February", marzo: "March",
          abril: "April", mayo: "May", junio: "June",
          julio: "July", agosto: "August", septiembre: "September",
          octubre: "October", noviembre: "November", diciembre: "December",
        };
        let normalized = dateRaw.toLowerCase();
        for (const [es, en] of Object.entries(monthMap)) {
          normalized = normalized.replace(es, en);
        }
        date = new Date(normalized);
      }
      if (isNaN(date)) date = null;
    }

    const res = await Review.updateOne(
      { author, text: text.slice(0, 100), sourceUrl: url },
      { $setOnInsert: { author, date, text, rating, sourceUrl: url } },
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
