# PetHome Backend

API backend para **PetHome / Maison pour Pets**, orientada a reservas, pagos y la tienda online. Integra Stripe, Firebase, Printful y Resend para cubrir el flujo completo de reservas, pagos y notificaciones.

## ✨ Características

- **Reservas** con verificación de disponibilidad, confirmación y cancelación con token seguro.
- **Pagos con Stripe** (reservas y tienda) y webhooks.
- **Tienda integrada con Printful** (productos, envíos, órdenes, webhook).
- **Emails transaccionales** con Resend.
- **Capacidad y calendario** con bloqueos temporales.
- **Seguridad**: rate limiting, sanitización y validación de origen.

## 🧰 Stack

- Node.js + Express
- MongoDB + Mongoose
- Stripe API
- Firebase Admin
- Resend
- Printful

## 📁 Estructura

```
.
├── controllers/     # Lógica de negocio
├── routes/          # Definición de endpoints
├── middleware/      # Seguridad y utilidades
├── config/          # Configuración (CORS, etc.)
├── models/          # Modelos de datos
├── server.js        # Arranque del API
└── scraper.js       # Scraper de reseñas
```

## ✅ Requisitos

- Node.js 18+
- MongoDB
- Cuenta/credenciales de Stripe, Firebase, Resend y Printful

## ⚙️ Configuración

1. Instala dependencias:

```bash
npm install
```

2. Crea tu archivo `.env` con las variables necesarias (puedes partir de `.env.example`).

3. Levanta el servidor:

```bash
npm start
```


## ▶️ Scripts

| Script | Descripción |
| --- | --- |
| `npm start` | Inicia el servidor (`server.js`) |
| `npm run scrape` | Ejecuta el scraper de reseñas (`scraper.js`) |

## 🔌 Endpoints principales

### Health check
- `GET /` → Estado del API

### Reviews
- `GET /reviews`

### Reservas (Bookings)
- `GET /api/bookings/cancel-policy`
- `GET /api/bookings/by-email/:email`
- `GET /api/bookings/:id?email=...`
- `POST /api/bookings/cancel`
- `POST /api/bookings/confirm` (admin)
- `POST /api/bookings/reject` (admin)

### Pagos de reserva (Stripe)
- `POST /payments/create-payment-intent`

### Capacidad
- `GET /api/capacity/check`
- `GET /api/capacity/calendar`
- `POST /api/capacity/reserve`
- `DELETE /api/capacity/reserve/:id`

### Emails
- `POST /api/email/booking-received`
- `POST /api/email/booking-confirmed`
- `POST /api/email/booking-rejected`
- `POST /api/email/booking-cancelled`

### Printful
- `GET /api/printful/products`
- `GET /api/printful/products/:id`
- `POST /api/printful/shipping/rates`
- `GET /api/printful/orders`
- `GET /api/printful/orders/:id`
- `POST /api/printful/orders`
- `POST /api/printful/webhook`

### Tienda (Stripe)
- `POST /api/store/create-payment-intent`
- `GET /api/store/payment/:paymentIntentId`
- `POST /api/store/refund` (admin)
- `POST /api/store/webhook`

## 🛡️ Seguridad

- Rate limiting global y específico para pagos.
- Sanitización de inputs contra XSS.
- Verificación de API Key y JWT para endpoints sensibles.
- Logs de seguridad en endpoints críticos.

## 🚀 Deployment

- Configura las variables de entorno del entorno productivo.
- Asegura `NODE_ENV=production`.
- Habilita HTTPS y configura CORS/Origin de forma adecuada.

## 📄 Licencia

Este proyecto se distribuye bajo la licencia **MIT**.
