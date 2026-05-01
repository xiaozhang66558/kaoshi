const { createClient } = require('@supabase/supabase-js');

const SHEET_RANGE = 'Sheet1!A2:J10000';
const BATCH_SIZE = 300;

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

    // Tạo map các câu hỏi mới để dễ so sánh
    const newQuestionsMap = new Map();
    
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
        
        // Tạo ID dựa trên nội dung để tránh trùng lặp
        const contentKey = `${row[0]}_${row[1]}_${row[4]}_${row[2]}_${row[3]}`;
        const questionId = `${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`;
        
        const question = {
          id: questionId,
          sheet_row_id: questionId,
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
          is_active:    true,  // ✅ Câu hỏi mới luôn active
          synced_at:    new Date().toISOString(),
          option_a: '', option_b: '', option_c: '', option_d: '',
        };
        
        newQuestionsMap.set(contentKey, question);
        return question;
      });

    if (questions.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Không có câu hỏi hợp lệ', synced: 0 }) };
    }

    console.log(`[sync-questions] Đọc được ${questions.length} câu hỏi từ Google Sheet`);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // ✅ CÁCH MỚI: UPSERT (cập nhật nếu có, thêm nếu không)
    // Không cần vô hiệu hóa tất cả trước
    
    console.log('[sync-questions] Đang đồng bộ câu hỏi (upsert)...');
    
    let upserted = 0;
    let failed = 0;
    
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);
      
      try {
        // Dùng upsert: nếu tồn tại thì update, không thì insert
        const { error: upsertError, data } = await supabase
          .from('questions_cache')
          .upsert(batch, { 
            onConflict: 'sheet_row_id',  // Dùng sheet_row_id để kiểm tra trùng
            ignoreDuplicates: false 
          });
        
        if (upsertError) {
          console.error(`[sync-questions] Lỗi batch ${i/BATCH_SIZE + 1}:`, upsertError.message);
          failed += batch.length;
        } else {
          upserted += batch.length;
          console.log(`[sync-questions] ✅ Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(questions.length/BATCH_SIZE)}: Đã đồng bộ ${batch.length} câu hỏi`);
        }
      } catch (batchError) {
        console.error(`[sync-questions] Lỗi batch ${i/BATCH_SIZE + 1}:`, batchError.message);
        failed += batch.length;
      }
    }

    // ✅ Vô hiệu hóa các câu hỏi không còn tồn tại trong Google Sheet
    // Lấy tất cả sheet_row_id hiện có trong DB
    const { data: existingQuestions } = await supabase
      .from('questions_cache')
      .select('sheet_row_id');
    
    const newSheetRowIds = new Set(questions.map(q => q.sheet_row_id));
    const idsToDeactivate = existingQuestions
      ?.filter(q => !newSheetRowIds.has(q.sheet_row_id))
      .map(q => q.sheet_row_id) || [];
    
    if (idsToDeactivate.length > 0) {
      console.log(`[sync-questions] Vô hiệu hóa ${idsToDeactivate.length} câu hỏi không còn trong Google Sheet...`);
      
      // Chia nhỏ để tránh timeout
      for (let i = 0; i < idsToDeactivate.length; i += 500) {
        const batch = idsToDeactivate.slice(i, i + 500);
        await supabase
          .from('questions_cache')
          .update({ is_active: false })
          .in('sheet_row_id', batch);
      }
    }

    console.log(`[sync-questions] 🎉 Hoàn tất! Đã đồng bộ: ${upserted}, Vô hiệu hóa: ${idsToDeactivate.length}, Lỗi: ${failed}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Sync thành công', 
        synced: upserted,
        deactivated: idsToDeactivate.length,
        failed: failed,
        note: 'Câu hỏi mới đã được active, câu hỏi cũ không còn trong Sheet đã bị vô hiệu hóa'
      }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
