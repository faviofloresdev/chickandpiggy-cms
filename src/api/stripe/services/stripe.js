const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = ({ strapi }) => ({
  async createCheckoutSession(items) {

    let total = 0;
    const line_items = [];

    // 1. crear order primero
    const order = await strapi.entityService.create(
      "api::order.order",
      {
        data: {
          status: "pending",
          total: 0,
        },
      }
    );

    // 2. procesar items
    for (const item of items) {

      const product = await strapi.entityService.findOne(
        "api::product.product",
        item.productId
      );

      if (!product) {
        throw new Error("Product not found");
      }

      if (product.stock < item.quantity) {
        throw new Error("Not enough stock");
      }

      const price = product.price;

      total += price * item.quantity;

      // crear order item
      await strapi.entityService.create(
        "api::order-item.order-item",
        {
          data: {
            quantity: item.quantity,
            price,
            productName: product.name,
            order: order.id,
            product: product.id,
          },
        }
      );

      line_items.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: product.name,
          },
          unit_amount: Math.round(price * 100),
        },
        quantity: item.quantity,
      });
    }

    // 3. actualizar total order
    await strapi.entityService.update(
      "api::order.order",
      order.id,
      {
        data: {
          total,
        },
      }
    );

    // 4. stripe session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,

      metadata: {
        orderId: order.id,
      },

      success_url: `${process.env.CLIENT_URL}/success`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
    });

    return session;
  },
});