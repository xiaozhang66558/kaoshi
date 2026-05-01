const { createClient } = require('@supabase/supabase-js');

const SHEET_RANGE = 'Sheet1!A2:J10000';

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
    console.log('[sync-questions] Bắt đầu đồng bộ...');
    
    // 1. Lấy dữ liệu từ Google Sheet
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_ID}/values/${encodeURIComponent(SHEET_RANGE)}?key=${process.env.GOOGLE_API_KEY}`;
    const sheetsRes = await fetch(sheetsUrl);
    if (!sheetsRes.ok) {
      throw new Error(`Google Sheets API lỗi: ${sheetsRes.status}`);
    }
    const sheetsData = await sheetsRes.json();
    const rows = sheetsData.values || [];
    
    console.log(`[sync-questions] Đọc được ${rows.length} dòng từ Google Sheet`);

    // 2. Xử lý dữ liệu
    const questions = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const hasEn = row[2]?.trim();
      const hasZh = row[3]?.trim();
      const hasVi = row[4]?.trim();
      
      if (!hasEn && !hasZh && !hasVi) continue;
      
      const diffValue = String(row[6] || '1').trim();
      let difficulty = 'medium';
      if (diffValue === '1') difficulty = 'easy';
      else if (diffValue === '2') difficulty = 'medium';
      else if (diffValue === '3') difficulty = 'hard';
      
      questions.push({
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
      });
    }

    if (questions.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Không có câu hỏi hợp lệ', synced: 0 }) };
    }

    console.log(`[sync-questions] Xử lý được ${questions.length} câu hỏi`);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // 3. Xóa hết dữ liệu cũ (nhanh hơn UPSERT)
    console.log('[sync-questions] Xóa dữ liệu cũ...');
    
    // Xóa submissions trước (để tránh lỗi khóa ngoại)
    await supabase.from('submissions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    
    // Xóa questions_cache
    await supabase.from('questions_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    
    console.log('[sync-questions] ✅ Đã xóa dữ liệu cũ');

    // 4. Thêm dữ liệu mới (1 lần duy nhất, không batch)
    console.log('[sync-questions] Đang thêm câu hỏi mới...');
    const { error: insertError } = await supabase
      .from('questions_cache')
      .insert(questions);
    
    if (insertError) {
      throw insertError;
    }

    console.log(`[sync-questions] 🎉 Hoàn tất! Đã thêm ${questions.length} câu hỏi`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Sync thành công', 
        synced: questions.length,
      }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
