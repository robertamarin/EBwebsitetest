// ============================================
// ETHEREAL BALANCE - FIREBASE CLOUD FUNCTIONS
// ============================================
// Handles: Stripe Checkout Session creation, Stripe webhooks, order processing
//
// SETUP:
// 1. firebase functions:config:set stripe.secret_key="sk_live_xxx"
// 2. firebase functions:config:set stripe.webhook_secret="whsec_xxx"
// 3. firebase functions:config:set gmail.email="you@gmail.com" gmail.app_password="xxxx xxxx xxxx xxxx"
// 4. firebase deploy --only functions
// ============================================

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors");

admin.initializeApp();
const db = admin.firestore();

// Initialize Stripe with secret key from Firebase config
const stripe = require("stripe")(functions.config().stripe.secret_key);

// Initialize Nodemailer with Gmail
// Config set via: firebase functions:config:set gmail.email="you@gmail.com" gmail.app_password="xxxx xxxx xxxx xxxx"
const nodemailer = require("nodemailer");
const gmailConfig = functions.config().gmail || {};
const mailTransport = gmailConfig.email
  ? nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailConfig.email, pass: gmailConfig.app_password },
    })
  : null;

// Initialize Twilio (config set via: firebase functions:config:set twilio.account_sid="ACxxx" twilio.auth_token="xxx" twilio.from_number="+1xxxxx")
const twilioConfig = functions.config().twilio || {};
const twilioClient = twilioConfig.account_sid
  ? require("twilio")(twilioConfig.account_sid, twilioConfig.auth_token)
  : null;

// CORS middleware - restrict to your domain
const corsHandler = cors({
  origin: [
    "https://ethereal-balance.com",
    "https://www.ethereal-balance.com",
    "https://ethereal-balance.web.app",
    "https://ethereal-balance.firebaseapp.com",
    "https://robertamarin.github.io",
    "http://localhost:5500", // for local development
    "http://127.0.0.1:5500",
  ],
});

// ============================================
// CREATE CHECKOUT SESSION
// ============================================
// Called by the frontend when user clicks "Proceed to Checkout"
// Validates prices server-side from Firestore to prevent tampering
exports.createCheckoutSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    // Handle preflight
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const { items, successUrl, cancelUrl } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: "No items provided" });
        return;
      }

      if (!successUrl || !cancelUrl) {
        res.status(400).json({ error: "Missing redirect URLs" });
        return;
      }

      const lineItems = [];
      const orderItems = [];
      let hasPhysical = false;

      // Validate each item against Firestore
      for (const item of items) {
        if (!item.productId || !item.quantity || item.quantity < 1) {
          res.status(400).json({ error: "Invalid item data" });
          return;
        }

        const productDoc = await db
          .collection("products")
          .doc(item.productId)
          .get();

        if (!productDoc.exists) {
          res
            .status(400)
            .json({ error: `Product not found: ${item.productId}` });
          return;
        }

        const product = productDoc.data();

        if (!product.isActive) {
          res
            .status(400)
            .json({ error: `${product.name} is no longer available` });
          return;
        }

        // Check inventory for physical products
        if (product.category === "physical" && product.inventory !== -1) {
          if (product.inventory < item.quantity) {
            res.status(400).json({
              error: `${product.name} only has ${product.inventory} left in stock`,
            });
            return;
          }
        }

        if (product.category === "physical") {
          hasPhysical = true;
        }

        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: product.name,
              images:
                product.images && product.images.length > 0
                  ? [product.images[0]]
                  : [],
              metadata: { firebaseProductId: item.productId },
            },
            unit_amount: product.price, // Price in cents from Firestore
          },
          quantity: item.quantity,
        });

        orderItems.push({
          productId: item.productId,
          name: product.name,
          price: product.price,
          quantity: item.quantity,
          category: product.category,
        });
      }

      // Build checkout session config
      const sessionConfig = {
        payment_method_types: ["card"],
        line_items: lineItems,
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
        billing_address_collection: "required",
        metadata: {
          orderItems: JSON.stringify(orderItems),
        },
      };

      // Collect shipping address for physical products
      if (hasPhysical) {
        sessionConfig.shipping_address_collection = {
          allowed_countries: ["US"],
        };
      }

      const session = await stripe.checkout.sessions.create(sessionConfig);

      res.json({ sessionUrl: session.url });
    } catch (error) {
      console.error("Checkout session error:", error);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });
});

