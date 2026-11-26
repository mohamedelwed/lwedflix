-- ============================================================
-- 0021: Movie resume positions that follow the account
--
-- Where you stopped in a movie lived only in localStorage, so the phone
-- app (mobile/) and another computer started from the top. One row per
-- (user, movie), the same shape the client keeps locally. Private, like
-- show_progress.
-- ============================================================

create table if not exists public.movie_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  movie_id text not null,
  watched real not null default 0,
  duration real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);

create index if not exists movie_progress_user_idx
  on public.movie_progress (user_id, updated_at desc);

alter table public.movie_progress enable row level security;

drop policy if exists "movie_progress_own" on public.movie_progress;
create policy "movie_progress_own" on public.movie_progress for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
