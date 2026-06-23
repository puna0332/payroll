/**
 * Explore Lark Base tables — list all tables + sample records
 * Usage: npx tsx scripts/explore-lark-base.mts
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: 'packages/api/.env' });
loadDotenv();

const APP_ID = process.env.LARK_APP_ID;
const APP_SECRET = process.env.LARK_APP_SECRET;
const APP_TOKEN = process.env.LARK_APP_TOKEN;
const BASE_URL = 'https://open.larksuite.com/open-apis';

if (!APP_ID || !APP_SECRET || !APP_TOKEN) {
  throw new Error('Missing LARK_APP_ID, LARK_APP_SECRET, or LARK_APP_TOKEN in environment');
}

// ─── Get Token ──────────────────────────────────────────────

async function getToken() {
  const res = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await res.json();
  if (!data.tenant_access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.tenant_access_token;
}

// ─── API Helper ─────────────────────────────────────────────

async function larkGet(token, path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) {
    console.error(`API error at ${path}:`, data);
    return null;
  }
  return data.data;
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log('🔑 Getting token...');
  const token = await getToken();
  console.log('✅ Token acquired\n');

  // Step 1: List all tables in the Base
  console.log('═══ Step 1: List Tables ═══');
  const tablesData = await larkGet(token, `/bitable/v1/apps/${APP_TOKEN}/tables`);
  
  if (!tablesData?.items) {
    console.log('No tables found or no access');
    return;
  }

  const tables = tablesData.items;
  console.log(`Found ${tables.length} tables:\n`);

  for (const table of tables) {
    console.log(`📋 Table: "${table.name}" (ID: ${table.table_id})`);
    
    // Get fields
    const fieldsData = await larkGet(token, `/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields`);
    if (fieldsData?.items) {
      console.log(`   Fields (${fieldsData.items.length}):`);
      for (const f of fieldsData.items) {
        console.log(`     - ${f.field_name} (type: ${f.type}, id: ${f.field_id})`);
      }
    }

    // Get sample records (first 3)
    const recordsData = await larkGet(token, `/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records`, { page_size: '3' });
    if (recordsData?.items?.length) {
      console.log(`   Sample Records (${recordsData.total || recordsData.items.length} total):`);
      for (const r of recordsData.items) {
        const fields = r.fields;
        const preview = {};
        for (const [k, v] of Object.entries(fields)) {
          if (typeof v === 'object' && v !== null && Array.isArray(v)) {
            preview[k] = v.map(item => item?.text || item?.name || JSON.stringify(item)).join(', ');
          } else if (typeof v === 'object' && v !== null) {
            preview[k] = v.text || v.name || JSON.stringify(v);
          } else {
            preview[k] = v;
          }
        }
        console.log(`     Record ${r.record_id}:`, JSON.stringify(preview, null, 2).substring(0, 500));
      }
    } else {
      console.log('   (No records)');
    }
    console.log('');
  }

  // Save full output
  const output = { tables: [] };
  for (const table of tables) {
    const fieldsData = await larkGet(token, `/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields`);
    const recordsData = await larkGet(token, `/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records`, { page_size: '100' });
    output.tables.push({
      name: table.name,
      tableId: table.table_id,
      fields: fieldsData?.items || [],
      records: recordsData?.items || [],
      total: recordsData?.total || 0,
    });
  }

  const fs = await import('fs');
  fs.writeFileSync('scripts/lark-base-output.json', JSON.stringify(output, null, 2));
  console.log('\n✅ Full output saved to scripts/lark-base-output.json');
}

main().catch(console.error);
