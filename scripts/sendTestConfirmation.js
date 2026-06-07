import "dotenv/config";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || "Maison pour Pets <reservations@maisonpourpets.com>";

const TEST_RECIPIENT = "justineduru1994@gmail.com";
const bookingId = "TEST-001";

const booking = {
  contact: {
    name: "JEAN-BAPTISTE SÉE",
    email: "jbgdb13@gmail.com",
    phone: "0651801342",
  },
  details: [{ name: "Vito", breed: "Shiba", age: "2" }],
  startDate: "2026-07-17",
  endDate: "2026-08-08",
  arrivalTime: "19:30",
  departureTime: "15:00",
  serviceId: "sejour",
  quantity: 1,
  total: 455.40,
  notes: null,
};

const SERVICE_LABELS = {
  boarding: "Pension (hébergement)",
  daycare: "Garderie de jour",
  walking: "Promenade",
  grooming: "Toilettage",
  sejour: "Séjour",
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function emailRow(label, value, valueStyle = "") {
  if (!value) return "";
  return `<tr>
    <td style="color:#666;font-size:13px;width:45%;padding:6px 0;">${label}</td>
    <td style="color:#333;font-size:13px;font-weight:600;padding:6px 0;${valueStyle}">${value}</td>
  </tr>`;
}

function buildPetSummary(details, bk) {
  const pets = details.length > 0 ? details : bk.petName ? [{ name: bk.petName }] : [{ name: "votre animal" }];
  return pets.map(p => {
    const parts = [p.name];
    if (p.breed) parts.push(p.breed);
    if (p.type || p.species) parts.push(p.type || p.species);
    if (p.age) parts.push(`${p.age} ans`);
    return parts.join(" · ");
  }).join(", ");
}

const details = booking.details || [];
const clientName = booking.contact?.name || "Client";
const clientEmail = booking.contact?.email || "";
const clientPhone = booking.contact?.phone || null;
const startDate = formatDate(booking.startDate);
const endDate = formatDate(booking.endDate);
const total = (booking.total || 0).toFixed(2);
const arrivalTime = booking.arrivalTime || null;
const departureTime = booking.departureTime || null;
const serviceLabel = SERVICE_LABELS[booking.serviceId] || booking.serviceId || null;
const quantity = Number(booking.quantity) > 1 ? `${booking.quantity} animaux` : null;
const notes = booking.notes || null;
const petSummary = buildPetSummary(details, booking);

const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:48px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10);">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#2e7d32 0%,#43a047 60%,#66bb6a 100%);padding:48px 40px 40px;text-align:center;">
            <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:50%;width:64px;height:64px;line-height:64px;font-size:32px;margin-bottom:16px;">🐾</div>
            <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Réservation Confirmée ✅</h1>
            <p style="color:rgba(255,255,255,0.80);margin:10px 0 0;font-size:14px;letter-spacing:1px;text-transform:uppercase;">Maison pour Pets</p>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:40px 40px 32px;">

            <p style="font-size:17px;color:#1a1a1a;margin:0 0 8px;font-weight:600;">Bonjour ${clientName},</p>
            <p style="font-size:15px;color:#555;margin:0 0 32px;line-height:1.7;">
              Nous avons le plaisir de vous confirmer votre réservation.<br>
              Nous vous remercions pour votre confiance et avons hâte d'accueillir votre boule d'amour pour lui faire passer un merveilleux séjour à nos côtés.
            </p>

            <!-- BOOKING DETAILS CARD -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;overflow:hidden;margin-bottom:24px;border:1px solid #e8f5e9;">
              <tr>
                <td style="background:#2e7d32;padding:14px 20px;">
                  <span style="color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Détails de la réservation</span>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;background:#fafffe;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    ${emailRow("🐶 Animal(aux)", petSummary)}
                    ${quantity ? emailRow("🔢 Nombre", quantity) : ""}
                    ${serviceLabel ? emailRow("🏠 Service", serviceLabel) : ""}
                    ${emailRow("📅 Arrivée", arrivalTime ? `${startDate} à ${arrivalTime}` : startDate)}
                    ${emailRow("📅 Départ", departureTime ? `${endDate} à ${departureTime}` : endDate)}
                    <tr><td colspan="2" style="padding:8px 0;"><hr style="border:none;border-top:1px solid #e0e0e0;margin:4px 0;"></td></tr>
                    <tr>
                      <td style="padding:8px 0;font-size:13px;color:#666;width:45%;">📍 Notre adresse</td>
                      <td style="padding:8px 0;font-size:13px;color:#333;font-weight:600;">15 rue Prosper Legouté, 92160 Antony</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;font-size:13px;color:#666;">📞 Contact</td>
                      <td style="padding:8px 0;font-size:13px;color:#333;font-weight:600;">06 19 73 85 90</td>
                    </tr>
                    <tr><td colspan="2" style="padding:8px 0;"><hr style="border:none;border-top:1px solid #e0e0e0;margin:4px 0;"></td></tr>
                    ${emailRow("💶 Montant", `${total} €`, "color:#2e7d32;font-size:17px;font-weight:700;")}
                  </table>
                </td>
              </tr>
            </table>

            ${clientPhone ? `
            <!-- CONTACT CARD -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;overflow:hidden;margin-bottom:24px;border:1px solid #e3f0ff;">
              <tr>
                <td style="background:#1565c0;padding:14px 20px;">
                  <span style="color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Vos coordonnées enregistrées</span>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;background:#f7fbff;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    ${emailRow("📱 Téléphone", clientPhone)}
                    ${emailRow("✉️ Email", clientEmail)}
                  </table>
                </td>
              </tr>
            </table>
            ` : ""}

            ${notes ? `
            <!-- NOTES CARD -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;overflow:hidden;margin-bottom:24px;border:1px solid #ffe082;">
              <tr>
                <td style="background:#f9a825;padding:14px 20px;">
                  <span style="color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Notes transmises</span>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;background:#fffdf0;">
                  <p style="color:#555;margin:0;font-size:14px;line-height:1.7;">${notes}</p>
                </td>
              </tr>
            </table>
            ` : ""}

            <!-- CHECKLIST CARD -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;overflow:hidden;margin-bottom:32px;border:1px solid #c8e6c9;">
              <tr>
                <td style="background:#43a047;padding:14px 20px;">
                  <span style="color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">À prévoir pour l'arrivée</span>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;background:#f9fef9;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr><td style="padding:6px 0;font-size:14px;color:#444;line-height:1.6;">✅&nbsp; Carnet de santé / vaccinations à jour</td></tr>
                    <tr><td style="padding:6px 0;font-size:14px;color:#444;line-height:1.6;">✅&nbsp; Nourriture habituelle (si régime particulier)</td></tr>
                    <tr><td style="padding:6px 0;font-size:14px;color:#444;line-height:1.6;">✅&nbsp; Un objet familier (jouet, couverture)</td></tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="font-size:14px;color:#777;margin:0 0 20px;line-height:1.7;">
              Pour toute question, répondez simplement à cet email. Nous vous répondrons dans les meilleurs délais.
            </p>
            <p style="font-size:15px;color:#333;margin:0;">
              À très bientôt !<br>
              <strong style="color:#2e7d32;">L'équipe Maison pour Pets</strong>
            </p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#f7f7f7;padding:24px 40px;text-align:center;border-top:1px solid #eeeeee;">
            <p style="color:#aaa;font-size:12px;margin:0;line-height:1.8;">
              Maison pour Pets &nbsp;·&nbsp; <a href="https://maisonpourpets.com" style="color:#2e7d32;text-decoration:none;">maisonpourpets.com</a><br>
              Cet email a été envoyé à ${clientEmail} suite à votre réservation.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

const result = await resend.emails.send({
  from: FROM_EMAIL,
  to: [TEST_RECIPIENT],
  subject: `✅ Réservation confirmée #${bookingId} — Maison pour Pets`,
  html,
});

if (result.error) {
  console.error("Error:", result.error);
} else {
  console.log(`Email enviado a ${TEST_RECIPIENT} — id: ${result.data?.id}`);
}
