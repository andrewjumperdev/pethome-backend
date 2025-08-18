import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  author:    String,
  date:      Date,
  text:      String,
  sourceUrl: String
}, { timestamps: true });

reviewSchema.index({ author: 1, date: 1, sourceUrl: 1 }, { unique: true });

export default mongoose.model('Review', reviewSchema);
