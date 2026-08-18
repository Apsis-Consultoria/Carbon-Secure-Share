-- =============================================================================
-- Secure Share Carbon - o que existe apenas do lado do CLIENTE
-- Arquivo: 20260818120000_portal_cliente.sql
-- =============================================================================
-- As tabelas principais (carbon_secure_share_projetos, _equipe, _clientes,
-- _permissoes) e as funcoes carbon_secure_share_autenticar, _nome_pasta e
-- _nivel_item NAO estao aqui: elas vem da migration
-- 20260817120000_secure_share.sql do repositorio Portal-Apsis-Carbon, que e o
-- lado da APSIS.
--
-- OS DOIS SISTEMAS COMPARTILHAM O MESMO PROJETO SUPABASE, de proposito. E a
-- mesma pasta e o mesmo cadastro vistos de dois lados: dois bancos exigiriam
-- sincronizar credencial e permissao entre eles, e a primeira divergencia seria
-- um cliente que continua entrando depois de a equipe ter revogado o acesso.
--
-- ORDEM DE APLICACAO: a migration do Portal-Apsis-Carbon primeiro, esta depois.
-- As referencias abaixo dependem das tabelas de la.
--
-- Esta migration e idempotente: pode ser reaplicada sem erro.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;


-- =============================================================================
-- 1. carbon_secure_share_tentativas - anti forca bruta no login do cliente
-- =============================================================================
-- O login do cliente e por e-mail e senha, publico na internet. Sem contador de
-- falhas, a unica barreira contra um script seria o custo do bcrypt.
--
-- Guardamos o E-MAIL TENTADO, e nao uma FK para o cliente: a maior parte das
-- tentativas de ataque usa e-mail que nao existe, e sao justamente essas que
-- precisam ser contadas. Uma FK descartaria o caso mais interessante.
--
-- LGPD: e-mail e dado pessoal. A finalidade aqui e seguranca do proprio titular
-- (defesa de credencial), a retencao e curta e a limpeza esta na secao 3.
-- Nao guardamos IP nem user agent: eles ampliariam o tratamento sem melhorar o
-- controle, que e por e-mail.

create table if not exists public.carbon_secure_share_tentativas (
  id          bigserial primary key,
  email       text not null,
  sucesso     boolean not null default false,
  tentado_em  timestamptz not null default now()
);

comment on table public.carbon_secure_share_tentativas is
  'Tentativas de login no portal do cliente, para o limite anti forca bruta da Edge Function carbon-ss-login (8 falhas em 15 minutos por e-mail). Guarda o e-mail TENTADO e nao uma FK para o cliente, porque a maioria das tentativas de ataque usa e-mail inexistente, que e exatamente o que precisa ser contado. LGPD: finalidade de seguranca, sem IP e sem user agent, com expurgo em carbon_secure_share_limpar_tentativas.';
comment on column public.carbon_secure_share_tentativas.email is
  'E-mail informado na tentativa, em minusculas. Pode nao corresponder a cadastro nenhum.';
comment on column public.carbon_secure_share_tentativas.sucesso is
  'false conta para o limite. O registro de sucesso existe para o login bem-sucedido poder apagar as falhas anteriores daquele e-mail (ver carbon-ss-login), para quem acertou depois de errar tres vezes nao carregar o contador.';

-- Indice do caminho quente: contar falhas recentes de UM e-mail. Parcial, porque
-- a consulta do throttle nunca olha as linhas de sucesso.
create index if not exists carbon_ss_tentativas_email_idx
  on public.carbon_secure_share_tentativas (email, tentado_em desc)
  where sucesso = false;

create index if not exists carbon_ss_tentativas_data_idx
  on public.carbon_secure_share_tentativas (tentado_em);

alter table public.carbon_secure_share_tentativas enable row level security;
revoke all on public.carbon_secure_share_tentativas from anon, authenticated;
-- bigserial cria uma sequence, que tambem precisa ficar fora do alcance de anon.
revoke all on sequence public.carbon_secure_share_tentativas_id_seq from anon, authenticated;


