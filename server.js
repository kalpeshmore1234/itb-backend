// server.js
import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import cors from 'cors';

// 1) init app first
export const app = express();
app.use(express.json());

// 2) CORS (browser only; Postman ignores CORS)
const allow = [
  'https://indiantravelbureau.myshopify.com',
  'https://indiantravelbureau.com',
  'https://www.indiantravelbureau.com',
];
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);        // server-to-server / Postman / curl
    cb(null, allow.includes(origin) || origin.endsWith('.vercel.app')); // allow vercel previews too
  },
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.options('*', (req, res) => res.sendStatus(204));

// 3) Shopify endpoints
const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const REST  = `https://${STORE}.myshopify.com/admin/api/2024-07`;
const GQL   = `https://${STORE}.myshopify.com/admin/api/2024-07/graphql.json`;

// sanity logs
console.log('🟢 Booting API');
console.log('Store:', STORE);
console.log('Token prefix:', TOKEN?.slice(0, 8), 'len:', TOKEN?.length);

// Health  ✅ (mounted under /api for Vercel)
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Who am I? ✅ (mounted under /api for Vercel)
app.get('/api/whoami', async (req, res) => {
  try {
    const r = await axios.get(`${REST}/shop.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN },
    });
    res.json({ ok: true, shop: r.data.shop?.myshopify_domain });
  } catch (e) {
    console.error('whoami error:', e.response?.status, e.response?.data || e.message);
    res.status(500).json({ ok: false, error: e.response?.data || e.message });
  }
});

function throwDetailed(e, label) {
  const status = e.response?.status;
  const body = e.response?.data;
  console.error(`❌ ${label} failed`, status, body || e.message);
  const err = new Error(label);
  err._status = status || 500;
  err._body = body || { message: e.message };
  throw err;
}

async function findCustomerByEmail(email) {
  try {
    const r = await axios.get(`${REST}/customers/search.json`, {
      params: { query: `email:${email}` },
      headers: { 'X-Shopify-Access-Token': TOKEN },
    });
    return r.data.customers?.[0] || null;
  } catch (e) { throwDetailed(e, 'customers/search'); }
}

async function createCustomer({ first_name, email, phone, note, tags }) {
  try {
    const r = await axios.post(`${REST}/customers.json`,
      { customer: { first_name, email, phone, note, tags } },
      { headers: { 'X-Shopify-Access-Token': TOKEN } }
    );
    return r.data.customer;
  } catch (e) { throwDetailed(e, 'customers/create'); }
}

async function updateCustomerNote(id, note) {
  try {
    await axios.put(`${REST}/customers/${id}.json`,
      { customer: { id, note } },
      { headers: { 'X-Shopify-Access-Token': TOKEN } }
    );
  } catch (e) { throwDetailed(e, 'customers/update'); }
}

async function setCustomerMetafields(customerId, { product_title, product_price, customer_number }) {
  const ownerId = `gid://shopify/Customer/${customerId}`;
  const query = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`;
  const variables = {
    metafields: [
      { ownerId, namespace: 'custom', key: 'product_title',
        type: 'single_line_text_field', value: String(product_title || '') },
      { ownerId, namespace: 'custom', key: 'product_price',
        type: 'single_line_text_field', value: String((product_price || '').toString().replace(/[^\d.]/g, '')) },
      { ownerId, namespace: 'custom', key: 'customer_number',
        type: 'single_line_text_field', value: String(customer_number || '') },
    ],
  };

  try {
    const r = await axios.post(GQL, { query, variables }, {
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    });
    const errs = r.data?.data?.metafieldsSet?.userErrors || [];
    if (errs.length) {
      console.error('❌ metafieldsSet userErrors:', errs);
      const err = new Error('metafieldsSet userErrors');
      err._status = 422;
      err._body = { userErrors: errs };
      throw err;
    }
  } catch (e) { throwDetailed(e, 'metafieldsSet'); }
}

// Main endpoint (already under /api)
app.post('/api/lead', async (req, res) => {
  try {
    const { name, email, phone, product_title, product_price, customer_number, note } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: 'email required' });

    const adminNote = [
      name ? `Name: ${name}` : null,
      email ? `Email: ${email}` : null,
      phone ? `Phone: ${phone}` : null,
      product_title ? `Product: ${product_title}` : null,
      product_price ? `Price: ${product_price}` : null,
    ].filter(Boolean).join(', ');

    let customer = await findCustomerByEmail(email);
    if (!customer) {
      customer = await createCustomer({
        first_name: name || '', email, phone, note: note || adminNote, tags: 'query-form',
      });
    } else {
      await updateCustomerNote(customer.id, note || adminNote);
    }

    await setCustomerMetafields(customer.id, {
      product_title,
      product_price,
      customer_number: customer_number || phone || '',
    });

    res.json({ ok: true, customer_id: customer.id });
  } catch (e) {
    res.status(e._status || 500).json({ ok: false, error: e._body || e.message });
  }
});

// 404 fallback so unknown paths don't hang
app.use((req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

// 4) only listen locally; Vercel will wrap the app
if (process.env.VERCEL !== '1') {
  app.listen(process.env.PORT || 3000, () => console.log('✅ API listening'));
}

