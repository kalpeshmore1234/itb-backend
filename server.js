import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import serverless from 'serverless-http';

// Initialize the app
const app = express();
app.use(express.json());

// CORS configuration
const allow = [
  'https://indiantravelbureau.myshopify.com',
  'https://indiantravelbureau.com',
  'https://www.indiantravelbureau.com'
];
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);       // allow server-to-server / Postman
    cb(null, allow.includes(origin));         // allow only your storefronts
  },
  methods: ['POST','GET','OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.options('*', (req, res) => res.sendStatus(204));

// Shopify API variables
const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const REST  = `https://${STORE}.myshopify.com/admin/api/2024-07`;
const GQL   = `https://${STORE}.myshopify.com/admin/api/2024-07/graphql.json`;

// Log for debugging
console.log('🟢 Booting API');
console.log('Store:', STORE);
console.log('Token prefix:', TOKEN?.slice(0, 8), 'len:', TOKEN?.length);

// Health endpoint
app.get('/health', (req, res) => res.json({ ok: true }));

// Who am I endpoint
app.get('/whoami', async (req, res) => {
  try {
    const r = await axios.get(`${REST}/shop.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN }
    });
    res.json({ ok: true, shop: r.data.shop?.myshopify_domain });
  } catch (e) {
    console.error('whoami error:', e.response?.status, e.response?.data || e.message);
    res.status(500).json({ ok: false, error: e.response?.data || e.message });
  }
});

// Define your helper functions here...

// Main endpoint
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

// Export the app for serverless
export default serverless(app);
