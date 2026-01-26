import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";

// Rate limiter general - 100 requests por 15 minutos
export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Demasiadas solicitudes, intenta de nuevo en 15 minutos" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter estricto para pagos - 10 requests por hora
export const paymentRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Demasiados intentos de pago, intenta de nuevo en 1 hora" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware para verificar API Key de admin
export const requireAdminApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "API Key invalida o no proporcionada" });
  }

  next();
};

// Middleware para verificar JWT token
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Token invalido o expirado" });
  }
};

// Verificar token de cancelacion
export const verifyCancellationToken = (req, res, next) => {
  const { token } = req.body;

  if (!token) {
    return res.status(401).json({ error: "Token de cancelacion requerido" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.cancellation = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Token de cancelacion invalido o expirado" });
  }
};

// Generar token de cancelacion (expira en 7 dias)
export const generateCancellationToken = (bookingId, email) => {
  return jwt.sign(
    { bookingId, email, type: "cancellation" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

// Security logger - registra accesos a endpoints sensibles
export const securityLogger = (req, res, next) => {
  const sensitiveEndpoints = ["/api/bookings/confirm", "/api/bookings/reject", "/api/store/webhook"];

  if (sensitiveEndpoints.some(endpoint => req.path.includes(endpoint))) {
    console.log(`[SECURITY] ${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip}`);
  }

  next();
};

// Sanitizar input (prevenir XSS)
export const sanitizeInput = (obj) => {
  if (typeof obj === "string") {
    return obj.replace(/<[^>]*>/g, "").trim();
  }

  if (typeof obj === "object" && obj !== null) {
    const sanitized = {};
    for (const key in obj) {
      sanitized[key] = sanitizeInput(obj[key]);
    }
    return sanitized;
  }

  return obj;
};

// Middleware de sanitizacion
export const sanitizeMiddleware = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeInput(req.body);
  }
  next();
};

// Validar origen (CORS adicional)
export const validateOrigin = (allowedOrigins = []) => {
  const defaultOrigins = [
    process.env.SITE_URL,
    "http://localhost:5173",
    "http://localhost:3000"
  ].filter(Boolean);

  const origins = [...defaultOrigins, ...allowedOrigins];

  return (req, res, next) => {
    const origin = req.headers.origin;

    // Permitir requests sin origin (Postman, curl, etc en desarrollo)
    if (!origin || process.env.NODE_ENV === "development") {
      return next();
    }

    if (origins.includes(origin)) {
      return next();
    }

    console.warn(`[SECURITY] Origen bloqueado: ${origin}`);
    return res.status(403).json({ error: "Origen no permitido" });
  };
};

// Verificar si email es admin
export const isAdminEmail = (email) => {
  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase());
  return adminEmails.includes(email?.toLowerCase());
};
