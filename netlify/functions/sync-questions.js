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
    
    // Đếm số dòng có nội dung câu hỏi
    let totalQuestionsInSheet = 0;
    let invalidRows = 0;
    
    for (const row of rows) {
      const hasQuestion = (row[2] && row[2].trim()) || (row[3] && row[3].trim()) || (row[4] && row[4].trim());
      if (hasQuestion) {
        totalQuestionsInSheet++;
      } else {
        invalidRows++;
      }
    }
    
    console.log(`[sync-questions] 📊 Tổng số dòng trong Sheet: ${rows.length}`);
    console.log(`[sync-questions] 📊 Số câu hỏi hợp lệ trong Sheet: ${totalQuestionsInSheet}`);
    console.log(`[sync-questions] 📊 Số dòng không hợp lệ: ${invalidRows}`);

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
        sheet_row_id: `row_${i}_${Date.now()}_${i}`,
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
      return { statusCode: 200, headers, body: JSON.stringify({ 
        message: 'Sync thành công', 
        totalRows: rows.length,
        validQuestions: 0,
        synced: 0 
      })};
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    console.log(`[sync-questions] Đang thêm ${questions.length} câu hỏi...`);
    let inserted = 0;
    
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from('questions_cache')
        .insert(batch);
      
      if (insertError) {
        console.error(`Lỗi batch ${Math.floor(i/BATCH_SIZE) + 1}:`, insertError.message);
      } else {
        inserted += batch.length;
        console.log(`✅ Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(questions.length/BATCH_SIZE)}: Đã thêm ${batch.length} câu hỏi`);
      }
    }

    console.log(`[sync-questions] 🎉 Hoàn tất!`);

    // Trả về response với thông tin chi tiết
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: `Sync thành công - Google Sheet có ${totalQuestionsInSheet} câu hỏi`, 
        totalRows: rows.length,
        validQuestions: totalQuestionsInSheet,
        synced: inserted,
      }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
