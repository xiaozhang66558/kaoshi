const { createClient } = require('@supabase/supabase-js');

// Đọc từ cột A đến E, bắt đầu từ dòng 2 (bỏ qua header)
// Cấu trúc: A=series, B=position, C=question, D=score, E=difficulty (1=easy, 2=medium, 3=hard)
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

    // Chuyển đổi dữ liệu từ Google Sheet
    const questions = rows
      .filter(row => row.length >= 3 && row[2]) // cần có câu hỏi (cột C)
      .map((row, idx) => {
        // Chuyển đổi difficulty từ số sang text (1=easy, 2=medium, 3=hard)
        const diffValue = String(row[4] || '1').trim();
        let difficulty = 'medium';
        if (diffValue === '1') difficulty = 'easy';
        else if (diffValue === '2') difficulty = 'medium';
        else if (diffValue === '3') difficulty = 'hard';
        
        return {
          sheet_row_id: `q_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`, // ID duy nhất tuyệt đối
          series:       String(row[0] || '').trim(),   // cột A
          position:     String(row[1] || '').trim(),   // cột B
          question:     String(row[2] || '').trim(),   // cột C
          score:        parseInt(row[3]) || 10,        // cột D (mặc định 10)
          difficulty:   difficulty,                     // cột E (đã chuyển sang text)
          is_active:    true,
          synced_at:    new Date().toISOString(),
          // Các cột option để trống vì dùng tự luận
          option_a: '',
          option_b: '',
          option_c: '',
          option_d: '',
        };
      });

    if (questions.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Không có câu hỏi hợp lệ', synced: 0 }) };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Xóa dữ liệu cũ trong bảng questions_cache
    const { error: deleteError } = await supabase
      .from('questions_cache')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // xóa tất cả

    if (deleteError) throw deleteError;

    // Insert dữ liệu mới
    const { error: insertError, data } = await supabase
      .from('questions_cache')
      .insert(questions)
      .select();

    if (insertError) throw insertError;

    console.log(`[sync-questions] Đã đồng bộ ${questions.length} câu hỏi`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Sync thành công', 
        synced: questions.length,
        data: data 
      }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
