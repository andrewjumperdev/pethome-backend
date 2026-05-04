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

  // Esperar contenedor de reviews
  const containerFound = await page
    .waitForSelector("[data-testid='reviews-list']", { timeout: 15000 })
    .catch(() => null);

  if (!containerFound) {
    console.log("❌ No se encontró [data-testid='reviews-list']");
    await browser.close();
    return;
  }

  console.log("✅ Contenedor de reviews encontrado");

  // Scroll hasta el contenedor para activar lazy load
  await page.evaluate(() => {
    document.querySelector("[data-testid='reviews-list']")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  await new Promise(r => setTimeout(r, 2000));

  // Scrollear DENTRO del contenedor de reviews para cargar todos
  // (Rover usa un scroll container interno para las reviews)
  let prevCount = 0;
  for (let i = 0; i < 30; i++) {
    // Intentar scroll dentro del contenedor de reviews primero
    const scrolled = await page.evaluate(() => {
      const container = document.querySelector("[data-testid='reviews-list']");
      if (!container) return false;

      // Buscar el elemento scrollable dentro del contenedor
      const scrollable = [container, ...Array.from(container.querySelectorAll("*"))]
        .find(el => el.scrollHeight > el.clientHeight && el.clientHeight > 100);

      if (scrollable && scrollable !== document.body) {
        scrollable.scrollBy(0, 600);
        return true;
      }
      return false;
    });

    // Si no hay scroll interno, scrollear la página completa
    if (!scrolled) {
      await page.evaluate(() => window.scrollBy(0, 600));
    }

    await new Promise(r => setTimeout(r, 1000));

    // Contar fechas de review en el DOM para medir progreso
    const count = await page.evaluate(() => {
      const matches = document.body.innerText.match(/•\s*[A-Za-z]+ \d{1,2},?\s*\d{4}/g);
      return matches ? matches.length : 0;
    });

    console.log(`📜 Scroll ${i + 1}: ${count} fechas de review en DOM`);
    if (count === prevCount && i > 3) break;
    prevCount = count;
  }

  // Extraer todas las reviews del texto del contenedor
  // Patrón en el DOM: "Nombre\nServicio • Mes DD, YYYY\n\nTexto de review"
  const reviews = await page.evaluate(() => {
    const container = document.querySelector("[data-testid='reviews-list']");
    if (!container) return [];

    const fullText = container.innerText || "";

    // Dividir por bloques: cada review empieza con un nombre seguido de "Servicio • Fecha"
    const lines = fullText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const results = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Detectar línea de "Servicio • Mes DD, YYYY"
      const dateLine = lines[i + 1] || "";
      const dateMatch = dateLine.match(/•\s*([A-Za-z]+\.?\s+\d{1,2},?\s*\d{4})/);

      if (dateMatch && line !== "Reseñas" && !line.startsWith("•")) {
        const author = line;
        const dateRaw = dateMatch[1].trim();

        // El texto de la review empieza después de la línea de fecha (puede haber línea vacía)
        let j = i + 2;
        const textLines = [];
        while (j < lines.length) {
          const nextLine = lines[j];
          // Parar si encontramos el siguiente autor (línea seguida de línea de fecha)
          const nextDateLine = lines[j + 1] || "";
          if (nextDateLine.match(/•\s*[A-Za-z]+\.?\s+\d{1,2},?\s*\d{4}/) && !nextLine.startsWith("•")) {
            break;
          }
          // Ignorar "Más información" (botón de expandir texto)
          if (/^más información$/i.test(nextLine)) {
            j++;
            continue;
          }
          textLines.push(nextLine);
          j++;
        }

        const text = textLines.join(" ").trim();
        if (text.length > 0) {
          results.push({ author, dateRaw, text, rating: null });
        }
        i = j;
      } else {
        i++;
      }
    }

    return results;
  });

  console.log(`📋 Reseñas extraídas: ${reviews.length}`);
  if (reviews.length > 0) {
    console.log("🔍 Muestra:", JSON.stringify(reviews[0], null, 2));
  }

  await browser.close();

  // Guardar en MongoDB
  const monthMap = {
    ene: "Jan", feb: "Feb", mar: "Mar", abr: "Apr", may: "May", jun: "Jun",
    jul: "Jul", ago: "Aug", sep: "Sep", oct: "Oct", nov: "Nov", dic: "Dec",
    enero: "January", febrero: "February", marzo: "March", abril: "April",
    mayo: "May", junio: "June", julio: "July", agosto: "August",
    septiembre: "September", octubre: "October", noviembre: "November", diciembre: "December",
    janv: "Jan", févr: "Feb", avr: "Apr", mai: "May", juin: "Jun",
    juil: "Jul", août: "Aug", sept: "Sep",
    janvier: "January", février: "February", mars: "March", avril: "April",
    juillet: "July", septembre: "September", octobre: "October",
    novembre: "November", décembre: "December",
  };

  function parseDate(dateRaw) {
    if (!dateRaw) return null;
    let date = new Date(dateRaw);
    if (!isNaN(date)) return date;

    let normalized = dateRaw.toLowerCase().replace(",", "");
    for (const [foreign, en] of Object.entries(monthMap)) {
      normalized = normalized.replace(new RegExp(`\\b${foreign}\\b`), en);
    }
    date = new Date(normalized);
    return isNaN(date) ? null : date;
  }

  let inserted = 0;
  for (const { author, dateRaw, text, rating } of reviews) {
    const date = parseDate(dateRaw);

    try {
      const res = await Review.updateOne(
        { author, text: text.slice(0, 150), sourceUrl: url },
        { $setOnInsert: { author, date, text, rating, sourceUrl: url } },
        { upsert: true }
      );
      if (res.upsertedCount) inserted++;
    } catch (err) {
      if (err.code === 11000) {
        // Duplicado por el índice único — la review ya existe, ignorar
      } else {
        throw err;
      }
    }
  }

  console.log(`🔖 ${inserted} nuevas reseñas guardadas (de ${reviews.length} extraídas).`);
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
