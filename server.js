import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import serverless from 'serverless-http';

// Initialize app
const app = express();
app.use(express.json());

// CORS setup
const allow = [
  'https://indiantravelbureau.myshopify.com',
  'https://indiantravelbureau.com',
  'https://www.indiantravelbureau.com'
];
app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true);       // server-to-server / Postman
    return cb(null, allow.includes(origin));  // allow only your storefronts
  },
  methods: ['POST','GET','OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.options('*', (req, res) => res.sendStatus(204));

// Shopify API setup
const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const REST  = `https://${STORE}.myshopify.com/admin/api/2024-07`;
const GQL   = `https://${STORE}.myshopify.com/admin/api/2024-07/graphql.json`;

// Health check endpoint
app.get('/health', (req, res) => res.json({ ok: true }));

// Who am I? endpoint
app.get('/whoami', async (req, res) => {
  try {
    const r = await axios.get(`${REST}/shop.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN }
    });
    res.json({ ok: true, shop: r.data.shop?.myshopify_domain });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.response?.data || e.message });
  }
});

// Main endpoint to handle leads
app.post('/api/lead', async (req, res) => {
  try {
    const { name, email, phone, product_title, product_price, customer_number, note } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: 'email required' });

    const adminNote = [
      name ? `Name: ${name}` : null,
      email ? `Email: ${email}` : null,
      phone ? `Phone: ${phone}` : null,
      product_title ? `Product: ${product_title}` : null,
      product_price ? `Price: ${product_price}` : null
    ].filter(Boolean).join(', ');

    // Logic for finding, creating, or updating customer
    let customer = await findCustomerByEmail(email);
    if (!customer) {
      customer = await createCustomer({
        first_name: name || '', email, phone, note: note || adminNote, tags: 'query-form'
      });
    } else {
      await updateCustomerNote(customer.id, note || adminNote);
    }

    await setCustomerMetafields(customer.id, {
      product_title,
      product_price,
      customer_number: customer_number || phone || ''
    });

    res.json({ ok: true, customer_id: customer.id });
  } catch (e) {
    res.status(e._status || 500).json({ ok: false, error: e._body || e.message });
  }
});

// Export the app as a serverless function
export default serverless(app);