-- =============================================================================
-- 2. Troca de senha pelo proprio cliente
-- =============================================================================
-- Exige a senha atual mesmo com sessao valida: sessao aberta em maquina
-- compartilhada nao pode virar troca de credencial.
--
-- Troca em TODOS os cadastros ativos daquele e-mail. A mesma pessoa pode ser
-- cliente de mais de um projeto, e cada projeto tem uma linha propria em
-- carbon_secure_share_clientes. Trocar so a linha que casou deixaria a pessoa
-- com senhas diferentes por projeto e um login que funciona para uns e nao para
-- outros - do ponto de vista de quem usa, seria simplesmente um bug.

create or replace function public.carbon_secure_share_trocar_senha(
  p_email       text,
  p_senha_atual text,
  p_senha_nova  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email     text := lower(btrim(coalesce(p_email, '')));
  v_confere   integer;
  v_alteradas integer;
begin
  if v_email = '' or coalesce(p_senha_atual, '') = '' or coalesce(p_senha_nova, '') = '' then
    return jsonb_build_object('trocada', false, 'motivo', 'campos_obrigatorios');
  end if;

  -- Espelha o minimo da Edge Function e o de carbon_secure_share_definir_senha.
  if length(p_senha_nova) < 12 then
    return jsonb_build_object('trocada', false, 'motivo', 'senha_curta');
  end if;

  -- A senha atual precisa conferir em ALGUM cadastro ativo deste e-mail.
  select count(*)
    into v_confere
    from public.carbon_secure_share_clientes c
   where lower(btrim(c.email)) = v_email
     and c.status = 'ativo'
     and c.senha_hash is not null
     and c.senha_hash = extensions.crypt(p_senha_atual, c.senha_hash);

  if v_confere = 0 then
    return jsonb_build_object('trocada', false, 'motivo', 'senha_atual_incorreta');
  end if;

  update public.carbon_secure_share_clientes
     set senha_hash        = extensions.crypt(p_senha_nova, extensions.gen_salt('bf', 10)),
         senha_definida_em = now()
   where lower(btrim(email)) = v_email
     and status = 'ativo';

  get diagnostics v_alteradas = row_count;

  return jsonb_build_object('trocada', true, 'cadastros', v_alteradas);
end;
$$;

comment on function public.carbon_secure_share_trocar_senha(text, text, text) is
  'Troca a senha do cliente, exigindo a senha atual mesmo com sessao valida (sessao aberta em maquina compartilhada nao pode virar troca de credencial). Aplica a TODOS os cadastros ativos do mesmo e-mail: a pessoa pode ser cliente de varios projetos, e senhas diferentes por projeto seriam um login que funciona para uns e nao para outros. Devolve {trocada:false, motivo} em vez de lancar excecao, para a Edge Function traduzir sem depender de texto de erro do Postgres.';

revoke all on function public.carbon_secure_share_trocar_senha(text, text, text)
  from anon, authenticated;


-- =============================================================================
-- 3. Expurgo das tentativas antigas
-- =============================================================================
-- A tabela e append-only no caminho normal e cresce sem parar. 90 dias cobre
-- qualquer investigacao de incidente e mantem a retencao proporcional a
-- finalidade (LGPD, minimizacao).
--
-- NAO agendamos aqui. pg_cron pode nao estar habilitado no projeto, e uma
-- migration que falha por causa de uma extensao ausente trava o deploy inteiro.
-- O agendamento esta documentado em README.md como passo de operacao.

create or replace function public.carbon_secure_share_limpar_tentativas(
  p_dias integer default 90
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removidas integer;
begin
  delete from public.carbon_secure_share_tentativas
   where tentado_em < now() - make_interval(days => greatest(coalesce(p_dias, 90), 1));
  get diagnostics v_removidas = row_count;
  return v_removidas;
end;
$$;

comment on function public.carbon_secure_share_limpar_tentativas(integer) is
  'Apaga tentativas de login com mais de N dias (padrao 90) e devolve quantas saiu. Retencao proporcional a finalidade de seguranca (LGPD, minimizacao). Nao ha agendamento nesta migration de proposito: pg_cron pode nao estar habilitado e uma migration que depende de extensao ausente trava o deploy. Ver o passo de operacao no README.';

revoke all on function public.carbon_secure_share_limpar_tentativas(integer)
  from anon, authenticated;