// ============================================
// STRIPE WEBHOOK
// ============================================
// Receives events from Stripe after payment
// Creates order in Firestore, decrements inventory, triggers email
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = functions.config().stripe.webhook_secret;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Handle the event
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;

      try {
        const orderItems = JSON.parse(session.metadata.orderItems || "[]");

        // Create order document in Firestore
        const orderRef = await db.collection("orders").add({
          stripeSessionId: session.id,
          stripePaymentIntentId: session.payment_intent,
          customerEmail: session.customer_details?.email || "",
          customerName: session.customer_details?.name || "",
          items: orderItems,
          subtotal: session.amount_subtotal,
          shipping: (session.total_details?.amount_shipping || 0),
          total: session.amount_total,
          status: "paid",
          shippingAddress: session.shipping_details?.address || null,
          shippingName: session.shipping_details?.name || null,
          trackingNumber: null,
          trackingCarrier: null,
          digitalDelivered: false,
          notes: "",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`Order created: ${orderRef.id}`);

        // Decrement inventory for physical products using transactions
        for (const item of orderItems) {
          if (item.category === "physical") {
            const productRef = db.collection("products").doc(item.productId);
            await db.runTransaction(async (transaction) => {
              const productDoc = await transaction.get(productRef);
              if (productDoc.exists) {
                const currentInventory = productDoc.data().inventory;
                if (currentInventory !== -1) {
                  transaction.update(productRef, {
                    inventory: currentInventory - item.quantity,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  });
                }
              }
            });
          }
        }

        // Trigger confirmation email via Firestore mail collection
        // (Requires Firebase "Trigger Email" extension with SMTP configured)
        const orderId = orderRef.id.slice(0, 8).toUpperCase();
        const itemsList = orderItems
          .map(
            (i) =>
              `${i.name} x${i.quantity} - $${((i.price * i.quantity) / 100).toFixed(2)}`
          )
          .join("<br>");

        await db.collection("mail").add({
          to: session.customer_details?.email,
          message: {
            subject: `Ethereal Balance - Order Confirmation #${orderId}`,
            html: `
              <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #FDFCFA; padding: 40px;">
                <div style="text-align: center; margin-bottom: 32px;">
                  <h1 style="font-size: 28px; color: #2D2D2D; font-weight: normal; margin: 0;">Thank You for Your Order</h1>
                </div>
                <p style="font-family: Arial, sans-serif; color: #8B8680; font-size: 14px;">
                  Hi ${session.customer_details?.name || "there"},
                </p>
                <p style="font-family: Arial, sans-serif; color: #8B8680; font-size: 14px;">
                  Your order <strong>#${orderId}</strong> has been confirmed. Here's a summary:
                </p>
                <div style="background: #F7F4F0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                  <p style="font-family: Arial, sans-serif; font-size: 14px; color: #2D2D2D;">
                    ${itemsList}
                  </p>
                  <hr style="border: none; border-top: 1px solid #E8E2D9; margin: 16px 0;">
                  <p style="font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; color: #2D2D2D; margin: 0;">
                    Total: $${(session.amount_total / 100).toFixed(2)}
                  </p>
                </div>
                <p style="font-family: Arial, sans-serif; color: #8B8680; font-size: 14px;">
                  We'll notify you when your order ships. If you have any questions, reply to this email or contact us at etherealbalancee@gmail.com.
                </p>
                <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #E8E2D9;">
                  <p style="font-family: Arial, sans-serif; color: #8B8680; font-size: 12px;">
                    Ethereal Balance | ethereal-balance.com
                  </p>
                </div>
              </div>
            `,
          },
        });

        // Handle digital product delivery
        const digitalItems = orderItems.filter(
          (i) => i.category === "digital"
        );
        if (digitalItems.length > 0) {
          // Fetch download URLs from product documents
          const downloadLinks = [];
          for (const item of digitalItems) {
            const productDoc = await db
              .collection("products")
              .doc(item.productId)
              .get();
            if (productDoc.exists && productDoc.data().digitalFileUrl) {
              downloadLinks.push({
                name: item.name,
                url: productDoc.data().digitalFileUrl,
              });
            }
          }

          if (downloadLinks.length > 0) {
            const linksHtml = downloadLinks
              .map(
                (l) =>
                  `<p><a href="${l.url}" style="color: #7A9167;">${l.name} - Download</a></p>`
              )
              .join("");

            await db.collection("mail").add({
              to: session.customer_details?.email,
              message: {
                subject: `Ethereal Balance - Your Digital Downloads`,
                html: `
                  <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #FDFCFA; padding: 40px;">
                    <h1 style="font-size: 24px; color: #2D2D2D; font-weight: normal; text-align: center;">Your Digital Products</h1>
                    <p style="font-family: Arial, sans-serif; color: #8B8680; font-size: 14px;">
                      Here are your download links:
                    </p>
                    <div style="background: #F7F4F0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                      ${linksHtml}
                    </div>
                    <p style="font-family: Arial, sans-serif; color: #8B8680; font-size: 12px;">
                      These links will expire in 24 hours. Please download your files promptly.
                    </p>
                  </div>
                `,
              },
            });

            await orderRef.update({ digitalDelivered: true });
          }
        }
      } catch (error) {
        console.error("Error processing checkout completion:", error);
      }
      break;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object;
      console.error(
        "Payment failed:",
        paymentIntent.id,
        paymentIntent.last_payment_error?.message
      );
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// ============================================
// SMS BLAST
// ============================================
// Sends an SMS to all subscribers with smsOptIn=true and a phone number
// Requires: firebase functions:config:set twilio.account_sid="ACxxx" twilio.auth_token="xxx" twilio.from_number="+1xxxxx"
exports.sendSmsBlast = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    // Verify caller is authenticated
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
    try { await admin.auth().verifyIdToken(token); } catch (e) {
      res.status(401).json({ error: "Invalid token" }); return;
    }

    const { message } = req.body;
    if (!message || !message.trim()) {
      res.status(400).json({ error: "Message is required" }); return;
    }

    if (!twilioClient) {
      res.status(500).json({ error: "Twilio not configured. Run: firebase functions:config:set twilio.account_sid twilio.auth_token twilio.from_number" });
      return;
    }

    try {
      const snap = await db.collection("subscribers")
        .where("smsOptIn", "==", true)
        .where("active", "==", true)
        .get();

      const recipients = snap.docs
        .map(d => d.data())
        .filter(s => s.phone && s.phone.trim());

      let sent = 0, failed = 0;
      const fromNumber = twilioConfig.from_number;

      for (const sub of recipients) {
        try {
          await twilioClient.messages.create({
            body: message.trim(),
            from: fromNumber,
            to: sub.phone.trim(),
          });
          sent++;
        } catch (err) {
          console.error(`SMS failed for ${sub.phone}:`, err.message);
          failed++;
        }
      }

      res.json({ sent, failed, total: recipients.length });
    } catch (error) {
      console.error("SMS blast error:", error);
      res.status(500).json({ error: "Failed to send SMS blast" });
    }
  });
});

