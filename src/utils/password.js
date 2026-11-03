const bcrypt = require('bcryptjs');
const env = require('../config/env');

const hashPassword = (plain) => bcrypt.hash(plain, env.bcryptRounds);

const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

module.exports = { hashPassword, verifyPassword };
