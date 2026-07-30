create table recipients (
  user_id    text primary key,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table message_log (
  id      bigint generated always as identity primary key,
  user_id text not null,
  sent_at timestamptz not null default now()
);

create table config (
  key   text primary key,
  value text not null
);
