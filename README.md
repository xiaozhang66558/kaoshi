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
UPDATE profiles SET role = 'admin' WHERE email = 'admin@yoursite.com';