/* eslint-disable no-console */
const prisma = require('../src/lib/prisma');
const env = require('../src/config/env');
const { hashPassword } = require('../src/utils/password');
const assessmentService = require('../src/services/assessment.service');

async function main() {
  // 1) Provision the first HR Admin (idempotent).
  const passwordHash = await hashPassword(env.seedAdmin.password);
  const admin = await prisma.hrAdmin.upsert({
    where: { email: env.seedAdmin.email },
    update: {},
    create: { email: env.seedAdmin.email, name: env.seedAdmin.name, passwordHash },
  });
  console.log(`Admin ready: ${admin.email}`);

  // 2) Sample data only when there are no assessments yet.
  const existing = await prisma.assessment.count();
  if (existing > 0) {
    console.log(`Skipping sample data (${existing} assessments already present).`);
    return;
  }

  // Frontend role — create + publish. (Candidate assignments are created via the
  // assignment API once a blueprint is generated and approved.)
  const frontend = await assessmentService.create(
    { name: 'Frontend Engineer Screen', role: 'Frontend Engineer', level: 'MID', durationMinutes: 60, changeNote: 'Initial draft' },
    admin.id
  );
  await assessmentService.publish(frontend.id, admin.id, 'Ready for candidates');

  // Backend role — kept as a draft.
  await assessmentService.create(
    { name: 'Backend Engineer Screen', role: 'Backend Engineer', level: 'SENIOR', durationMinutes: 90, changeNote: 'Initial draft' },
    admin.id
  );

  // QA role — create, publish, then archive (so an archived+restorable one exists).
  const qa = await assessmentService.create(
    { name: 'QA Analyst Screen', role: 'QA Analyst', level: 'JUNIOR', durationMinutes: 45 },
    admin.id
  );
  await assessmentService.publish(qa.id, admin.id);
  await assessmentService.archive(qa.id, admin.id, 'Role on hold');

  console.log('Sample assessments and versions created.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
