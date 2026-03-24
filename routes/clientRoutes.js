import express from "express";
import {
  lookupClient,
  upsertClient,
  requireFirebase,
} from "../controllers/clientController.js";

const router = express.Router();

router.get("/lookup", requireFirebase, lookupClient);
router.post("/upsert", requireFirebase, upsertClient);

export default router;
