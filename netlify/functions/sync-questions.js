const { createClient } = require('@supabase/supabase-js');

// Đọc từ cột A đến E, bắt đầu từ dòng 2 (bỏ qua header)
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
      .filter(row => row.length >= 3 && row[2]) // cần có câu hỏi (cột C)
      .map((row, idx) => ({
        sheet_row_id: `q_${Date.now()}_${idx}`, // tự tạo ID duy nhất, tránh trùng lặp
        series:       String(row[0] || '').trim(),      // cột A
        position:     String(row[1] || '').trim(),      // cột B
        question:     String(row[2] || '').trim(),      // cột C
        score:        parseInt(row[3]) || 10,           // cột D (mặc định 10 nếu không có)
        difficulty:   parseInt(row[4]) || 1,            // cột E (mặc định 1 nếu không có)
        is_active:    true,
        synced_at:    new Date().toISOString(),
        // Các cột option để trống vì dùng tự luận
        option_a: '',
        option_b: '',
        option_c: '',
        option_d: '',
      }));

    if (questions.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Không có câu hỏi hợp lệ', synced: 0 }) };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Xóa dữ liệu cũ trước khi insert mới (tránh lỗi trùng lặp)
    const { error: deleteError } = await supabase
      .from('questions_cache')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // xóa tất cả

    if (deleteError) throw deleteError;

    const { error: insertError } = await supabase
      .from('questions_cache')
      .insert(questions);

    if (insertError) throw insertError;

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
