import axios from "axios";

// Cliente de Printful configurado
const printfulApi = axios.create({
  baseURL: "https://api.printful.com",
  headers: {
    Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
    "Content-Type": "application/json",
    "X-PF-Store-Id": process.env.PRINTFUL_STORE_ID,
  },
  timeout: 30000,
});

// Obtener todos los productos
export const getProducts = async (req, res) => {
  try {
    const response = await printfulApi.get("/store/products");
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching products:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: "Error al obtener productos",
      details: error.response?.data?.error?.message || error.message,
    });
  }
};

// Obtener producto por ID con variantes
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const response = await printfulApi.get(`/store/products/${id}`);
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching product ${req.params.id}:`, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: "Error al obtener producto",
      details: error.response?.data?.error?.message || error.message,
    });
  }
};

// Calcular tarifas de envio
export const getShippingRates = async (req, res) => {
  try {
    const { recipient, items } = req.body;

    if (!recipient || !items || items.length === 0) {
      return res.status(400).json({ error: "Se requiere recipient y items" });
    }

    const response = await printfulApi.post("/shipping/rates", { recipient, items });
    res.json(response.data);
  } catch (error) {
    console.error("Error calculating shipping:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: "Error al calcular envio",
      details: error.response?.data?.error?.message || error.message,
    });
  }
};

// Crear orden
export const createOrder = async (req, res) => {
  try {
    const { recipient, items, retail_costs, paymentIntentId } = req.body;

    if (!recipient || !items || items.length === 0) {
      return res.status(400).json({ error: "Se requiere recipient y items" });
    }

    const orderData = {
      recipient,
      items,
      retail_costs,
      external_id: paymentIntentId,
    };

    const response = await printfulApi.post("/orders", orderData);
    const orderId = response.data.result.id;

    // Confirmar orden para produccion
    const confirmResponse = await printfulApi.post(`/orders/${orderId}/confirm`);
    console.log(`Order ${orderId} created and confirmed`);

    res.json(confirmResponse.data);
  } catch (error) {
    console.error("Error creating order:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: "Error al crear orden",
      details: error.response?.data?.error?.message || error.message,
    });
  }
};

// Obtener orden por ID
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const response = await printfulApi.get(`/orders/${id}`);
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching order ${req.params.id}:`, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: "Error al obtener orden",
      details: error.response?.data?.error?.message || error.message,
    });
  }
};

// Listar ordenes
export const getOrders = async (req, res) => {
  try {
    const { status, offset = 0, limit = 20 } = req.query;
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    params.append("offset", offset);
    params.append("limit", limit);

    const response = await printfulApi.get(`/orders?${params.toString()}`);
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching orders:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: "Error al obtener ordenes",
      details: error.response?.data?.error?.message || error.message,
    });
  }
};

// Webhook de Printful
export const handleWebhook = async (req, res) => {
  try {
    const { type, data } = req.body;
    console.log(`Printful webhook: ${type}`);

    switch (type) {
      case "package_shipped":
        console.log(`Order ${data.order.id} shipped - Tracking: ${data.shipment.tracking_number}`);
        // TODO: Enviar email al cliente con tracking
        break;
      case "order_failed":
        console.log(`Order ${data.order.id} failed`);
        // TODO: Notificar al admin
        break;
      default:
        console.log(`Webhook type: ${type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error.message);
    res.status(500).json({ error: "Error procesando webhook" });
  }
};
