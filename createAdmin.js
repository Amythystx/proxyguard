/**
 * createAdmin.js
 * Seed script for initial administrator account.
 * Usage:
 *   ADMIN_EMAIL="admin@college.edu" ADMIN_PASSWORD="your_strong_password" node createAdmin.js
 *   or via command line arguments:
 *   node createAdmin.js <email> <password> [name]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./models/User');

const ADMIN_NAME  = process.argv[4] || process.env.ADMIN_NAME  || 'Administrator';
const ADMIN_EMAIL = process.argv[2] || process.env.ADMIN_EMAIL;
const ADMIN_PASS  = process.argv[3] || process.env.ADMIN_PASSWORD;

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASS) {
    console.error('Error: Administrator email and password must be provided.');
    console.error('Usage:');
    console.error('  node createAdmin.js <email> <password> [name]');
    console.error('  or set ADMIN_EMAIL and ADMIN_PASSWORD in environment variables.');
    process.exit(1);
  }

  if (ADMIN_PASS.length < 8) {
    console.error('Error: Administrator password must be at least 8 characters long.');
    process.exit(1);
  }

  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/proxyguard';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB at', uri.replace(/\/\/[^@]+@/, '//***:***@'));

  const cleanEmail = ADMIN_EMAIL.toLowerCase().trim();
  const existing = await User.findOne({ email: cleanEmail });
  if (existing) {
    console.log('Admin account already exists for email:', cleanEmail);
    process.exit(0);
  }

  const hashed = await bcrypt.hash(ADMIN_PASS, 10);
  await User.create({
    name: ADMIN_NAME.trim(),
    email: cleanEmail,
    password: hashed,
    role: 'admin'
  });

  console.log('Administrator account created successfully.');
  console.log('  Email :', cleanEmail);
  console.log('  Role  : admin');
  process.exit(0);
}

main().catch(err => {
  console.error('Failed to create admin:', err.message);
  process.exit(1);
});
