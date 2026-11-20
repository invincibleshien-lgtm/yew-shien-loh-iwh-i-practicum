const axios = require('axios');

const fields = ['name', 'area', 'price'];

function createClient(token) {
  if (!token) throw new Error('Set HUBSPOT_ACCESS_TOKEN in your local .env file.');
  return axios.create({
    baseURL: 'https://api.hubapi.com',
    timeout: 15000,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

function objectPath(objectTypeId) {
  if (!/^2-\d+$/.test(objectTypeId || '')) {
    throw new Error('Set HUBSPOT_OBJECT_TYPE_ID to the custom object ID (2-...).');
  }
  return `/crm/v3/objects/${objectTypeId}`;
}

async function getRecords(client, objectTypeId) {
  const records = [];
  const seen = new Set();
  let after;
  do {
    const { data } = await client.get(objectPath(objectTypeId), {
      params: { properties: fields.join(','), limit: 100, archived: false, ...(after ? { after } : {}) },
    });
    records.push(...data.results);
    after = data.paging?.next?.after;
    if (after != null) {
      after = String(after);
      if (seen.has(after)) throw new Error('HubSpot returned a repeated pagination cursor.');
      seen.add(after);
    }
  } while (after);
  return records;
}

// Do not return raw Axios errors: they can contain the Authorization header.
function safeError(error) {
  const status = error.response?.status;
  if (status === 401) return 'HubSpot rejected the access token. Check your local .env file.';
  if (status === 403) return 'This app lacks the required HubSpot permissions. Check its scopes.';
  if (status === 404) return 'Custom object not found. Check the test account and object ID.';
  if (status === 429) return 'HubSpot rate limit reached. Please wait and try again.';
  if (status === 400) return 'HubSpot rejected the record. Check the custom property configuration.';
  return 'Unable to complete the HubSpot request. Check your connection and try again.';
}

module.exports = { createClient, getRecords, objectPath, safeError, fields };
