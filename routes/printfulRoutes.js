import express from "express";
import {
  getProducts,
  getProductById,
  getShippingRates,
  createOrder,
  getOrderById,
  getOrders,
  handleWebhook,
} from "../controllers/printfulController.js";

const router = express.Router();

// Productos
router.get("/products", getProducts);
router.get("/products/:id", getProductById);

// Envio
router.post("/shipping/rates", getShippingRates);

// Ordenes
router.get("/orders", getOrders);
router.get("/orders/:id", getOrderById);
router.post("/orders", createOrder);

// Webhook
router.post("/webhook", handleWebhook);

export default router;
