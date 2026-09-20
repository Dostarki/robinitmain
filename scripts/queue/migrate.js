const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname,'..','..','.env')); } catch(error) { if(error.code!=='ENOENT') throw Error('Environment file unavailable'); }
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
const {PostgresStore} = require('./postgres-store');
const store = new PostgresStore({connectionString:process.env.DATABASE_URL});
store.migrate().then(()=>console.log('Queue database migration completed')).catch(()=>{console.error('Queue migration failed; check database access and migration privileges');process.exitCode=1;}).finally(()=>store.close());
