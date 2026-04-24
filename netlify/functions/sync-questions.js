const { createClient } = require('@supabase/supabase-js');

const SHEET_RANGE = 'Sheet1!A2:J1000';

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
      .filter(row => {
        const hasEn = row[2] && row[2].trim();
        const hasZh = row[3] && row[3].trim();
        const hasVi = row[4] && row[4].trim();
        return (hasEn || hasZh || hasVi);
      })
      .map((row, idx) => {
        const diffValue = String(row[6] || '1').trim();
        let difficulty = 'medium';
        if (diffValue === '1') difficulty = 'easy';
        else if (diffValue === '2') difficulty = 'medium';
        else if (diffValue === '3') difficulty = 'hard';
        
        return {
          // KHÔNG dùng sheet_row_id cố định, tạo ID mới mỗi lần sync
          sheet_row_id: `${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
          series:       String(row[0] || '').trim(),
          position:     String(row[1] || '').trim(),
          question_en:  String(row[2] || '').trim(),
          question_zh:  String(row[3] || '').trim(),
          question_vi:  String(row[4] || '').trim(),
          score:        parseInt(row[5]) || 10,
          difficulty:   difficulty,
          image_1:      String(row[7] || '').trim(),
          image_2:      String(row[8] || '').trim(),
          image_3:      String(row[9] || '').trim(),
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

    // 1. Vô hiệu hóa tất cả câu hỏi hiện tại (không xóa)
    const { error: updateError } = await supabase
      .from('questions_cache')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    
    if (updateError) throw updateError;

    // 2. Thêm câu hỏi mới (KHÔNG update, chỉ insert)
    const { error: insertError } = await supabase
      .from('questions_cache')
      .insert(questions);
    
    if (insertError) throw insertError;

    console.log(`[sync-questions] Đã thêm mới ${questions.length} câu hỏi (các câu hỏi cũ đã được vô hiệu hóa)`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Sync thành công', 
        synced: questions.length,
        note: 'Các câu hỏi cũ đã được vô hiệu hóa, bài thi cũ vẫn giữ nguyên nội dung'
      }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
