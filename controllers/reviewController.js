import Review from "../models/Review.js";

export const getReviews = async (req, res) => {
  try {
    const reviews = await Review.find().sort({ date: -1 }).limit(100);
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: "Error leyendo reseñas" });
  }
};
