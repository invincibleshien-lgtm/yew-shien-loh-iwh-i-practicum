// Run after setup in the developer test account. Reuse the same test listing on retries.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../index');
const { createClient, getRecords, objectPath, safeError } = require('../lib/hubspot');

async function verify() {
  const client = createClient(process.env.HUBSPOT_ACCESS_TOKEN);
  const objectTypeId = process.env.HUBSPOT_OBJECT_TYPE_ID;
  objectPath(objectTypeId);
  const { data: account } = await client.get('/account-info/v3/details');
  assert.equal(String(account.portalId), '248057519', 'Unexpected developer account');
  const { data: schema } = await client.get('/crm-object-schemas/v3/schemas/' + objectTypeId);
  assert.equal(schema.name, 'practicum_property_listing');
  assert.ok(schema.associations.some(a =>
    (a.fromObjectTypeId === objectTypeId && a.toObjectTypeId === '0-1') ||
    (a.fromObjectTypeId === '0-1' && a.toObjectTypeId === objectTypeId)
  ), 'Contacts association missing');

  const server = createApp({ client, objectTypeId }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    async function page(path) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      return response.text();
    }
    assert.match(await page('/'), /Demo Austin Residence/);
    const name = 'Practicum form verification listing';
    const records = await getRecords(client, objectTypeId);
    if (!records.some(record => record.properties.name === name)) {
      const form = await page('/update-cobj');
      const csrf = form.match(/name="_csrf" value="([^"]+)"/);
      assert.ok(csrf, 'Form token missing');
      const response = await fetch(base + '/update-cobj', {
        method: 'POST', redirect: 'manual',
        body: new URLSearchParams({ _csrf: csrf[1], name, area: 'Johor Bahru', price: '550000' }),
      });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/');
      console.log('Verified live form creation and redirect.');
    } else {
      console.log('Existing verification listing reused. No new POST or redirect verified this run.');
    }
    const stored = (await getRecords(client, objectTypeId)).filter(r => r.properties.name === name);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].properties.area, 'Johor Bahru');
    assert.equal(Number(stored[0].properties.price), 550000);
    assert.ok((await page('/')).includes(name));
    console.log('Verified CRM readback, homepage display and Contacts association. Record ID:', stored[0].id);
  } finally {
    server.close();
  }
}

verify().catch(error => {
  console.error(error.isAxiosError ? safeError(error) : error.message);
  process.exitCode = 1;
});
