import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createPaymentIntent = async (req, res) => {
  try {
    const { amount, client_name, client_email, reserva } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    // Debug: imprimir todo lo que llega en la solicitud
    console.log("💡 Received request body:", req.body);

    const paymentData = req.body;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: paymentData.amount,
      currency: "eur",
      payment_method_types: ["card"], // declarar explícitamente
      metadata: {
        client_name: String(paymentData.client_name),
        client_email: String(paymentData.client_email),
        service: String(paymentData.service),
        quantity: String(paymentData.quantity),
        sizes: paymentData.sizes.join(", "),
        details: JSON.stringify(paymentData.details),
        start_date: String(paymentData.start_date),
        end_date: String(paymentData.end_date),
        arrival_time: String(paymentData.arrival_time),
        departure_time: String(paymentData.departure_time),
        isSterilized: String(paymentData.isSterilized),
      },
    });

    console.log("Metadata enviada:", paymentIntent.metadata);

    // Debug: imprimir el PaymentIntent creado
    console.log("✅ PaymentIntent created:", paymentIntent);

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("❌ Stripe error:", err);
    res.status(500).json({ error: "Erreur lors de la création du paiement." });
  }
};
