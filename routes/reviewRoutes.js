import express from "express";
import { getReviews } from "../controllers/reviewController.js";

const router = express.Router();

router.get("/", getReviews);

export default router;