// ============================================
// EMAIL BLAST
// ============================================
// Sends an email to all active subscribers via Nodemailer + Gmail
// Requires: firebase functions:config:set gmail.email="you@gmail.com" gmail.app_password="xxxx xxxx xxxx xxxx"
exports.sendEmailBlast = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    // Verify caller is authenticated
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
    try { await admin.auth().verifyIdToken(token); } catch (e) {
      res.status(401).json({ error: "Invalid token" }); return;
    }

    if (!mailTransport) {
      res.status(500).json({ error: "Gmail not configured. Run: firebase functions:config:set gmail.email=\"you@gmail.com\" gmail.app_password=\"xxxx xxxx xxxx xxxx\"" });
      return;
    }

    const { subject, htmlBody } = req.body;
    if (!subject || !htmlBody) {
      res.status(400).json({ error: "Subject and body are required" }); return;
    }

    try {
      const snap = await db.collection("subscribers")
        .where("active", "==", true)
        .get();

      const recipients = snap.docs
        .map(d => d.data())
        .filter(s => s.email && s.email.trim());

      let sent = 0, failed = 0;
      const fromName = "Ethereal Balance";
      const fromEmail = gmailConfig.email;

      for (const sub of recipients) {
        try {
          await mailTransport.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: sub.email.trim(),
            subject: subject.trim(),
            html: htmlBody,
          });
          sent++;
        } catch (err) {
          console.error(`Email failed for ${sub.email}:`, err.message);
          failed++;
        }
      }

      res.json({ sent, failed, total: recipients.length });
    } catch (error) {
      console.error("Email blast error:", error);
      res.status(500).json({ error: "Failed to send email blast" });
    }
  });
});
