require('dotenv').config({ quiet: true });
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createClient, getRecords, objectPath, safeError, fields } = require('./lib/hubspot');

function createApp({ client, objectTypeId }) {
  objectPath(objectTypeId);
  const app = express();
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const formTitle = 'Update Custom Object Form | Integrating With HubSpot I Practicum';
  app.disable('x-powered-by');
  app.set('view engine', 'pug');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });

  // Route 1: retrieve every page and explicitly request all three properties.
  app.get('/', async (req, res) => {
    try {
      const records = await getRecords(client, objectTypeId);
      res.render('homepage', { title: 'Property Listings | Integrating With HubSpot I Practicum', records });
    } catch (error) {
      res.status(502).render('error', { title: 'Unable to load records', message: safeError(error) });
    }
  });

  // Route 2: render the form, with the exact title required by the practicum.
  app.get('/update-cobj', (req, res) => {
    res.render('updates', { title: formTitle, values: {}, errors: [], csrfToken });
  });

  // Route 3: validate, create a CRM record, and redirect only after success.
  app.post('/update-cobj', async (req, res) => {
    if (req.body?._csrf !== csrfToken) {
      return res.status(403).render('error', { title: 'Form expired', message: 'Reopen the form and try again.' });
    }
    const values = {};
    const errors = [];
    for (const field of fields) {
      values[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : '';
      const max = 150;
      if (!values[field] || values[field].length > max) errors.push(`${field}: enter between 1 and ${max} characters.`);
    }
    if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(values.price) || Number(values.price) <= 0) errors.push('Enter a positive price in MYR, with up to two decimal places.');
    if (errors.length) return res.status(400).render('updates', { title: formTitle, values, errors, csrfToken });
    try {
      await client.post(objectPath(objectTypeId), { properties: values });
      return res.redirect(303, '/');
    } catch (error) {
      return res.status(502).render('updates', {
        title: formTitle, values, csrfToken,
        errors: [safeError(error), 'If the connection timed out, check the homepage before submitting again to avoid duplicates.'],
      });
    }
  });

  app.use((error, req, res, next) => {
    res.status(error.type === 'entity.too.large' ? 413 : 400)
      .render('error', { title: 'Request could not be processed', message: 'Please return to the form and try again.' });
  });
  return app;
}

if (require.main === module) {
  try {
    const app = createApp({ client: createClient(process.env.HUBSPOT_ACCESS_TOKEN), objectTypeId: process.env.HUBSPOT_OBJECT_TYPE_ID });
    const port = Number(process.env.PORT || 3000);
    // Local practicum only; no public unauthenticated CRM write endpoint.
    app.listen(port, '127.0.0.1', () => console.log(`Open http://localhost:${port}`));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createApp };
