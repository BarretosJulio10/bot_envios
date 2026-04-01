
const url = 'https://uvvaxwtumuabfklccjgd.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dmF4d3R1bXVhYmZrbGNjamdkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDc4MjY5NSwiZXhwIjoyMDgwMzU4Njk1fQ.FR8p6ULuDaYsfCQIkaRn1ZIuY88N3zEMpS_MXif7IUg';

async function query() {
  const userId = '2390e3df-8b27-4529-b7f2-0abe23d242d0';
  console.log(`Listando arquivos em whatsapp-files/${userId}/...`);
  try {
    const res = await fetch(`${url}/storage/v1/object/list/whatsapp-files`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prefix: `${userId}/`, limit: 50 })
    });
    const files = await res.json();
    console.log("Arquivos encontrados:", files.map(f => f.name));
  } catch (err) {
    console.error("Erro na execucao:", err.message);
  }
}

query();
