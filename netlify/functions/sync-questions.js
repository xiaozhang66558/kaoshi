const { createClient } = require('@supabase/supabase-js');

const SHEET_RANGE = 'Sheet1!A2:J1000'; // Giả sử cột A: question, B: option_a, C: option_b, D: option_c, E: option_d, F: difficulty, G: topic, H: is_active (bỏ correct_answer)

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const secret = event.headers['x-sync-secret'];
  if (secret !== process.env.SYNC_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_ID}/values/${encodeURIComponent(SHEET_RANGE)}?key=${process.env.GOOGLE_API_KEY}`;
    const sheetsRes = await fetch(sheetsUrl);
    if (!sheetsRes.ok) {
      const err = await sheetsRes.text();
      throw new Error(`Google Sheets API lỗi: ${err}`);
    }
    const sheetsData = await sheetsRes.json();
    const rows = sheetsData.values || [];

    const questions = rows
      .filter(row => row.length >= 5 && row[0] && row[1]) // cần ít nhất câu hỏi và option_a
      .map(row => ({
        sheet_row_id:   String(row[0]).trim(),
        question:       String(row[1]).trim(),
        option_a:       String(row[2] || '').trim(),
        option_b:       String(row[3] || '').trim(),
        option_c:       String(row[4] || '').trim(),
        option_d:       String(row[5] || '').trim(),
        difficulty:     ['easy','medium','hard'].includes(String(row[6]).trim().toLowerCase()) ? String(row[6]).trim().toLowerCase() : 'medium',
        topic:          String(row[7] || '').trim() || null,
        is_active:      String(row[8] || 'true').trim().toLowerCase() !== 'false',
        synced_at:      new Date().toISOString(),
      }));

    if (questions.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Không có câu hỏi hợp lệ', synced: 0 }) };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { error } = await supabase
      .from('questions_cache')
      .upsert(questions, { onConflict: 'sheet_row_id', returning: 'minimal' });
    if (error) throw error;

    const activeIds = questions.map(q => q.sheet_row_id);
    await supabase
      .from('questions_cache')
      .update({ is_active: false })
      .not('sheet_row_id', 'in', `(${activeIds.map(id => `"${id}"`).join(',')})`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Sync thành công', synced: questions.length }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
