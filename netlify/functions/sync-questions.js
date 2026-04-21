const { createClient } = require('@supabase/supabase-js');

// Đọc từ cột A đến G (series, position, question_en, question_zh, question_vi, score, difficulty)
const SHEET_RANGE = 'Sheet1!A2:G1000';

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
      .filter(row => row.length >= 4 && row[2])
      .map((row, idx) => {
        const diffValue = String(row[6] || '1').trim();
        let difficulty = 'medium';
        if (diffValue === '1') difficulty = 'easy';
        else if (diffValue === '2') difficulty = 'medium';
        else if (diffValue === '3') difficulty = 'hard';
        
        return {
          sheet_row_id: `row_${idx + 1}`,
          series:       String(row[0] || '').trim(),
          position:     String(row[1] || '').trim(),
          question_en:  String(row[2] || '').trim(),
          question_zh:  String(row[3] || '').trim(),
          question_vi:  String(row[4] || '').trim(),
          score:        parseInt(row[5]) || 10,
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

    // 1. Cập nhật is_active = false cho tất cả câu hỏi hiện tại
    const { error: updateError } = await supabase
      .from('questions_cache')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    
    if (updateError) throw updateError;

    // 2. Insert câu hỏi mới (nếu sheet_row_id đã tồn tại thì update)
    const { error: upsertError } = await supabase
      .from('questions_cache')
      .upsert(questions, { onConflict: 'sheet_row_id' });
    
    if (upsertError) throw upsertError;

    console.log(`[sync-questions] Đã đồng bộ ${questions.length} câu hỏi với 3 ngôn ngữ`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Sync thành công', 
        synced: questions.length,
        languages: ['en', 'zh', 'vi']
      }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
