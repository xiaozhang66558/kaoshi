const { createClient } = require('@supabase/supabase-js');

const SHEET_RANGE = 'Sheet1!A2:J10000';
const BATCH_SIZE = 300; // Chia thành batch 300 câu hỏi mỗi lần

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

    console.log(`[sync-questions] Đọc được ${questions.length} câu hỏi từ Google Sheet`);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // 1. Vô hiệu hóa tất cả câu hỏi hiện tại (không xóa)
    console.log('[sync-questions] Bước 1: Vô hiệu hóa câu hỏi cũ...');
    const { error: updateError } = await supabase
      .from('questions_cache')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    
    if (updateError) throw updateError;
    console.log('[sync-questions] ✅ Đã vô hiệu hóa câu hỏi cũ');

    // 2. Thêm câu hỏi mới theo BATCH
    console.log(`[sync-questions] Bước 2: Thêm ${questions.length} câu hỏi mới theo batch ${BATCH_SIZE}...`);
    
    let inserted = 0;
    let failed = 0;
    
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);
      
      try {
        const { error: insertError } = await supabase
          .from('questions_cache')
          .insert(batch);
        
        if (insertError) {
          console.error(`[sync-questions] Lỗi batch ${i/BATCH_SIZE + 1}:`, insertError.message);
          failed += batch.length;
        } else {
          inserted += batch.length;
          console.log(`[sync-questions] ✅ Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(questions.length/BATCH_SIZE)}: Đã thêm ${batch.length} câu hỏi`);
        }
      } catch (batchError) {
        console.error(`[sync-questions] Lỗi batch ${i/BATCH_SIZE + 1}:`, batchError.message);
        failed += batch.length;
      }
    }

    console.log(`[sync-questions] 🎉 Hoàn tất! Đã thêm: ${inserted}, Lỗi: ${failed}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Sync thành công', 
        synced: inserted,
        failed: failed,
        note: 'Các câu hỏi cũ đã được vô hiệu hóa, bài thi cũ vẫn giữ nguyên nội dung'
      }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
