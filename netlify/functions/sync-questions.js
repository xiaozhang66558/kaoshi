const { createClient } = require('@supabase/supabase-js');
const SHEET_RANGE = 'Sheet1!A2:J10000';
const BATCH_SIZE = 200;

function normalizeSeries(raw) {
  if (!raw) return '';
  let s = raw.trim().replace(/\s+/g, ' ');
  const map = {
    'AR 55FIVE MZ':              'AR 55FIVE',
    'AR MZPLAY 55FIVE':          'AR 55FIVE',
    'FB999':                     'AR FB999',
    'AR印度- 巴基斯坦 - MZPLAY': 'AR 巴基斯坦',
    'AR印度- 巴基斯坦 - 巴西':   'AR 巴基斯坦',
    'AR VN':                     'AR VIETNAM',
  };
  return map[s] || s;
}

function makeStableId(series, position, question_en, question_zh) {
  const raw = `${series}||${position}||${question_en}||${question_zh}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `q_${Math.abs(hash)}`;
}

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

    console.log(`[sync-questions] Đọc được ${rows.length} dòng từ Google Sheet`);

    // Build questions and deduplicate
    const seen = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const hasQuestion = (row[2] && row[2].trim()) || (row[3] && row[3].trim()) || (row[4] && row[4].trim());
      if (!hasQuestion) continue;

      const diffValue = String(row[6] || '1').trim();
      let difficulty = 'medium';
      if (diffValue === '1') difficulty = 'easy';
      else if (diffValue === '2') difficulty = 'medium';
      else if (diffValue === '3') difficulty = 'hard';

      const series   = normalizeSeries(row[0]);
      const position = String(row[1] || '').trim();
      const q_en     = String(row[2] || '').trim();
      const q_zh     = String(row[3] || '').trim();
      const stableId = makeStableId(series, position, q_en, q_zh);

      seen.set(stableId, {
        sheet_row_id: stableId,
        series,
        position,
        question_en:  q_en,
        question_zh:  q_zh,
        question_vi:  String(row[4] || '').trim(),
        score:        parseInt(row[5]) || 10,
        difficulty,
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

    const questions = Array.from(seen.values());
    const activeIds = new Set(questions.map(q => q.sheet_row_id));

    if (questions.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Không có câu hỏi hợp lệ', synced: 0 }) };
    }

    console.log(`[sync-questions] Sau dedup còn ${questions.length} câu hỏi unique`);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Step 1: Upsert all questions from Google Sheet
    let inserted = 0;
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);
      const { error: upsertError } = await supabase
        .from('questions_cache')
        .upsert(batch, { onConflict: 'sheet_row_id' });

      if (upsertError) {
        console.error(`Lỗi batch ${Math.floor(i / BATCH_SIZE) + 1}:`, upsertError.message);
      } else {
        inserted += batch.length;
        console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(questions.length / BATCH_SIZE)}: ${batch.length} câu hỏi`);
      }
    }

    // Step 2: Deactivate q_ questions that are no longer in Google Sheet
    // Get all active q_ question IDs from database
    const { data: existingQs, error: fetchError } = await supabase
      .from('questions_cache')
      .select('id, sheet_row_id')
      .like('sheet_row_id', 'q_%')
      .eq('is_active', true);

    if (!fetchError && existingQs) {
      const toDeactivate = existingQs
        .filter(q => !activeIds.has(q.sheet_row_id))
        .map(q => q.id);

      if (toDeactivate.length > 0) {
        const { error: deactivateError } = await supabase
          .from('questions_cache')
          .update({ is_active: false })
          .in('id', toDeactivate);

        if (deactivateError) {
          console.error('Lỗi deactivate:', deactivateError.message);
        } else {
          console.log(`🚫 Đã deactivate ${toDeactivate.length} câu hỏi đã xóa khỏi Google Sheet`);
        }
      } else {
        console.log('✅ Không có câu hỏi nào cần deactivate');
      }
    }

    console.log(`[sync-questions] 🎉 Hoàn tất! ${inserted} câu hỏi synced`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Sync thành công', synced: inserted }),
    };

  } catch (err) {
    console.error('[sync-questions] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
