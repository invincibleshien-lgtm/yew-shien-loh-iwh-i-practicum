const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../index');

async function serve(t, client) {
  const server = createApp({ client, objectTypeId: '2-123456' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
async function form(base) {
  const response = await fetch(`${base}/update-cobj`);
  const html = await response.text();
  return { html, token: html.match(/name="_csrf" value="([^"]+)"/)[1] };
}
function submit(base, values) {
  return fetch(`${base}/update-cobj`, { method: 'POST', body: new URLSearchParams(values), redirect: 'manual' });
}

test('homepage gets all pages, requests each property and escapes CRM values', async t => {
  const calls = [];
  const base = await serve(t, { get: async (url, options) => {
    calls.push({ url, ...options.params });
    return calls.length === 1
      ? { data: { results: [{ properties: { name: '<script>alert(1)</script>', area: 'JB', price: '450000' } }], paging: { next: { after: '99' } } } }
      : { data: { results: [{ properties: { name: 'Second page', area: 'Ipoh', price: '650000' } }] } };
  } });
  const response = await fetch(base);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Second page/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].properties, 'name,area,price');
  assert.equal(calls[1].after, '99');
  assert.match(html, /Add to this table/);
});

test('form has exact title, required fields and return link', async t => {
  const base = await serve(t, {});
  const { html } = await form(base);
  assert.match(html, /Update Custom Object Form \| Integrating With HubSpot I Practicum/);
  for (const field of ['name', 'area', 'price']) assert.match(html, new RegExp(`name="${field}"`));
  assert.match(html, /Return to the homepage/);
});

test('valid form posts only allowed trimmed fields then redirects', async t => {
  let payload;
  const base = await serve(t, { post: async (url, body) => { payload = { url, body }; return { data: { id: '1' } }; } });
  const { token } = await form(base);
  const response = await submit(base, { _csrf: token, name: ' Project ', area: ' JB ', price: ' 550000.50 ', extra: 'ignore' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/');
  assert.deepEqual(payload, { url: '/crm/v3/objects/2-123456', body: { properties: { name: 'Project', area: 'JB', price: '550000.50' } } });
});

test('invalid field data never reaches the API and preserves form values', async t => {
  let posted = false;
  const base = await serve(t, { post: async () => { posted = true; } });
  const { token } = await form(base);
  const response = await submit(base, { _csrf: token, name: 'Keep this', area: ' ', price: '250000' });
  assert.equal(response.status, 400);
  assert.equal(posted, false);
  assert.match(await response.text(), /Keep this/);
});

test('forged form request is rejected', async t => {
  const base = await serve(t, { post: () => { throw new Error('Must not call'); } });
  assert.equal((await submit(base, { name: 'Test', area: 'JB', price: '480000' })).status, 403);
});

test('API failure does not redirect or expose secret details', async t => {
  const base = await serve(t, { post: async () => { throw { response: { status: 401 }, config: { headers: { Authorization: 'SECRET_TOKEN' } } }; } });
  const { token } = await form(base);
  const response = await submit(base, { _csrf: token, name: 'Test', area: 'JB', price: '480000' });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('location'), null);
  const html = await response.text();
  assert.match(html, /rejected the access token/);
  assert.doesNotMatch(html, /SECRET_TOKEN/);
});

test('homepage shows a useful rate-limit error', async t => {
  const base = await serve(t, { get: async () => { throw { response: { status: 429 } }; } });
  const response = await fetch(base);
  assert.equal(response.status, 502);
  assert.match(await response.text(), /rate limit/);
});

test('unsupported object ID is rejected before starting the app', () => {
  assert.throws(() => createApp({ client: {}, objectTypeId: 'contacts' }), /custom object ID/);
});

test('rejects a negative price before contacting HubSpot', async t => {
  const base = await serve(t, {});
  const { token } = await form(base);
  const response = await submit(base, { _csrf: token, name: 'Demo', area: 'JB', price: '-30' });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /positive price/);
});
