import { Resend } from "resend";

// Inicializacion lazy de Resend
let resend = null;
const getResend = () => {
  if (resend) return resend;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("YOUR_RESEND_API_KEY")) {
    return null;
  }

  resend = new Resend(apiKey);
  return resend;
};

const FROM_EMAIL = process.env.FROM_EMAIL || "Maison pour Pets <noreply@maisonpourpets.com>";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@maisonpourpets.com";
const SITE_URL = process.env.SITE_URL || "https://maisonpourpets.com";

// Middleware para verificar que Resend esta configurado
export const requireResend = (req, res, next) => {
  const client = getResend();
  if (!client) {
    return res.status(503).json({
      error: "Servicio de email no disponible",
      message: "Resend API no esta configurado. Agrega RESEND_API_KEY en .env"
    });
  }
  req.resend = client;
  next();
};

// Template base HTML
const baseTemplate = (content) => `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Maison pour Pets</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #8B4513 0%, #D2691E 100%); padding: 30px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 28px;">Maison pour Pets</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">Cuidado con amor para tu mascota</p>
    </div>

    <!-- Content -->
    <div style="padding: 30px;">
      ${content}
    </div>

    <!-- Footer -->
    <div style="background-color: #f8f8f8; padding: 20px; text-align: center; border-top: 1px solid #eee;">
      <p style="margin: 0; color: #666; font-size: 12px;">
        Maison pour Pets - Paris, France<br>
        <a href="${SITE_URL}" style="color: #8B4513;">maisonpourpets.com</a>
      </p>
    </div>
  </div>
</body>
</html>
`;

// Formatear fecha
const formatDate = (dateStr) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

// Formatear precio
const formatPrice = (price) => {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(price);
};

// Email: Solicitud de reserva recibida
export const sendBookingReceived = async (req, res) => {
  try {
    const { booking } = req.body;

    if (!booking || !booking.email) {
      return res.status(400).json({ error: "Datos de reserva invalidos" });
    }

    // Email al cliente
    const clientContent = `
      <h2 style="color: #333; margin-top: 0;">Hemos recibido tu solicitud</h2>
      <p style="color: #666; line-height: 1.6;">
        Gracias por confiar en nosotros para el cuidado de <strong>${booking.petName}</strong>.
        Tu solicitud esta siendo revisada y te confirmaremos en las proximas 24 horas.
      </p>

      <div style="background-color: #f9f9f9; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #8B4513;">Detalles de tu reserva</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666;">Mascota:</td>
            <td style="padding: 8px 0; color: #333; font-weight: 500;">${booking.petName} (${booking.petType})</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Llegada:</td>
            <td style="padding: 8px 0; color: #333; font-weight: 500;">${formatDate(booking.startDate)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Salida:</td>
            <td style="padding: 8px 0; color: #333; font-weight: 500;">${formatDate(booking.endDate)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Total:</td>
            <td style="padding: 8px 0; color: #8B4513; font-weight: bold; font-size: 18px;">${formatPrice(booking.totalPrice)}</td>
          </tr>
        </table>
      </div>

      <p style="color: #666; font-size: 14px;">
        <strong>Nota:</strong> El pago se procesara una vez confirmemos la disponibilidad.
      </p>
    `;

    await req.resend.emails.send({
      from: FROM_EMAIL,
      to: booking.email,
      subject: `Solicitud recibida - ${booking.petName}`,
      html: baseTemplate(clientContent),
    });

    // Email al admin
    const adminContent = `
      <h2 style="color: #333; margin-top: 0;">Nueva solicitud de reserva</h2>

      <div style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
        <strong>Accion requerida:</strong> Revisar y confirmar/rechazar esta reserva
      </div>

      <div style="background-color: #f9f9f9; border-radius: 8px; padding: 20px;">
        <h3 style="margin-top: 0; color: #8B4513;">Datos del cliente</h3>
        <p><strong>Nombre:</strong> ${booking.ownerName || booking.name}</p>
        <p><strong>Email:</strong> ${booking.email}</p>
        <p><strong>Telefono:</strong> ${booking.phone || "No proporcionado"}</p>

        <h3 style="color: #8B4513;">Datos de la mascota</h3>
        <p><strong>Nombre:</strong> ${booking.petName}</p>
        <p><strong>Tipo:</strong> ${booking.petType}</p>
        <p><strong>Raza:</strong> ${booking.breed || "No especificada"}</p>
        ${booking.specialNeeds ? `<p><strong>Necesidades especiales:</strong> ${booking.specialNeeds}</p>` : ""}

        <h3 style="color: #8B4513;">Fechas</h3>
        <p><strong>Llegada:</strong> ${formatDate(booking.startDate)}</p>
        <p><strong>Salida:</strong> ${formatDate(booking.endDate)}</p>
        <p><strong>Total:</strong> ${formatPrice(booking.totalPrice)}</p>
      </div>
    `;

    await req.resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `[NUEVA RESERVA] ${booking.petName} - ${formatDate(booking.startDate)}`,
      html: baseTemplate(adminContent),
    });

    res.json({ success: true, message: "Emails enviados" });
  } catch (error) {
    console.error("Error sending booking received email:", error);
    res.status(500).json({ error: "Error al enviar emails" });
  }
};

