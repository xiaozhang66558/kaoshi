const { createClient } = require('@supabase/supabase-js');

const SHEET_RANGE = 'Sheet1!A2:J10000';
const BATCH_SIZE = 100;

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
      throw new Error(`Google Sheets API lỗi: ${sheetsRes.status}`);
    }
    
    const sheetsData = await sheetsRes.json();
    const rows = sheetsData.values || [];
    
    let totalSheetQuestions = 0;
    for (const row of rows) {
      const hasQuestion = (row[2] && row[2].trim()) || (row[3] && row[3].trim()) || (row[4] && row[4].trim());
      if (hasQuestion) totalSheetQuestions++;
    }
    
    console.log(`[sync-questions] 📊 Tổng số câu hỏi trong Google Sheet: ${totalSheetQuestions}`);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    let inserted = 0;
    
    // ✅ DUYỆT TỪNG DÒNG, INSERT TỪNG CÂU (KHÔNG KIỂM TRA GÌ CẢ)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const hasQuestion = (row[2] && row[2].trim()) || (row[3] && row[3].trim()) || (row[4] && row[4].trim());
      if (!hasQuestion) continue;
      
      const diffValue = String(row[6] || '1').trim();
      let difficulty = 'medium';
      if (diffValue === '1') difficulty = 'easy';
      else if (diffValue === '2') difficulty = 'medium';
      else if (diffValue === '3') difficulty = 'hard';
      
      const question = {
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
      };
      
      // ✅ INSERT từng câu, bỏ qua lỗi (nếu lỗi vẫn tiếp tục)
      const { error } = await supabase
        .from('questions_cache')
        .insert(question);
      
      if (error) {
        console.log(`⚠️ Lỗi dòng ${i + 1}: ${error.message}`);
      } else {
        inserted++;
        if (inserted % 100 === 0) {
          console.log(`✅ Đã thêm ${inserted} câu hỏi`);
        }
      }
    }

    console.log(`[sync-questions] 🎉 Hoàn tất! Đã thêm ${inserted} câu hỏi mới`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: `✅ Đã thêm ${inserted} câu hỏi từ Google Sheet.`,
        totalInSheet: totalSheetQuestions,
        inserted: inserted,
      }),
    };
  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
