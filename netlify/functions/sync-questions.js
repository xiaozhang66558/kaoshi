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
      const err = await sheetsRes.text();
      throw new Error(`Google Sheets API lỗi: ${err}`);
    }
    const sheetsData = await sheetsRes.json();
    const rows = sheetsData.values || [];

    console.log(`[sync-questions] Đọc được ${rows.length} dòng từ Google Sheet`);

    // Xử lý dữ liệu
    const questions = [];
    
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const hasEn = row[2] && row[2].trim();
      const hasZh = row[3] && row[3].trim();
      const hasVi = row[4] && row[4].trim();
      
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

    console.log(`[sync-questions] Xử lý được ${questions.length} câu hỏi hợp lệ`);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Cách đơn giản: Xóa hết rồi thêm mới
    console.log('[sync-questions] Đang xóa dữ liệu cũ...');
    
    // Xóa từng batch để tránh lỗi khóa ngoại
    const { data: oldQuestions } = await supabase
      .from('questions_cache')
      .select('id');
    
    if (oldQuestions && oldQuestions.length > 0) {
      for (let i = 0; i < oldQuestions.length; i += 50) {
        const batch = oldQuestions.slice(i, i + 50);
        const ids = batch.map(q => q.id);
        
        // Xóa submissions trước
        await supabase
          .from('submissions')
          .delete()
          .in('question_id', ids);
        
        // Xóa questions
        await supabase
          .from('questions_cache')
          .delete()
          .in('id', ids);
      }
      console.log(`[sync-questions] ✅ Đã xóa ${oldQuestions.length} câu hỏi cũ`);
    }

    // Thêm câu hỏi mới theo BATCH
    console.log(`[sync-questions] Đang thêm ${questions.length} câu hỏi mới...`);
    let inserted = 0;
    
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);
      
      const { error: insertError } = await supabase
        .from('questions_cache')
        .insert(batch);
      
      if (insertError) {
        console.error(`Lỗi batch ${i/BATCH_SIZE + 1}:`, insertError.message);
      } else {
        inserted += batch.length;
        console.log(`✅ Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(questions.length/BATCH_SIZE)}: Đã thêm ${batch.length} câu hỏi`);
      }
    }

    console.log(`[sync-questions] 🎉 Hoàn tất! Đã thêm ${inserted} câu hỏi`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Sync thành công', 
        synced: inserted,
      }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
