import pg from 'pg'

const connectionString = process.env.DATABASE_URL || 'postgres://oficinapro:oficinapro_dev@localhost:5433/oficinapro'
export const pool = new pg.Pool({ connectionString })

// O resto do código foi escrito no estilo node:sqlite (placeholders "?", .get/.all/.run).
// Esses helpers convertem "?" -> "$1,$2,..." e imitam o formato de retorno original,
// pra não precisar reescrever as ~200 strings SQL existentes ao trocar de banco.
function toPgQuery(sql) {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

export async function many(sql, params = []) {
  const res = await pool.query(toPgQuery(sql), params)
  return res.rows
}

export async function one(sql, params = []) {
  const rows = await many(sql, params)
  return rows[0]
}

export async function run(sql, params = []) {
  const res = await pool.query(toPgQuery(sql), params)
  return { lastInsertRowid: res.rows[0]?.id ?? null, changes: res.rowCount, rows: res.rows }
}

export async function exec(sql) {
  await pool.query(sql)
}
