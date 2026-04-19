# ExamFlow — Hệ thống thi trực tuyến
> GitHub + Netlify + Supabase + Google Sheets

## Tổng quan

| Tầng | Công nghệ | Vai trò |
|------|-----------|---------|
| Frontend | Next.js 14 trên Netlify | Giao diện thí sinh & admin |
| Backend | Supabase | Auth, Database, RLS, Functions |
| Dữ liệu | Google Sheets | Ngân hàng câu hỏi (admin tự quản lý) |
| CI/CD | GitHub → Netlify | Auto deploy khi push code |
| Serverless | Netlify Functions | Sync câu hỏi từ Google Sheets |

---

## Cài đặt từng bước

### Bước 1 — Tạo Supabase project

1. Vào [supabase.com](https://supabase.com) → New project
2. Vào **SQL Editor** → paste toàn bộ nội dung file `supabase/schema.sql` → **Run**
3. Lấy thông tin từ **Settings > API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret` key → `SUPABASE_SERVICE_KEY`

#### Tạo tài khoản Admin
Sau khi chạy schema, tạo user admin thủ công trong Supabase:
```sql
-- Trong SQL Editor, sau khi user đã đăng ký qua UI
UPDATE profiles SET role = 'admin' WHERE email = 'admin@yoursite.com';
```

---

### Bước 2 — Cài đặt Google Sheets

1. Tạo một Google Spreadsheet mới
2. **Đặt tên sheet đầu tiên là `Sheet1`**
3. Tạo header ở **Row 1** theo đúng thứ tự:

| Cột A | Cột B | Cột C | Cột D | Cột E | Cột F | Cột G | Cột H | Cột I | Cột J |
|-------|-------|-------|-------|-------|-------|-------|-------|-------|-------|
| sheet_row_id | question | option_a | option_b | option_c | option_d | correct_answer | difficulty | topic | is_active |

**Ví dụ dữ liệu (Row 2 trở đi):**
```
row_1 | HTML là viết tắt của gì? | HyperText Markup Language | High-Tech... | ... | ... | a | easy | HTML | true
```

- `correct_answer`: chỉ nhập `a`, `b`, `c`, hoặc `d`
- `difficulty`: `easy`, `medium`, hoặc `hard`
- `is_active`: `true` hoặc `false` (false = ẩn câu hỏi)
- `sheet_row_id`: ID duy nhất, không được trùng (có thể dùng row_1, row_2... hoặc UUID)

4. **Chia sẻ sheet**: Đặt quyền "Anyone with the link can view"

5. **Lấy Spreadsheet ID** từ URL:
```
https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
```

#### Tạo Google API Key
1. Vào [Google Cloud Console](https://console.cloud.google.com)
2. Tạo project mới (hoặc dùng existing)
3. **APIs & Services > Enable APIs** → bật `Google Sheets API`
4. **APIs & Services > Credentials** → Create credentials → API Key
5. Restrict key: chỉ cho phép `Google Sheets API`
6. Copy key → `GOOGLE_API_KEY`

---

### Bước 3 — Clone và cấu hình project

```bash
git clone <your-repo-url>
cd exam-system
npm install

# Copy env file và điền giá trị
cp .env.example .env.local
# Mở .env.local và điền tất cả biến
```

**Test local:**
```bash
npm run dev
# Mở http://localhost:3000
```

---

### Bước 4 — Đẩy lên GitHub

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/username/exam-system.git
git push -u origin main
```

---

### Bước 5 — Deploy lên Netlify

1. Vào [netlify.com](https://netlify.com) → Add new site → Import from GitHub
2. Chọn repo vừa tạo
3. Build settings (thường tự detect):
   - Build command: `npm run build`
   - Publish directory: `.next`
4. **Site settings > Environment variables** → Thêm tất cả biến từ `.env.example`:
   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   GOOGLE_SHEETS_ID
   GOOGLE_API_KEY
   SUPABASE_URL
   SUPABASE_SERVICE_KEY
   SYNC_SECRET
   NEXT_PUBLIC_SYNC_SECRET
   ```
5. Deploy!

---

## Cách sử dụng

### Thí sinh
1. Vào URL của site → đăng ký / đăng nhập
2. Nhấn "Bắt đầu làm bài" → nhận đề ngẫu nhiên
3. Làm bài, câu trả lời lưu tự động
4. Nộp bài → xem điểm ngay

### Admin
1. Đăng nhập bằng tài khoản admin
2. Tự động vào trang `/admin`
3. **Xem danh sách bài thi** → click "Xem chi tiết" để review từng bài
4. **Sync câu hỏi**: click nút "🔄 Sync Google Sheets" để cập nhật từ Sheet

### Cập nhật câu hỏi (không cần deploy lại)
1. Thêm/sửa câu hỏi trong Google Sheets
2. Admin vào dashboard → nhấn "Sync Google Sheets"
3. Câu hỏi mới có ngay lập tức

---

## Cấu trúc project

```
exam-system/
├── supabase/
│   └── schema.sql          # Toàn bộ schema + RLS + Functions
├── netlify/
│   └── functions/
│       └── sync-questions.js  # Sync Google Sheets → Supabase
├── src/
│   ├── lib/
│   │   └── supabase.js     # Client + tất cả helpers
│   ├── pages/
│   │   ├── index.jsx       # Trang đăng nhập
│   │   ├── exam.jsx        # Trang làm bài thi
│   │   └── admin/
│   │       └── index.jsx   # Admin dashboard
│   └── styles/
│       ├── auth.module.css
│       ├── exam.module.css
│       └── admin.module.css
├── .env.example
├── netlify.toml
└── package.json
```

---

## Tùy chỉnh

### Thay đổi số câu / thời gian thi
Trong `src/pages/exam.jsx`, sửa dòng:
```js
const sessionId = await createExamSession({ numQuestions: 20, durationMins: 30 });
```

### Thêm nhiều đề thi theo chủ đề
```js
// Lấy câu hỏi chỉ từ topic 'JavaScript'
const sessionId = await createExamSession({ numQuestions: 15, topic: 'JavaScript' });
```

### Tự động sync câu hỏi theo lịch
Thêm vào `netlify.toml`:
```toml
[[edge_functions]]
# Hoặc dùng Supabase pg_cron để schedule sync
```

---

## Bảo mật

- **RLS (Row Level Security)**: Thí sinh chỉ thấy dữ liệu của mình
- **Admin role**: Kiểm tra ở cả frontend (redirect) và backend (RLS policy)
- **Sync secret**: Endpoint sync được bảo vệ bằng header secret
- **Service key**: Chỉ dùng trong Netlify Functions (server-side), không expose ra client
