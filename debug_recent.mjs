
const url = 'https://uvvaxwtumuabfklccjgd.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dmF4d3R1bXVhYmZrbGNjamdkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDc4MjY5NSwiZXhwIjoyMDgwMzU4Njk1fQ.FR8p6ULuDaYsfCQIkaRn1ZIuY88N3zEMpS_MXif7IUg';

async function query() {
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  console.log("Buscando mensagens da ultima hora (desde " + oneHourAgo + ")...");
  try {
    const res = await fetch(`${url}/rest/v1/group_messages?created_at=gt.${oneHourAgo}&select=id,status,error_message,created_at&order=created_at.desc&limit=20`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });

    const data = await res.json();
    console.log("=== Mensagens Recentes ===");
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Erro na execucao:", err.message);
  }
}

query();
