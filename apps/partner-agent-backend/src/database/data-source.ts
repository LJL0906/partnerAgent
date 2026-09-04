import 'dotenv/config';
import { createDatabaseDataSource } from './database-definition.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL 未配置');

export default createDatabaseDataSource(url);
