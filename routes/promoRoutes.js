import express from "express";
import {
  validatePromo,
  getQuote,
  markPromoUsed,
  requireFirebase,
} from "../controllers/promoController.js";

const router = express.Router();

router.post("/validate", requireFirebase, validatePromo);
router.post("/quote", requireFirebase, getQuote);
router.post("/mark-used", requireFirebase, markPromoUsed);

export default router;
