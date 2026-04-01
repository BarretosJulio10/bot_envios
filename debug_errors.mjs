
const url = 'https://uvvaxwtumuabfklccjgd.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dmF4d3R1bXVhYmZrbGNjamdkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDc4MjY5NSwiZXhwIjoyMDgwMzU4Njk1fQ.FR8p6ULuDaYsfCQIkaRn1ZIuY88N3zEMpS_MXif7IUg';

async function query() {
  console.log("Buscando falhas detalhadas em group_messages...");
  try {
    const res = await fetch(`${url}/rest/v1/group_messages?status=eq.failed&select=id,group_name,image_url,error_message&limit=5`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error("Erro na API REST:", res.status, txt);
      return;
    }

    const data = await res.json();
    console.log("=== Detalhes das Falhas ===");
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Erro na execucao:", err.message);
  }
}

query();
