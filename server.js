import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";

import { corsOptions } from "./config/corsOptions.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import printfulRoutes from "./routes/printfulRoutes.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors(corsOptions));
app.use(express.json());

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB conectado (API)"))
  .catch((err) => console.error("❌ Error conectando a MongoDB:", err));

app.get("/", (req, res) => {
  res.send("🚉 API PetHome en ligne");
});
app.use("/reviews", reviewRoutes);
app.use("/payments", paymentRoutes);
app.use("/api/printful", printfulRoutes);

app.listen(PORT, () => {
  console.log(`🚀 API escuchando en http://localhost:${PORT}`);
});
