import Stripe from "stripe";
import axios from "axios";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Cliente de Printful
const printfulApi = axios.create({
  baseURL: "https://api.printful.com",
  headers: {
    Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
    "Content-Type": "application/json",
    "X-PF-Store-Id": process.env.PRINTFUL_STORE_ID,
  },
  timeout: 30000,
});

// Crear PaymentIntent para la tienda
export const createPaymentIntent = async (req, res) => {
  try {
    const { amount, currency = "eur", metadata = {}, orderData } = req.body;

    if (!amount || amount < 50) {
      return res.status(400).json({ error: "El monto minimo es 0.50 EUR" });
    }

    // Guardar datos del pedido en metadata para el webhook
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        type: "store_purchase",
        // Datos del cliente
        customer_email: metadata.customer_email || "",
        customer_name: metadata.customer_name || "",
        customer_phone: metadata.customer_phone || "",
        // Dirección de envío (serializada)
        shipping_address: orderData?.shipping ? JSON.stringify(orderData.shipping) : "",
        // Items del carrito (serializado)
        cart_items: orderData?.items ? JSON.stringify(orderData.items) : "",
        // Costos
        shipping_rate: metadata.shipping_rate || "",
        subtotal: metadata.subtotal || "",
        shipping_cost: metadata.shipping_cost || "",
        tax: metadata.tax || "",
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
        try {
          await createPrintfulOrderFromPayment(paymentIntent);
        } catch (error) {
          console.error("Error creating Printful order from webhook:", error);
          // No fallamos el webhook, pero logueamos el error
        }
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

// Crear orden en Printful desde datos del PaymentIntent
async function createPrintfulOrderFromPayment(paymentIntent) {
  const { metadata } = paymentIntent;

  // Verificar que tenemos los datos necesarios
  if (!metadata.shipping_address || !metadata.cart_items) {
    console.log("Missing order data in payment metadata, skipping auto-order");
    return null;
  }

  try {
    const shipping = JSON.parse(metadata.shipping_address);
    const items = JSON.parse(metadata.cart_items);

    const orderData = {
      recipient: {
        name: metadata.customer_name,
        address1: shipping.address1,
        address2: shipping.address2 || "",
        city: shipping.city,
        state_code: shipping.stateCode || "",
        country_code: shipping.countryCode,
        zip: shipping.zip,
        phone: metadata.customer_phone,
        email: metadata.customer_email,
      },
      items: items.map((item) => ({
        sync_variant_id: item.syncVariantId,
        quantity: item.quantity,
      })),
      retail_costs: {
        subtotal: metadata.subtotal,
        shipping: metadata.shipping_cost,
        tax: metadata.tax,
      },
      external_id: paymentIntent.id,
    };

    // Crear orden en Printful
    const response = await printfulApi.post("/orders", orderData);
    const orderId = response.data.result.id;

    // Confirmar orden para enviar a producción
    const confirmResponse = await printfulApi.post(`/orders/${orderId}/confirm`);
    console.log(`Printful order ${orderId} created and confirmed from webhook`);

    return confirmResponse.data;
  } catch (error) {
    console.error("Error in createPrintfulOrderFromPayment:", error.response?.data || error.message);
    throw error;
  }
}

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
