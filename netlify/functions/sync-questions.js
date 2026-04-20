const { createClient } = require('@supabase/supabase-js');

const SHEET_RANGE = 'Sheet1!A2:E1000';

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
      .filter(row => row.length >= 3 && row[2])
      .map((row, idx) => {
        const diffValue = String(row[4] || '1').trim();
        let difficulty = 'medium';
        if (diffValue === '1') difficulty = 'easy';
        else if (diffValue === '2') difficulty = 'medium';
        else if (diffValue === '3') difficulty = 'hard';
        
        return {
          sheet_row_id: `q_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
          series:       String(row[0] || '').trim(),
          position:     String(row[1] || '').trim(),
          question:     String(row[2] || '').trim(),
          score:        parseInt(row[3]) || 10,
          difficulty:   difficulty,
          is_active:    true,
          synced_at:    new Date().toISOString(),
          option_a: '', option_b: '', option_c: '', option_d: '',
        };
      });

    if (questions.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Không có câu hỏi hợp lệ', synced: 0 }) };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Insert dữ liệu mới
    const { error: insertError } = await supabase
      .from('questions_cache')
      .insert(questions);

    if (insertError) throw insertError;

    // Vô hiệu hóa câu hỏi không còn trong sheet
    const activeIds = questions.map(q => q.sheet_row_id);
    if (activeIds.length > 0) {
      const { error: updateError } = await supabase
        .from('questions_cache')
        .update({ is_active: false })
        .not('sheet_row_id', 'in', `(${activeIds.map(id => `"${id}"`).join(',')})`);
      if (updateError) throw updateError;
    }

    console.log(`[sync-questions] Đã đồng bộ ${questions.length} câu hỏi`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Sync thành công', 
        synced: questions.length
      }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
