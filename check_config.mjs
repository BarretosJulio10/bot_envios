
const url = 'https://uvvaxwtumuabfklccjgd.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dmF4d3R1bXVhYmZrbGNjamdkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDc4MjY5NSwiZXhwIjoyMDgwMzU4Njk1fQ.FR8p6ULuDaYsfCQIkaRn1ZIuY88N3zEMpS_MXif7IUg';

async function query() {
  console.log("Verificando colunas de evolution_config...");
  try {
    const res = await fetch(`${url}/rest/v1/evolution_config?limit=1`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });

    const data = await res.json();
    if (data.length > 0) {
      console.log("=== COLUNAS ENCONTRADAS ===");
      console.log(Object.keys(data[0]));
      console.log("=== DADOS DO PRIMEIRO REGISTRO ===");
      console.log(JSON.stringify(data[0], null, 2));
    } else {
      console.log("Nenhum dado encontrado.");
    }
  } catch (err) {
    console.error("Erro na execucao:", err.message);
  }
}

query();
