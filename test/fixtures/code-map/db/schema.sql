-- Messages the clacks carried.
create table if not exists messages (
  id integer primary key,
  body text not null
);

insert into messages (body) values ('GNU Terry Pratchett');