// Email: Reserva confirmada
export const sendBookingConfirmed = async (req, res) => {
  try {
    const { booking, cancellationUrl } = req.body;

    if (!booking || !booking.email) {
      return res.status(400).json({ error: "Datos de reserva invalidos" });
    }

    const content = `
      <div style="text-align: center; margin-bottom: 30px;">
        <div style="background-color: #d4edda; border-radius: 50%; width: 60px; height: 60px; margin: 0 auto; display: flex; align-items: center; justify-content: center;">
          <span style="color: #28a745; font-size: 30px;">&#10003;</span>
        </div>
      </div>

      <h2 style="color: #28a745; text-align: center; margin-top: 0;">Reserva Confirmada</h2>

      <p style="color: #666; line-height: 1.6; text-align: center;">
        Tu reserva para <strong>${booking.petName}</strong> ha sido confirmada.
        El pago ha sido procesado exitosamente.
      </p>

      <div style="background-color: #f9f9f9; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #8B4513;">Detalles de tu estancia</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666;">Mascota:</td>
            <td style="padding: 8px 0; color: #333; font-weight: 500;">${booking.petName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Check-in:</td>
            <td style="padding: 8px 0; color: #333; font-weight: 500;">${formatDate(booking.startDate)} a las 14:00</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Check-out:</td>
            <td style="padding: 8px 0; color: #333; font-weight: 500;">${formatDate(booking.endDate)} a las 11:00</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Total pagado:</td>
            <td style="padding: 8px 0; color: #28a745; font-weight: bold;">${formatPrice(booking.totalPrice)}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #e8f4fd; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="margin: 0 0 10px 0; color: #0066cc;">Que traer:</h4>
        <ul style="margin: 0; padding-left: 20px; color: #666;">
          <li>Cartilla de vacunacion actualizada</li>
          <li>Su comida habitual (si tiene dieta especial)</li>
          <li>Objeto familiar (manta, juguete)</li>
        </ul>
      </div>

      ${cancellationUrl ? `
      <p style="text-align: center; margin-top: 30px;">
        <a href="${cancellationUrl}" style="color: #999; font-size: 12px;">
          ¿Necesitas cancelar? Haz clic aqui
        </a>
      </p>
      ` : ""}
    `;

    await req.resend.emails.send({
      from: FROM_EMAIL,
      to: booking.email,
      subject: `Confirmacion de reserva - ${booking.petName}`,
      html: baseTemplate(content),
    });

    res.json({ success: true, message: "Email de confirmacion enviado" });
  } catch (error) {
    console.error("Error sending booking confirmed email:", error);
    res.status(500).json({ error: "Error al enviar email" });
  }
};

