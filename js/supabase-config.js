// Credentials are loaded from js/config.js (gitignored).
// See js/config.example.js for the required variables.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/**
 * Load all clubs with funding, returned in the flat format:
 * [{ id, name, lat, lng, totalFunding, funding: { "Program Year": amount } }]
 */
async function loadClubsFromSupabase() {
  const { data: clubs, error: e1 } = await sb.from('clubs').select('*').order('name');
  if (e1) throw e1;

  const { data: funding, error: e2 } = await sb.from('funding').select('*');
  if (e2) throw e2;

  const byClub = {};
  funding.forEach(f => {
    if (!byClub[f.club_id]) byClub[f.club_id] = [];
    byClub[f.club_id].push(f);
  });

  return clubs.map(club => {
    const rows = byClub[club.id] || [];
    const fundingObj = {};
    const fundingIds = {};
    let total = 0;
    rows.forEach(f => {
      const key = f.year ? `${f.program} ${f.year}` : f.program;
      const amt = parseFloat(f.amount);
      fundingObj[key] = amt;
      fundingIds[key] = f.id;
      total += amt;
    });
    return {
      id: club.id,
      name: club.name,
      lat: club.lat,
      lng: club.lng,
      totalFunding: total,
      funding: fundingObj,
      _fundingIds: fundingIds
    };
  });
}
