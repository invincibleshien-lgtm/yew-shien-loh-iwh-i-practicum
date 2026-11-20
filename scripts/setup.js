require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { createClient, getRecords, objectPath, safeError } = require('../lib/hubspot');

// Run only against the dedicated practicum developer test account.
// Re-running skips existing seed names; it never deletes records.
async function setup() {
  const accountId = process.env.HUBSPOT_TEST_ACCOUNT_ID;
  if (accountId !== '248057519') throw new Error('This setup script is restricted to practicum test account 248057519.');
  const client = createClient(process.env.HUBSPOT_ACCESS_TOKEN);
  // Verify the token belongs to the intended account BEFORE creating anything.
  const { data: account } = await client.get('/account-info/v3/details');
  if (String(account.portalId) !== accountId) throw new Error('Token belongs to a different account. No data was created.');
  const schemaPath = '/crm-object-schemas/v3/schemas';
  const { data: schemas } = await client.get(schemaPath);
  let schema = schemas.results.find(item => item.name === 'practicum_property_listing');
  if (!schema) {
    ({ data: schema } = await client.post(schemaPath, {
      name: 'practicum_property_listing',
      labels: { singular: 'Property Listing', plural: 'Property Listings' },
      primaryDisplayProperty: 'name',
      secondaryDisplayProperties: ['area'],
      searchableProperties: ['name', 'area'],
      requiredProperties: ['name', 'area', 'price'],
      properties: [
        { name: 'name', label: 'Name', type: 'string', fieldType: 'text' },
        { name: 'area', label: 'Area', type: 'string', fieldType: 'text' },
        { name: 'price', label: 'Asking price (MYR)', type: 'number', fieldType: 'number' },
      ],
      associatedObjects: ['0-1'],
    }));
  }
  for (const name of ['name', 'area', 'price']) {
    const property = schema.properties.find(item => item.name === name);
    if (!property || property.type !== (name === 'price' ? 'number' : 'string')) throw new Error(`Schema property ${name} is missing or incompatible.`);
  }
  const objectTypeId = schema.objectTypeId;
  const records = await getRecords(client, objectTypeId);
  const seeds = [
    { name: 'Demo Austin Residence', area: 'Johor Bahru', price: '580000' },
    { name: 'Demo Bayan Gardens', area: 'Penang', price: '450000' },
    { name: 'Demo Ipoh Courtyard', area: 'Ipoh', price: '320000' },
  ];
  for (const properties of seeds) {
    if (!records.some(record => record.properties.name === properties.name)) {
      const { data } = await client.post(objectPath(objectTypeId), { properties });
      records.push(data);
    }
  }
  const verified = await getRecords(client, objectTypeId);
  if (!seeds.every(seed => verified.some(record => record.properties.name === seed.name))) {
    throw new Error('Could not verify all three seed records. Re-run setup after checking HubSpot.');
  }
  const envPath = path.join(__dirname, '..', '.env');
  let env = fs.readFileSync(envPath, 'utf8');
  env = /^HUBSPOT_OBJECT_TYPE_ID=.*$/m.test(env)
    ? env.replace(/^HUBSPOT_OBJECT_TYPE_ID=.*$/m, `HUBSPOT_OBJECT_TYPE_ID=${objectTypeId}`)
    : `${env}\nHUBSPOT_OBJECT_TYPE_ID=${objectTypeId}\n`;
  fs.writeFileSync(envPath, env);
  const listUrl = `https://app.hubspot.com/contacts/${accountId}/objects/${objectTypeId}/views/all/list`;
  const readmePath = path.join(__dirname, '..', 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  fs.writeFileSync(readmePath, readme.replace('TEST_OBJECT_LIST_LINK_PENDING', `[Open Property Listings in the developer test account](${listUrl})`));
  console.log(`Verified ${verified.length} records in test account ${accountId}.`);
  console.log(`Object ID: ${objectTypeId}\nList view: ${listUrl}`);
}

setup().catch(error => {
  console.error(error.isAxiosError ? safeError(error) : error.message);
  process.exitCode = 1;
});