// Email: Reserva rechazada
export const sendBookingRejected = async (req, res) => {
  try {
    const { booking, reason } = req.body;

    if (!booking || !booking.email) {
      return res.status(400).json({ error: "Datos de reserva invalidos" });
    }

    const content = `
      <h2 style="color: #dc3545; margin-top: 0;">Lo sentimos</h2>

      <p style="color: #666; line-height: 1.6;">
        Lamentamos informarte que no podemos confirmar tu reserva para
        <strong>${booking.petName}</strong> en las fechas solicitadas.
      </p>

      ${reason ? `
      <div style="background-color: #f8f9fa; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0;">
        <p style="margin: 0; color: #666;"><strong>Motivo:</strong> ${reason}</p>
      </div>
      ` : ""}

      <p style="color: #666; line-height: 1.6;">
        No se ha realizado ningun cargo a tu tarjeta.
      </p>

      <div style="text-align: center; margin-top: 30px;">
        <a href="${SITE_URL}/reservar" style="display: inline-block; background: linear-gradient(135deg, #8B4513 0%, #D2691E 100%); color: white; text-decoration: none; padding: 12px 30px; border-radius: 25px; font-weight: 500;">
          Buscar otras fechas
        </a>
      </div>

      <p style="color: #999; font-size: 14px; text-align: center; margin-top: 30px;">
        Si tienes preguntas, no dudes en contactarnos.
      </p>
    `;

    await req.resend.emails.send({
      from: FROM_EMAIL,
      to: booking.email,
      subject: `Actualizacion sobre tu reserva - ${booking.petName}`,
      html: baseTemplate(content),
    });

    res.json({ success: true, message: "Email de rechazo enviado" });
  } catch (error) {
    console.error("Error sending booking rejected email:", error);
    res.status(500).json({ error: "Error al enviar email" });
  }
};

// Email: Reserva cancelada
export const sendBookingCancelled = async (req, res) => {
  try {
    const { booking, refund } = req.body;

    if (!booking || !booking.email) {
      return res.status(400).json({ error: "Datos de reserva invalidos" });
    }

    const content = `
      <h2 style="color: #6c757d; margin-top: 0;">Reserva Cancelada</h2>

      <p style="color: #666; line-height: 1.6;">
        Tu reserva para <strong>${booking.petName}</strong> ha sido cancelada exitosamente.
      </p>

      <div style="background-color: #f9f9f9; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #8B4513;">Detalles de la cancelacion</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666;">Fechas canceladas:</td>
            <td style="padding: 8px 0; color: #333;">${formatDate(booking.startDate)} - ${formatDate(booking.endDate)}</td>
          </tr>
          ${refund ? `
          <tr>
            <td style="padding: 8px 0; color: #666;">Reembolso:</td>
            <td style="padding: 8px 0; color: #28a745; font-weight: bold;">${formatPrice(refund.amount)} (${refund.percentage}%)</td>
          </tr>
          ` : ""}
        </table>
      </div>

      ${refund && refund.amount > 0 ? `
      <div style="background-color: #d4edda; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <p style="margin: 0; color: #155724;">
          <strong>Reembolso en proceso:</strong> El reembolso de ${formatPrice(refund.amount)}
          aparecera en tu cuenta en 5-10 dias habiles.
        </p>
      </div>
      ` : ""}

      <div style="text-align: center; margin-top: 30px;">
        <p style="color: #666;">Esperamos verte pronto</p>
        <a href="${SITE_URL}/reservar" style="display: inline-block; background: linear-gradient(135deg, #8B4513 0%, #D2691E 100%); color: white; text-decoration: none; padding: 12px 30px; border-radius: 25px; font-weight: 500;">
          Hacer nueva reserva
        </a>
      </div>
    `;

    await req.resend.emails.send({
      from: FROM_EMAIL,
      to: booking.email,
      subject: `Cancelacion confirmada - ${booking.petName}`,
      html: baseTemplate(content),
    });

    res.json({ success: true, message: "Email de cancelacion enviado" });
  } catch (error) {
    console.error("Error sending booking cancelled email:", error);
    res.status(500).json({ error: "Error al enviar email" });
  }
};
