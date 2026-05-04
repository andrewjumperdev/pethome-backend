const allowedOrigins = [
  "http://localhost:5173",
  "https://maisonpourpets.com",
  "https://www.maisonpourpets.com",
  "https://andrewjumperdev.github.io",
];

export const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};