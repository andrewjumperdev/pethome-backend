import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Crear PaymentIntent para la tienda
export const createPaymentIntent = async (req, res) => {
  try {
    const { amount, currency = "eur", metadata = {} } = req.body;

    if (!amount || amount < 50) {
      return res.status(400).json({ error: "El monto minimo es 0.50 EUR" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        type: "store_purchase",
        ...metadata,
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({ error: "Error al crear pago" });
  }
};

// Webhook de Stripe para pagos de tienda
export const handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "payment_intent.succeeded":
      const paymentIntent = event.data.object;
      console.log(`Store payment succeeded: ${paymentIntent.id}`);

      // Si es una compra de tienda, crear orden en Printful
      if (paymentIntent.metadata?.type === "store_purchase") {
        // TODO: Integrar con Printful para crear orden automaticamente
        console.log("Store purchase completed, create Printful order");
      }
      break;

    case "payment_intent.payment_failed":
      const failedPayment = event.data.object;
      console.error(`Store payment failed: ${failedPayment.id}`);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
};

// Obtener estado de un pago
export const getPaymentStatus = async (req, res) => {
  try {
    const { paymentIntentId } = req.params;

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    res.json({
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    });
  } catch (error) {
    console.error("Error getting payment status:", error);
    res.status(500).json({ error: "Error al obtener estado del pago" });
  }
};

// Crear reembolso
export const createRefund = async (req, res) => {
  try {
    const { paymentIntentId, amount, reason } = req.body;

    const refundParams = {
      payment_intent: paymentIntentId,
      reason: reason || "requested_by_customer",
    };

    // Si se especifica un monto, hacer reembolso parcial
    if (amount) {
      refundParams.amount = Math.round(amount);
    }

    const refund = await stripe.refunds.create(refundParams);

    res.json({
      id: refund.id,
      status: refund.status,
      amount: refund.amount,
    });
  } catch (error) {
    console.error("Error creating refund:", error);
    res.status(500).json({ error: "Error al crear reembolso" });
  }
};
