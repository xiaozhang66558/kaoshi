const { createClient } = require('@supabase/supabase-js');

const SHEET_RANGE = 'Sheet1!A2:J10000';
const BATCH_SIZE = 200;

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
    
    // Lấy dữ liệu từ Google Sheet
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_ID}/values/${encodeURIComponent(SHEET_RANGE)}?key=${process.env.GOOGLE_API_KEY}`;
    const sheetsRes = await fetch(sheetsUrl);
    
    if (!sheetsRes.ok) {
      throw new Error(`Google Sheets API lỗi: ${sheetsRes.status}`);
    }
    
    const sheetsData = await sheetsRes.json();
    const rows = sheetsData.values || [];
    
    console.log(`[sync-questions] Đọc được ${rows.length} dòng từ Google Sheet`);

    // Xử lý dữ liệu
    const questions = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const hasQuestion = (row[2] && row[2].trim()) || (row[3] && row[3].trim()) || (row[4] && row[4].trim());
      if (!hasQuestion) continue;
      
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
        option_a:     '',
        option_b:     '',
        option_c:     '',
        option_d:     '',
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

    // ✅ CÁCH AN TOÀN: Kiểm tra từng câu hỏi, cập nhật hoặc thêm mới
    console.log(`[sync-questions] Đang đồng bộ ${questions.length} câu hỏi...`);
    let upserted = 0;

    for (const question of questions) {
      // Tìm câu hỏi theo nội dung tiếng Anh
      const { data: existing } = await supabase
        .from('questions_cache')
        .select('id')
        .eq('question_en', question.question_en)
        .maybeSingle();
      
      if (existing) {
        // Cập nhật câu hỏi hiện có (giữ nguyên ID)
        const { error: updateError } = await supabase
          .from('questions_cache')
          .update(question)
          .eq('id', existing.id);
        
        if (!updateError) upserted++;
      } else {
        // Thêm câu hỏi mới
        const { error: insertError } = await supabase
          .from('questions_cache')
          .insert(question);
        
        if (!insertError) upserted++;
      }
    }

    console.log(`[sync-questions] 🎉 Hoàn tất! Đã đồng bộ ${upserted} câu hỏi`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Sync thành công', 
        synced: upserted,
      }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
