#!/usr/bin/env node
// One-off ops script to bootstrap the first (or an additional) platform
// admin account. Deliberately not an API endpoint — platform admins are
// never self-registered (same reasoning as hotel staff, §8.2), so creating
// one is an action a developer/ops person runs by hand, not something the
// running server exposes over the network.
//
// Usage: node scripts/create-platform-admin.mjs "Full Name" email@example.com 'password'

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const [, , name, email, password] = process.argv;

if (!name || !email || !password) {
  console.error('Usage: node scripts/create-platform-admin.mjs "Full Name" email@example.com \'password\'');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (existing) {
    console.error(`A platform admin with email "${email}" already exists.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.platformAdmin.create({ data: { name, email, passwordHash } });
  console.log(`Created platform admin "${admin.name}" <${admin.email}> (id: ${admin.id}).`);
  console.log('Log in at /admin on the web app.');
} finally {
  await prisma.$disconnect();
}
