import { prisma } from './shared/db/prisma.js';

async function main() {
  console.log("Checking May 2026 approvals in DB...");
  const start = new Date('2026-05-01T00:00:00Z');
  const end = new Date('2026-05-31T23:59:59Z');

  const count = await prisma.approvalRecord.count({
    where: {
      startTime: {
        gte: start,
        lte: end,
      }
    }
  });

  console.log(`Total approvals in May 2026 by startTime: ${count}`);

  const types = await prisma.approvalRecord.groupBy({
    by: ['approvalType', 'status'],
    where: {
      startTime: {
        gte: start,
        lte: end,
      }
    },
    _count: true,
  });

  console.log("Breakdown by Type & Status in May 2026:");
  console.log(JSON.stringify(types, null, 2));

  // Let's also check all approvals by createdAt in May 2026
  const countCreated = await prisma.approvalRecord.count({
    where: {
      createdAt: {
        gte: start,
        lte: end,
      }
    }
  });
  console.log(`Total approvals in May 2026 by createdAt: ${countCreated}`);

  // Let's print the most recent 10 approvals in May 2026
  const list = await prisma.approvalRecord.findMany({
    where: {
      startTime: {
        gte: start,
        lte: end,
      }
    },
    orderBy: { startTime: 'desc' },
    take: 10,
    include: {
      employee: { select: { fullName: true } }
    }
  });

  console.log("Most recent 10 approvals in May 2026:");
  for (const r of list) {
    console.log(`- [${r.serialNumber}] ${r.employee.fullName} | Type: ${r.approvalType} | Status: ${r.status} | Start: ${r.startTime?.toISOString()}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
