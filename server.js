import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";

import { corsOptions } from "./config/corsOptions.js";
import { rateLimiter, securityLogger, sanitizeMiddleware } from "./middleware/auth.js";

// Routes
import reviewRoutes from "./routes/reviewRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import printfulRoutes from "./routes/printfulRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import capacityRoutes from "./routes/capacityRoutes.js";
import emailRoutes from "./routes/emailRoutes.js";
import storeRoutes from "./routes/storeRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import promoRoutes from "./routes/promoRoutes.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware global
app.use(cors(corsOptions));
app.use(rateLimiter);
app.use(securityLogger);

// JSON parser — skip for Stripe webhook routes that need the raw body for signature verification
app.use((req, res, next) => {
  if (
    req.originalUrl === "/api/store/webhook" ||
    req.originalUrl === "/payments/webhook"
  ) {
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

app.use(sanitizeMiddleware);

// MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB conectado (API)"))
  .catch((err) => console.error("Error conectando a MongoDB:", err));

// Health check
app.get("/", (req, res) => {
  res.send("API PetHome en ligne");
});

// Routes existentes
app.use("/reviews", reviewRoutes);
app.use("/payments", paymentRoutes);

// Nuevas routes
app.use("/api/printful", printfulRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/capacity", capacityRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/store", storeRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/promo", promoRoutes);

app.listen(PORT, () => {
  console.log(`API escuchando en http://localhost:${PORT}`);
});
