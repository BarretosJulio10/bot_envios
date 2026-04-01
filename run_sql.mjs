import fs from 'fs';
import pg from 'pg';
const { Client } = pg;

// O password possui os caracteres - + . #, que codificados viram: - %2B . %23
const client = new Client({
  connectionString: 'postgresql://postgres:Gigi553518-%2B.%23@db.uvvaxwtumuabfklccjgd.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    console.log("Conectando ao banco de dados...");
    await client.connect();
    console.log("Conectado! Lendo o arquivo SQL...");
    const sql = fs.readFileSync('supabase_setup_pwa.sql', 'utf8');
    await client.query(sql);
    console.log("✅ SQL EXECUTADO COM SUCESSO! As tabelas e o storage foram gerados no Supabase.");
  } catch (err) {
    console.error("❌ Erro ao rodar SQL:", err);
  } finally {
    await client.end();
  }
}

run();
