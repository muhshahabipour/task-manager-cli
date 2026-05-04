const { Pool } = require("pg");

const getPoolConfig = () => {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
    };
  }

  return {
    user: process.env.PGUSER || "admin",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "tasks_db",
    password: process.env.PGPASSWORD || "admin",
    port: Number(process.env.PGPORT || 5432),
  };
};

const pool = new Pool({
  ...getPoolConfig(),
});

module.exports = pool;
